package com.oiboard.app.data.remote

import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.AuthResponse
import com.oiboard.app.data.model.CaptchaResponse
import com.oiboard.app.data.model.ErrorDetailResponse
import com.oiboard.app.data.model.LoginRequest
import com.oiboard.app.data.model.RegisterRequest
import com.oiboard.app.data.model.UserDto
import com.oiboard.app.data.model.UserWrapperResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

class AuthApi(
    private val client: OkHttpClient
) {
    suspend fun getCaptcha(): ApiResult<CaptchaResponse> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/auth/captcha") // Scheme and host will be rewritten by BaseUrlInterceptor
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<CaptchaResponse>(body)
        }
    }

    suspend fun login(req: LoginRequest): ApiResult<AuthResponse> = withContext(Dispatchers.IO) {
        val jsonBody = appJson.encodeToString(req).toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("http://localhost/api/auth/login")
            .post(jsonBody)
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<AuthResponse>(body)
        }
    }

    suspend fun register(req: RegisterRequest): ApiResult<AuthResponse> = withContext(Dispatchers.IO) {
        val jsonBody = appJson.encodeToString(req).toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("http://localhost/api/auth/register")
            .post(jsonBody)
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<AuthResponse>(body)
        }
    }

    suspend fun getMe(): ApiResult<UserDto> = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("http://localhost/api/auth/me")
            .get()
            .build()

        executeRequest(request) { body ->
            appJson.decodeFromString<UserWrapperResponse>(body).user
        }
    }

    suspend fun logout(): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val jsonBody = "{}".toRequestBody(JSON_MEDIA_TYPE)
        val request = Request.Builder()
            .url("http://localhost/api/auth/logout")
            .post(jsonBody)
            .build()

        executeRequest(request) {
            Unit
        }
    }

    private inline fun <T> executeRequest(
        request: Request,
        parser: (String) -> T
    ): ApiResult<T> {
        return try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string() ?: ""
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
            ApiResult.NetworkError(e)
        } catch (e: Exception) {
            ApiResult.Error(-1, e.message ?: "未知网络错误")
        }
    }
}
