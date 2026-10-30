package com.oiboard.app.data.repository

import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ContestsResponse
import com.oiboard.app.data.model.HeatmapResponse
import com.oiboard.app.data.model.StatsOverviewResponse
import com.oiboard.app.data.model.TagStatsResponse
import com.oiboard.app.data.remote.StatsApi

class StatsRepository(
    private val statsApi: StatsApi
) {
    suspend fun getOverview(): ApiResult<StatsOverviewResponse> {
        return statsApi.getOverview()
    }

    suspend fun getHeatmap(year: Int? = null, platform: String = "all"): ApiResult<HeatmapResponse> {
        return statsApi.getHeatmap(year = year, platform = platform)
    }

    suspend fun getUpcomingContests(limit: Int = 3): ApiResult<ContestsResponse> {
        return statsApi.getUpcomingContests(limit = limit)
    }

    suspend fun getTags(): ApiResult<TagStatsResponse> {
        return statsApi.getTags()
    }
}
