package com.oiboard.app.data.remote

import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ContestsResponse
import com.oiboard.app.data.model.ErrorDetailResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

@Serializable
data class ContestSyncResponse(
    val success: Boolean = false,
    val count: Int = 0,
    val message: String = ""
)

class ContestsApi(
    private val client: OkHttpClient
) {
    suspend fun getContests(platform: String = "all", limit: Int = 60): ApiResult<ContestsResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/contests?platform=$platform&limit=$limit")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<ContestsResponse>(body)
        }
    }

    suspend fun syncContests(platform: String = "all"): ApiResult<ContestSyncResponse> = withContext(Dispatchers.IO) {
        val jsonBody = """{"platform":"$platform"}"""
        val request = Request.Builder()
            .url("http://localhost/api/contests/sync")
            .post(jsonBody.toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<ContestSyncResponse>(body)
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
