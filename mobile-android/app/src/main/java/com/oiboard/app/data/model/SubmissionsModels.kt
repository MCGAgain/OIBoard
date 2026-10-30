package com.oiboard.app.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Immutable
@Serializable
data class SubmissionsResponse(
    val submissions: List<SubmissionDto> = emptyList()
)

@Immutable
@Serializable
data class SubmissionDto(
    val id: String = "",
    val user_id: Int = 0,
    val platform: String = "",
    val raw_id: String? = null,
    val problem_id: String = "",
    val problem_title: String = "",
    val verdict: String = "",
    val tags: List<String> = emptyList(),
    val difficulty: String? = null,
    val difficulty_score: Int? = null,
    val submitted_at: String = "",
    val submission_url: String? = null,
    val code_language: String? = null
)

@Serializable
data class MistakeKeysResponse(
    val keys: List<String> = emptyList()
)

@Serializable
data class MistakeCreateRequest(
    val platform: String,
    val problem_id: String,
    val problem_title: String,
    val difficulty: String = "",
    val tags: List<String> = emptyList(),
    val key_point: String = "",
    val notes: String = "",
    val problem_url: String = "",
    val last_submitted_at: String = "",
    val last_submission_id: String = ""
)

@Serializable
data class MistakeCreateResponse(
    val success: Boolean = false,
    val message: String? = null
)
