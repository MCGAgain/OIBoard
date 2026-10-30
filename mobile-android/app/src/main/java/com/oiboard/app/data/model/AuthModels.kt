package com.oiboard.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class CaptchaResponse(
    val captcha_id: String,
    val captcha_image: String
)

@Serializable
data class UserDto(
    val id: Long,
    val username: String,
    val created_at: String? = null
)

@Serializable
data class AuthResponse(
    val success: Boolean,
    val message: String,
    val token: String? = null,
    val user: UserDto? = null
)

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    val captcha_id: String = "",
    val captcha_code: String = ""
)

@Serializable
data class RegisterRequest(
    val username: String,
    val password: String,
    val captcha_id: String = "",
    val captcha_code: String = ""
)

@Serializable
data class UserWrapperResponse(
    val user: UserDto
)

@Serializable
data class GenericResponse(
    val success: Boolean,
    val message: String? = null
)

@Serializable
data class ErrorDetailResponse(
    val detail: String? = null,
    val message: String? = null
)

sealed interface ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>
    data class Error(val code: Int, val message: String) : ApiResult<Nothing>
    data class NetworkError(val exception: Throwable) : ApiResult<Nothing>
}
