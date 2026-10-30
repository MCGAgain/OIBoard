package com.oiboard.app.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class StatsOverviewResponse(
    val stats: OverallStatsDto = OverallStatsDto(),
    val platforms_status: List<PlatformStatusDto> = emptyList(),
    val last_sync_time: String? = null,
    val climbing_curve: List<ClimbingCurvePointDto> = emptyList(),
    val daily_effort: List<DailyEffortPointDto> = emptyList(),
    val local_code: LocalCodeDto? = null
)

@Serializable
data class OverallStatsDto(
    val total_ac: Int = 0,
    val total_subs: Int = 0,
    val today_ac: Int = 0,
    val today_subs: Int = 0,
    val streak: Int = 0,
    val platforms: Map<String, PlatformStatsDto> = emptyMap()
)

@Serializable
data class PlatformStatsDto(
    val ac: Int = 0,
    val total: Int = 0
)

@Serializable
data class PlatformStatusDto(
    val id: Long = 0,
    val platform: String = "",
    val status: String = "",
    val message: String? = null,
    val rating: String? = null,
    val last_sync_time: String? = null,
    val updated_at: String? = null
)

@Serializable
data class ClimbingCurvePointDto(
    val date: String,
    @SerialName("ac")
    val ac: Int = 0,
    @SerialName("new_ac")
    val newAc: Int = 0,
    val cumulative_ac: Int = 0,
    val daily_new_ac: Int = 0
) {
    val totalAc: Int get() = if (ac != 0) ac else cumulative_ac
    val dailyNewAc: Int get() = if (newAc != 0) newAc else daily_new_ac
}

@Serializable
data class DailyEffortPointDto(
    val date: String,
    val total_subs: Int = 0,
    val unique_ac: Int = 0
)

@Serializable
data class LocalCodeDto(
    val total_lines: Int = 0,
    val today_lines: Int = 0,
    val total_files: Int = 0,
    val today_files: Int = 0,
    val c_lines: Int = 0,
    val cpp_lines: Int = 0,
    val java_lines: Int = 0,
    val has_data: Boolean = false,
    val synced_at: String? = null
)

@Serializable
data class HeatmapResponse(
    val heatmap: List<HeatmapDayDto> = emptyList(),
    val year: Int = 2026,
    val available_years: List<Int> = emptyList()
)

@Serializable
data class HeatmapDayDto(
    val date: String,
    val count: Int = 0,
    val unique_ac: Int = 0
)

@Serializable
data class TagStatsResponse(
    val tags: List<TagStatDto> = emptyList()
)

@Serializable
data class TagStatDto(
    val tag: String,
    val ac_count: Int = 0,
    val total_count: Int = 0
)

@Serializable
data class ContestsResponse(
    val contests: List<ContestDto> = emptyList()
)

@Immutable
@Serializable
data class ContestDto(
    val id: String,
    val platform: String,
    val contest_id: String? = null,
    val name: String,
    val start_time: String,
    val start_timestamp: Long = 0,
    val duration_seconds: Long = 0,
    val duration_str: String? = null,
    val duration_text: String? = null,
    val url: String = "",
    val phase: String = "BEFORE",
    val countdown_seconds: Long = 0,
    val status_text: String = "未开始",
    val rule_type: String? = null
)
