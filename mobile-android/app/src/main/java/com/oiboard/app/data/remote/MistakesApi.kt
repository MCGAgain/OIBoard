package com.oiboard.app.data.remote

import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ErrorDetailResponse
import com.oiboard.app.data.model.MistakeCreateRequest
import com.oiboard.app.data.model.MistakeCreateResponse
import com.oiboard.app.data.model.MistakeUpdateRequest
import com.oiboard.app.data.model.MistakesResponse
import com.oiboard.app.data.model.SimpleSuccessResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.URLEncoder

class MistakesApi(
    private val client: OkHttpClient
) {
    suspend fun getMistakes(
        status: String = "all",
        search: String = "",
        page: Int = 1,
        pageSize: Int = 50
    ): ApiResult<MistakesResponse> = withContext(Dispatchers.IO) {
        val encodedSearch = URLEncoder.encode(search, "UTF-8")
        val url = "http://localhost/api/mistakes?status=$status&search=$encodedSearch&page=$page&page_size=$pageSize"
        val request = Request.Builder()
            .url(url)
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<MistakesResponse>(body)
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

    suspend fun updateMistake(mistakeId: Int, payload: MistakeUpdateRequest): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val json = appJson.encodeToString(MistakeUpdateRequest.serializer(), payload)
        val request = Request.Builder()
            .url("http://localhost/api/mistakes/$mistakeId")
            .put(json.toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun reviewMistake(mistakeId: Int): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/mistakes/$mistakeId/review")
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun toggleMaster(mistakeId: Int, mastered: Boolean? = null): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val json = if (mastered != null) """{"mastered":$mastered}""" else "{}"
        val request = Request.Builder()
            .url("http://localhost/api/mistakes/$mistakeId/toggle-master")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun deleteMistake(mistakeId: Int): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/mistakes/$mistakeId")
            .delete()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
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
