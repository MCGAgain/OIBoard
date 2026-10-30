package com.oiboard.app.data.remote

import com.oiboard.app.data.local.UserPreferencesRepository
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Response
import java.util.concurrent.TimeUnit

val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

val appJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
}

class BaseUrlInterceptor(private val prefs: UserPreferencesRepository) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        var request = chain.request()
        val baseHttpUrl = prefs.currentServerUrl.toHttpUrlOrNull()
        if (baseHttpUrl != null) {
            val builder = request.url.newBuilder()
                .scheme(baseHttpUrl.scheme)
                .host(baseHttpUrl.host)
                .port(baseHttpUrl.port)

            val basePath = baseHttpUrl.encodedPath.trimEnd('/')
            if (basePath.isNotBlank() && basePath != "/") {
                builder.encodedPath(basePath + request.url.encodedPath)
            }
            request = request.newBuilder().url(builder.build()).build()
        }
        return chain.proceed(request)
    }
}

class AuthInterceptor(
    private val prefs: UserPreferencesRepository,
    private val onUnauthorized: () -> Unit
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val requestBuilder = request.newBuilder()

        val token = prefs.currentToken
        if (!token.isNullOrBlank() && request.header("Authorization") == null) {
            requestBuilder.header("Authorization", "Bearer $token")
        }

        val response = chain.proceed(requestBuilder.build())
        if (response.code == 401) {
            onUnauthorized()
        }
        return response
    }
}

fun createOkHttpClient(
    prefs: UserPreferencesRepository,
    onUnauthorized: () -> Unit
): OkHttpClient {
    return OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .addInterceptor(BaseUrlInterceptor(prefs))
        .addInterceptor(AuthInterceptor(prefs, onUnauthorized))
        .retryOnConnectionFailure(true)
        .build()
}
