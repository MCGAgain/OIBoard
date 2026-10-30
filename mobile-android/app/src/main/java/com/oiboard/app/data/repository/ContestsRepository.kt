package com.oiboard.app.data.repository

import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ContestsResponse
import com.oiboard.app.data.remote.ContestSyncResponse
import com.oiboard.app.data.remote.ContestsApi

class ContestsRepository(
    private val contestsApi: ContestsApi
) {
    suspend fun getContests(platform: String = "all", limit: Int = 60): ApiResult<ContestsResponse> {
        return contestsApi.getContests(platform = platform, limit = limit)
    }

    suspend fun syncContests(platform: String = "all"): ApiResult<ContestSyncResponse> {
        return contestsApi.syncContests(platform = platform)
    }
}
