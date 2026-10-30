package com.oiboard.app.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Immutable
@Serializable
data class MistakesResponse(
    val items: List<MistakeItemDto> = emptyList(),
    val total: Int = 0,
    val counts: MistakeCountsDto = MistakeCountsDto()
)

@Immutable
@Serializable
data class MistakeCountsDto(
    val total: Int = 0,
    val due: Int = 0,
    val in_progress: Int = 0,
    val mastered: Int = 0
)

@Immutable
@Serializable
data class MistakeItemDto(
    val id: Int,
    val user_id: Int = 0,
    val platform: String = "",
    val problem_id: String = "",
    val problem_title: String = "",
    val difficulty: String? = null,
    val tags: List<String> = emptyList(),
    val key_point: String? = null,
    val notes: String? = null,
    val problem_url: String? = null,
    val last_submitted_at: String? = null,
    val last_submission_id: String? = null,
    val status: String = "pending_review",
    val review_count: Int = 0,
    val last_reviewed_at: String? = null,
    val next_review_at: String? = null,
    val is_due: Boolean = false,
    val days_left: Int? = null
)

@Serializable
data class SimpleSuccessResponse(
    val success: Boolean = false,
    val message: String? = null
)

@Serializable
data class MistakeUpdateRequest(
    val key_point: String? = null,
    val notes: String? = null,
    val tags: List<String>? = null,
    val problem_url: String? = null,
    val status: String? = null
)
