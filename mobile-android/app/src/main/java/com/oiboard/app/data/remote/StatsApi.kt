package com.oiboard.app.data.remote

import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ContestsResponse
import com.oiboard.app.data.model.ErrorDetailResponse
import com.oiboard.app.data.model.HeatmapResponse
import com.oiboard.app.data.model.StatsOverviewResponse
import com.oiboard.app.data.model.TagStatsResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

class StatsApi(
    private val client: OkHttpClient
) {
    suspend fun getOverview(): ApiResult<StatsOverviewResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/stats/overview")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<StatsOverviewResponse>(body)
        }
    }

    suspend fun getHeatmap(year: Int? = null, platform: String = "all"): ApiResult<HeatmapResponse> = withContext(Dispatchers.IO) {
        val url = StringBuilder("http://localhost/api/stats/heatmap?platform=$platform")
        if (year != null) {
            url.append("&year=$year")
        }
        val request = Request.Builder()
            .url(url.toString())
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<HeatmapResponse>(body)
        }
    }

    suspend fun getTags(): ApiResult<TagStatsResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/stats/tags")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<TagStatsResponse>(body)
        }
    }

    suspend fun getUpcomingContests(platform: String = "all", limit: Int = 3): ApiResult<ContestsResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/contests?platform=$platform&limit=$limit")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<ContestsResponse>(body)
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
}
