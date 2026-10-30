package com.oiboard.app.data.repository

import com.oiboard.app.data.model.AccountsResponse
import com.oiboard.app.data.model.AddAccountRequest
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ChangePasswordRequest
import com.oiboard.app.data.model.SettingsResponse
import com.oiboard.app.data.model.SettingsUpdateRequest
import com.oiboard.app.data.model.SimpleSuccessResponse
import com.oiboard.app.data.model.UpdateAccountRequest
import com.oiboard.app.data.model.VerifyAccountRequest
import com.oiboard.app.data.model.VerifyAccountResponse
import com.oiboard.app.data.remote.SettingsApi

class SettingsRepository(
    private val api: SettingsApi
) {
    suspend fun getAccounts(): ApiResult<AccountsResponse> = api.getAccounts()
    suspend fun addAccount(payload: AddAccountRequest): ApiResult<SimpleSuccessResponse> = api.addAccount(payload)
    suspend fun updateAccount(accountId: Int, payload: UpdateAccountRequest): ApiResult<SimpleSuccessResponse> = api.updateAccount(accountId, payload)
    suspend fun deleteAccount(accountId: Int): ApiResult<SimpleSuccessResponse> = api.deleteAccount(accountId)
    suspend fun setPrimaryAccount(accountId: Int): ApiResult<SimpleSuccessResponse> = api.setPrimaryAccount(accountId)
    suspend fun syncSingleAccount(accountId: Int): ApiResult<SimpleSuccessResponse> = api.syncSingleAccount(accountId)
    suspend fun verifyAccount(payload: VerifyAccountRequest): ApiResult<VerifyAccountResponse> = api.verifyAccount(payload)
    suspend fun getSettings(): ApiResult<SettingsResponse> = api.getSettings()
    suspend fun updateSettings(payload: SettingsUpdateRequest): ApiResult<SimpleSuccessResponse> = api.updateSettings(payload)
    suspend fun triggerSyncAll(): ApiResult<SimpleSuccessResponse> = api.triggerSyncAll()
    suspend fun changePassword(payload: ChangePasswordRequest): ApiResult<SimpleSuccessResponse> = api.changePassword(payload)
}
