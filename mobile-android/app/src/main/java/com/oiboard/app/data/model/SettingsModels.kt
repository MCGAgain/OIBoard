package com.oiboard.app.data.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

object IntAsBooleanSerializer : KSerializer<Boolean> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("IntAsBoolean", PrimitiveKind.BOOLEAN)

    override fun serialize(encoder: Encoder, value: Boolean) {
        encoder.encodeBoolean(value)
    }

    override fun deserialize(decoder: Decoder): Boolean {
        val input = decoder as? JsonDecoder ?: return decoder.decodeBoolean()
        val element = input.decodeJsonElement()
        return when (element) {
            is JsonPrimitive -> {
                element.booleanOrNull ?: (element.intOrNull?.let { it != 0 } ?: false)
            }
            else -> false
        }
    }
}

@Serializable
data class AccountItemDto(
    val id: Int = 0,
    val user_id: Int = 0,
    val platform: String = "",
    val handle: String = "",
    val alias: String? = null,
    @Serializable(with = IntAsBooleanSerializer::class)
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
