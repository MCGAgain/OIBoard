package com.oiboard.app.data.repository

import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.MistakeCreateRequest
import com.oiboard.app.data.model.MistakeCreateResponse
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.MistakeKeysResponse
import com.oiboard.app.data.model.SubmissionDto
import com.oiboard.app.data.model.SubmissionsResponse
import com.oiboard.app.data.remote.SubmissionsApi

class SubmissionsRepository(
    private val api: SubmissionsApi
) {
    suspend fun getSubmissions(platform: String = "all", limit: Int = 100): ApiResult<SubmissionsResponse> {
        return api.getSubmissions(platform = platform, limit = limit)
    }

    suspend fun getSubmissionsStream(
        platform: String = "all",
        limit: Int = 100,
        predicate: ((SubmissionDto) -> Boolean)? = null,
        maxResults: Int = 150
    ): ApiResult<Pair<List<SubmissionDto>, List<String>>> {
        return api.getSubmissionsStream(platform = platform, limit = limit, predicate = predicate, maxResults = maxResults)
    }

    suspend fun getMistakeKeys(): ApiResult<MistakeKeysResponse> {
        return api.getMistakeKeys()
    }

    suspend fun getMistakeDetail(platform: String, problemId: String): ApiResult<MistakeItemDto?> {
        return api.getMistakeDetail(platform = platform, problemId = problemId)
    }

    suspend fun addMistake(payload: MistakeCreateRequest): ApiResult<MistakeCreateResponse> {
        return api.addMistake(payload)
    }
}
