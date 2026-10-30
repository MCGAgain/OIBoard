package com.oiboard.app.data.remote

import android.util.JsonReader
import android.util.JsonToken
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ErrorDetailResponse
import com.oiboard.app.data.model.MistakeCreateRequest
import com.oiboard.app.data.model.MistakeCreateResponse
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.MistakeKeysResponse
import com.oiboard.app.data.model.MistakesResponse
import com.oiboard.app.data.model.SubmissionDto
import com.oiboard.app.data.model.SubmissionsResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.io.InputStream
import java.io.InputStreamReader

class SubmissionsApi(
    private val client: OkHttpClient
) {
    suspend fun getSubmissions(platform: String = "all", limit: Int = 100): ApiResult<SubmissionsResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/stats/submissions?platform=$platform&limit=$limit")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SubmissionsResponse>(body)
        }
    }

    /**
     * 流式解析提交记录：
     * 1. 直接读取 OkHttp 的 byteStream，不将完整 JSON (如 874KB) 加载到内存 String 中。
     * 2. 边流式反序列化边通过 predicate 进行实时筛选，只把符合条件的条目保留在内存中，严格限制最多 maxResults 条 (150)。
     * 3. 在扫描流的过程中实时提取所有唯一的标签列表，供 UI 筛选器使用。
     */
    suspend fun getSubmissionsStream(
        platform: String = "all",
        limit: Int = 100,
        predicate: ((SubmissionDto) -> Boolean)? = null,
        maxResults: Int = 150
    ): ApiResult<Pair<List<SubmissionDto>, List<String>>> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/stats/submissions?platform=$platform&limit=$limit")
            .get()
            .build()

        val startTime = System.currentTimeMillis()
        val pathWithQuery = request.url.encodedPath + (if (request.url.encodedQuery != null) "?${request.url.encodedQuery}" else "")

        try {
            client.newCall(request).execute().use { response ->
                val responseBody = response.body
                if (!response.isSuccessful || responseBody == null) {
                    val code = response.code
                    NetworkMetricsTracker.record(
                        method = request.method,
                        pathWithQuery = pathWithQuery,
                        statusCode = code,
                        responseBytes = 0L,
                        durationMs = System.currentTimeMillis() - startTime
                    )
                    return@withContext ApiResult.Error(code, "请求失败 ($code)")
                }

                val countingStream = CountingInputStream(responseBody.byteStream())
                val reader = JsonReader(InputStreamReader(countingStream, Charsets.UTF_8))

                val matchedList = ArrayList<SubmissionDto>(maxResults)
                val allTags = HashSet<String>()

                reader.beginObject()
                while (reader.hasNext()) {
                    val key = reader.nextName()
                    if (key == "submissions" && reader.peek() == JsonToken.BEGIN_ARRAY) {
                        reader.beginArray()
                        while (reader.hasNext()) {
                            val item = readSingleSubmission(reader)
                            if (item.tags.isNotEmpty()) {
                                for (t in item.tags) {
                                    if (t.isNotBlank()) allTags.add(t)
                                }
                            }
                            if (predicate == null || predicate(item)) {
                                if (matchedList.size < maxResults) {
                                    matchedList.add(item)
                                }
                            }
                        }
                        reader.endArray()
                    } else {
                        reader.skipValue()
                    }
                }
                reader.endObject()

                val bytesRead = countingStream.bytesRead
                val duration = System.currentTimeMillis() - startTime
                NetworkMetricsTracker.record(
                    method = request.method,
                    pathWithQuery = pathWithQuery,
                    statusCode = response.code,
                    responseBytes = bytesRead,
                    durationMs = duration
                )

                ApiResult.Success(Pair(matchedList, allTags.sorted()))
            }
        } catch (e: IOException) {
            NetworkMetricsTracker.record(
                method = request.method,
                pathWithQuery = pathWithQuery,
                statusCode = -1,
                responseBytes = 0L,
                durationMs = System.currentTimeMillis() - startTime
            )
            ApiResult.NetworkError(e)
        } catch (e: Exception) {
            ApiResult.Error(-1, e.message ?: "未知解析错误")
        }
    }

    private fun readSingleSubmission(reader: JsonReader): SubmissionDto {
        var id = ""
        var userId = 0
        var platform = ""
        var rawId: String? = null
        var problemId = ""
        var problemTitle = ""
        var verdict = ""
        val tags = mutableListOf<String>()
        var difficulty: String? = null
        var difficultyScore: Int? = null
        var submittedAt = ""
        var submissionUrl: String? = null
        var codeLanguage: String? = null

        reader.beginObject()
        while (reader.hasNext()) {
            val name = reader.nextName()
            if (reader.peek() == JsonToken.NULL) {
                reader.nextNull()
                continue
            }
            when (name) {
                "id" -> {
                    id = if (reader.peek() == JsonToken.NUMBER) {
                        reader.nextLong().toString()
                    } else {
                        reader.nextString()
                    }
                }
                "user_id" -> userId = reader.nextInt()
                "platform" -> platform = reader.nextString()
                "raw_id" -> rawId = reader.nextString()
                "problem_id" -> problemId = reader.nextString()
                "problem_title" -> problemTitle = reader.nextString()
                "verdict" -> verdict = reader.nextString()
                "tags" -> {
                    reader.beginArray()
                    while (reader.hasNext()) {
                        if (reader.peek() == JsonToken.STRING) {
                            tags.add(reader.nextString())
                        } else {
                            reader.skipValue()
                        }
                    }
                    reader.endArray()
                }
                "difficulty" -> difficulty = reader.nextString()
                "difficulty_score" -> difficultyScore = reader.nextInt()
                "submitted_at" -> submittedAt = reader.nextString()
                "submission_url" -> submissionUrl = reader.nextString()
                "code_language" -> codeLanguage = reader.nextString()
                else -> reader.skipValue()
            }
        }
        reader.endObject()

        return SubmissionDto(
            id = id,
            user_id = userId,
            platform = platform,
            raw_id = rawId,
            problem_id = problemId,
            problem_title = problemTitle,
            verdict = verdict,
            tags = tags,
            difficulty = difficulty,
            difficulty_score = difficultyScore,
            submitted_at = submittedAt,
            submission_url = submissionUrl,
            code_language = codeLanguage
        )
    }

    suspend fun getMistakeKeys(): ApiResult<MistakeKeysResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/mistakes/keys")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<MistakeKeysResponse>(body)
        }
    }

    /**
     * 按平台与确切题目 ID 匹配错题详情，杜绝跨平台同名题号冲突 (如 AcWing 1001 vs 洛谷 1001)
     */
    suspend fun getMistakeDetail(platform: String, problemId: String): ApiResult<MistakeItemDto?> = withContext(Dispatchers.IO) {
        val encodedPlatform = java.net.URLEncoder.encode(platform, "UTF-8")
        val encodedProblemId = java.net.URLEncoder.encode(problemId, "UTF-8")
        val request = Request.Builder()
            .url("http://localhost/api/mistakes?platform=$encodedPlatform&search=$encodedProblemId&page=1&page_size=20")
            .get()
            .build()

        executeRequest(request) { body ->
            val resp = appJson.decodeFromString<MistakesResponse>(body)
            resp.items.firstOrNull {
                it.platform.equals(platform, ignoreCase = true) &&
                        it.problem_id.equals(problemId, ignoreCase = true)
            }
        }
    }

    suspend fun addMistake(payload: MistakeCreateRequest): ApiResult<MistakeCreateResponse> = withContext(Dispatchers.IO) {
        val json = appJson.encodeToString(MistakeCreateRequest.serializer(), payload)
        val request = Request.Builder()
            .url("http://localhost/api/mistakes")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<MistakeCreateResponse>(body)
        }
    }

    private inline fun <T> executeRequest(
        request: Request,
        parser: (String) -> T
    ): ApiResult<T> {
        val startTime = System.currentTimeMillis()
        val pathWithQuery = request.url.encodedPath + (if (request.url.encodedQuery != null) "?${request.url.encodedQuery}" else "")
        return try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string() ?: ""
                val bytes = body.toByteArray(Charsets.UTF_8).size.toLong()
                val duration = System.currentTimeMillis() - startTime
                NetworkMetricsTracker.record(
                    method = request.method,
                    pathWithQuery = pathWithQuery,
                    statusCode = response.code,
                    responseBytes = bytes,
                    durationMs = duration
                )

                if (response.isSuccessful) {
                    try {
                        val parsed = parser(body)
                        ApiResult.Success(parsed)
                    } catch (e: Exception) {
                        ApiResult.Error(response.code, "数据解析异常: ${e.message}")
                    }
                } else {
                    val errorMsg = try {
                        val errObj = appJson.decodeFromString<ErrorDetailResponse>(body)
                        errObj.detail ?: errObj.message ?: "请求失败 (${response.code})"
                    } catch (_: Exception) {
                        "请求失败 (${response.code})"
                    }
                    ApiResult.Error(response.code, errorMsg)
                }
            }
        } catch (e: IOException) {
            val duration = System.currentTimeMillis() - startTime
            NetworkMetricsTracker.record(
                method = request.method,
                pathWithQuery = pathWithQuery,
                statusCode = -1,
                responseBytes = 0L,
                durationMs = duration
            )
            ApiResult.NetworkError(e)
        } catch (e: Exception) {
            ApiResult.Error(-1, e.message ?: "未知网络错误")
        }
    }

    private class CountingInputStream(private val wrapped: InputStream) : InputStream() {
        var bytesRead: Long = 0L
            private set

        override fun read(): Int {
            val b = wrapped.read()
            if (b != -1) bytesRead++
            return b
        }

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            val r = wrapped.read(b, off, len)
            if (r != -1) bytesRead += r
            return r
        }

        override fun close() {
            wrapped.close()
        }
    }
}
