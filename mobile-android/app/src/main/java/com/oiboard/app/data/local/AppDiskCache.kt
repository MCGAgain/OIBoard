package com.oiboard.app.data.local

import android.content.Context
import com.oiboard.app.data.model.ContestDto
import com.oiboard.app.data.model.HeatmapResponse
import com.oiboard.app.data.model.MistakeCountsDto
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.StatsOverviewResponse
import com.oiboard.app.data.model.SubmissionDto
import com.oiboard.app.data.model.TagStatDto
import com.oiboard.app.data.remote.appJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

@Serializable
data class CacheEnvelope<T>(
    val version: Int = 1,
    val timestamp: Long = System.currentTimeMillis(),
    val keyHash: String,
    val data: T
)

@Serializable
data class OverviewCacheDto(
    val overview: StatsOverviewResponse,
    val heatmap: HeatmapResponse?,
    val upcomingContests: List<ContestDto>,
    val tags: List<TagStatDto>
)

@Serializable
data class ContestsCacheDto(
    val contests: List<ContestDto>
)

@Serializable
data class SubmissionsCacheDto(
    val submissions: List<SubmissionDto>
)

@Serializable
data class MistakesCacheDto(
    val items: List<MistakeItemDto>,
    val counts: MistakeCountsDto?
)

/**
 * 轻量首屏本地缓存管理器（启动不转圈，后台静默刷新）：
 * - 单文件单屏，JSON 文本存储于 cacheDir，严格上限总计 <= 200 KB。
 * - 键绑定用户与服务器地址哈希，不含 Token/密码/明文。
 * - 超过 7 天视作无效自动丢弃；带版本号，异常安全，不崩溃。
 * - 读写均强制运行于 Dispatchers.IO，不阻塞主线程。
 */
object AppDiskCache {
    private const val CURRENT_VERSION = 1
    private const val MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000L // 7 天时效
    private const val MAX_TOTAL_BYTES = 200 * 1024L // 严格 200 KB 上限

    fun computeCacheKey(userId: Long, serverUrl: String): String {
        val cleanUrl = serverUrl.trim().trimEnd('/')
        val raw = "${userId}_$cleanUrl"
        val bytes = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        return bytes.take(8).joinToString("") { "%02x".format(it) }
    }

    private fun getFile(context: Context, key: String, screen: String): File {
        return File(context.cacheDir, "cache_${key}_${screen}.json")
    }

    private inline fun <reified T> readEnvelope(context: Context, key: String, screen: String): T? {
        val file = getFile(context, key, screen)
        if (!file.exists()) return null

        try {
            val now = System.currentTimeMillis()
            if (now - file.lastModified() > MAX_AGE_MS) {
                file.delete()
                return null
            }

            val content = file.readText(Charsets.UTF_8)
            val envelope = appJson.decodeFromString<CacheEnvelope<T>>(content)

            if (envelope.version != CURRENT_VERSION || envelope.keyHash != key) {
                file.delete()
                return null
            }

            if (now - envelope.timestamp > MAX_AGE_MS) {
                file.delete()
                return null
            }

            return envelope.data
        } catch (_: Exception) {
            // 解析失败、结构不符、损坏文件直接清理，绝不崩溃
            try { file.delete() } catch (_: Exception) {}
            return null
        }
    }

    private inline fun <reified T> writeEnvelope(context: Context, key: String, screen: String, data: T) {
        val file = getFile(context, key, screen)
        val tmpFile = File(context.cacheDir, "cache_${key}_${screen}.tmp")

        try {
            ensureCapacity(context, 32 * 1024L) // 预留空间

            val envelope = CacheEnvelope(
                version = CURRENT_VERSION,
                timestamp = System.currentTimeMillis(),
                keyHash = key,
                data = data
            )
            val jsonStr = appJson.encodeToString(envelope)
            val bytes = jsonStr.toByteArray(Charsets.UTF_8)

            FileOutputStream(tmpFile).use { out ->
                out.write(bytes)
                out.flush()
            }

            if (tmpFile.exists()) {
                if (file.exists()) file.delete()
                tmpFile.renameTo(file)
            }
        } catch (_: Exception) {
            try { tmpFile.delete() } catch (_: Exception) {}
        }
    }

    /**
     * 淘汰最旧的缓存文件以保持总容量低于 200 KB
     */
    private fun ensureCapacity(context: Context, neededBytes: Long) {
        val cacheFiles = context.cacheDir.listFiles { _, name ->
            name.startsWith("cache_") && name.endsWith(".json")
        } ?: return

        var total = cacheFiles.sumOf { it.length() }
        if (total + neededBytes <= MAX_TOTAL_BYTES) return

        // 按最后修改时间升序排列，先淘汰最老的文件
        val sorted = cacheFiles.sortedBy { it.lastModified() }
        for (f in sorted) {
            total -= f.length()
            f.delete()
            if (total + neededBytes <= MAX_TOTAL_BYTES) break
        }
    }

    suspend fun writeOverview(context: Context, key: String, data: OverviewCacheDto) = withContext(Dispatchers.IO) {
        writeEnvelope(context, key, "overview", data)
    }

    suspend fun readOverview(context: Context, key: String): OverviewCacheDto? = withContext(Dispatchers.IO) {
        readEnvelope(context, key, "overview")
    }

    suspend fun writeContests(context: Context, key: String, data: ContestsCacheDto) = withContext(Dispatchers.IO) {
        writeEnvelope(context, key, "contests", data)
    }

    suspend fun readContests(context: Context, key: String): ContestsCacheDto? = withContext(Dispatchers.IO) {
        readEnvelope(context, key, "contests")
    }

    suspend fun writeSubmissions(context: Context, key: String, data: SubmissionsCacheDto) = withContext(Dispatchers.IO) {
        writeEnvelope(context, key, "submissions", data)
    }

    suspend fun readSubmissions(context: Context, key: String): SubmissionsCacheDto? = withContext(Dispatchers.IO) {
        readEnvelope(context, key, "submissions")
    }

    suspend fun writeMistakes(context: Context, key: String, data: MistakesCacheDto) = withContext(Dispatchers.IO) {
        writeEnvelope(context, key, "mistakes", data)
    }

    suspend fun readMistakes(context: Context, key: String): MistakesCacheDto? = withContext(Dispatchers.IO) {
        readEnvelope(context, key, "mistakes")
    }

    fun clearAllCache(context: Context) {
        try {
            context.cacheDir.listFiles { _, name ->
                name.startsWith("cache_") && (name.endsWith(".json") || name.endsWith(".tmp"))
            }?.forEach { it.delete() }
        } catch (_: Exception) {}
    }

    fun getCacheDirectorySizeBytes(context: Context): Long {
        return context.cacheDir.listFiles { _, name ->
            name.startsWith("cache_") && name.endsWith(".json")
        }?.sumOf { it.length() } ?: 0L
    }

    fun getCacheFileCount(context: Context): Int {
        return context.cacheDir.listFiles { _, name ->
            name.startsWith("cache_") && name.endsWith(".json")
        }?.size ?: 0
    }
}
