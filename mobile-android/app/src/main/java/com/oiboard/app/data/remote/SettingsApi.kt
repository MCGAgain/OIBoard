package com.oiboard.app.data.remote

import com.oiboard.app.data.model.AccountsResponse
import com.oiboard.app.data.model.AddAccountRequest
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ChangePasswordRequest
import com.oiboard.app.data.model.ErrorDetailResponse
import com.oiboard.app.data.model.SettingsResponse
import com.oiboard.app.data.model.SettingsUpdateRequest
import com.oiboard.app.data.model.SimpleSuccessResponse
import com.oiboard.app.data.model.UpdateAccountRequest
import com.oiboard.app.data.model.VerifyAccountRequest
import com.oiboard.app.data.model.VerifyAccountResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

class SettingsApi(
    private val client: OkHttpClient
) {
    suspend fun getAccounts(): ApiResult<AccountsResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/accounts")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<AccountsResponse>(body)
        }
    }

    suspend fun addAccount(payload: AddAccountRequest): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val json = appJson.encodeToString(AddAccountRequest.serializer(), payload)
        val request = Request.Builder()
            .url("http://localhost/api/accounts")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun updateAccount(accountId: Int, payload: UpdateAccountRequest): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val json = appJson.encodeToString(UpdateAccountRequest.serializer(), payload)
        val request = Request.Builder()
            .url("http://localhost/api/accounts/$accountId")
            .put(json.toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun deleteAccount(accountId: Int): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/accounts/$accountId")
            .delete()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun setPrimaryAccount(accountId: Int): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/accounts/$accountId/primary")
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun syncSingleAccount(accountId: Int): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/accounts/$accountId/sync")
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun verifyAccount(payload: VerifyAccountRequest): ApiResult<VerifyAccountResponse> = withContext(Dispatchers.IO) {
        val json = appJson.encodeToString(VerifyAccountRequest.serializer(), payload)
        val request = Request.Builder()
            .url("http://localhost/api/accounts/verify")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<VerifyAccountResponse>(body)
        }
    }

    suspend fun getSettings(): ApiResult<SettingsResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/settings")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SettingsResponse>(body)
        }
    }

    suspend fun updateSettings(payload: SettingsUpdateRequest): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val json = appJson.encodeToString(SettingsUpdateRequest.serializer(), payload)
        val request = Request.Builder()
            .url("http://localhost/api/settings")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun triggerSyncAll(): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/sync")
            .post("""{"platform":"all"}""".toRequestBody("application/json".toMediaType()))
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<SimpleSuccessResponse>(body)
        }
    }

    suspend fun changePassword(payload: ChangePasswordRequest): ApiResult<SimpleSuccessResponse> = withContext(Dispatchers.IO) {
        val json = appJson.encodeToString(ChangePasswordRequest.serializer(), payload)
        val request = Request.Builder()
            .url("http://localhost/api/auth/password")
            .post(json.toRequestBody("application/json".toMediaType()))
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
