package com.oiboard.app.data.repository

import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.MistakeCreateRequest
import com.oiboard.app.data.model.MistakeCreateResponse
import com.oiboard.app.data.model.MistakeUpdateRequest
import com.oiboard.app.data.model.MistakesResponse
import com.oiboard.app.data.model.SimpleSuccessResponse
import com.oiboard.app.data.remote.MistakesApi

class MistakesRepository(
    private val api: MistakesApi
) {
    suspend fun getMistakes(
        status: String = "all",
        search: String = "",
        page: Int = 1,
        pageSize: Int = 50
    ): ApiResult<MistakesResponse> {
        return api.getMistakes(status = status, search = search, page = page, pageSize = pageSize)
    }

    suspend fun addMistake(payload: MistakeCreateRequest): ApiResult<MistakeCreateResponse> {
        return api.addMistake(payload)
    }

    suspend fun updateMistake(mistakeId: Int, payload: MistakeUpdateRequest): ApiResult<SimpleSuccessResponse> {
        return api.updateMistake(mistakeId, payload)
    }

    suspend fun reviewMistake(mistakeId: Int): ApiResult<SimpleSuccessResponse> {
        return api.reviewMistake(mistakeId)
    }

    suspend fun toggleMaster(mistakeId: Int, mastered: Boolean? = null): ApiResult<SimpleSuccessResponse> {
        return api.toggleMaster(mistakeId, mastered)
    }

    suspend fun deleteMistake(mistakeId: Int): ApiResult<SimpleSuccessResponse> {
        return api.deleteMistake(mistakeId)
    }
}
