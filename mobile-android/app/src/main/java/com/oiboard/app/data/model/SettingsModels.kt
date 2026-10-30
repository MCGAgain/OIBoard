package com.oiboard.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class AccountItemDto(
    val id: Int = 0,
    val user_id: Int = 0,
    val platform: String = "",
    val handle: String = "",
    val alias: String? = null,
    val is_primary: Boolean = false,
    val cookie: String? = null
)

@Serializable
data class AccountsResponse(
    val accounts: List<AccountItemDto> = emptyList()
)

@Serializable
data class AddAccountRequest(
    val platform: String,
    val handle: String,
    val cookie: String = "",
    val alias: String = "",
    val is_primary: Boolean = false
)

@Serializable
data class UpdateAccountRequest(
    val handle: String? = null,
    val cookie: String? = null,
    val alias: String? = null,
    val is_primary: Boolean? = null
)

@Serializable
data class VerifyAccountRequest(
    val platform: String,
    val handle: String,
    val cookie: String = "",
    val http_proxy: String = ""
)

@Serializable
data class VerifyAccountResponse(
    val valid: Boolean = false,
    val message: String = ""
)

@Serializable
data class SettingsResponse(
    val configs: Map<String, String> = emptyMap()
)

@Serializable
data class SettingsUpdateRequest(
    val poll_interval_minutes: String? = null,
    val sprint_mode: String? = null,
    val http_proxy: String? = null
)

@Serializable
data class ChangePasswordRequest(
    val old_password: String,
    val new_password: String
)
