package com.oiboard.app.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.oiboard.app.data.local.AppCacheManager
import com.oiboard.app.data.local.CacheTarget
import com.oiboard.app.data.local.UserPreferencesRepository
import com.oiboard.app.data.model.AccountItemDto
import com.oiboard.app.data.model.AddAccountRequest
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ChangePasswordRequest
import com.oiboard.app.data.model.SettingsUpdateRequest
import com.oiboard.app.data.model.UpdateAccountRequest
import com.oiboard.app.data.model.VerifyAccountRequest
import com.oiboard.app.data.model.VerifyAccountResponse
import com.oiboard.app.data.repository.SettingsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SettingsUiState(
    val isLoading: Boolean = false,
    val accounts: List<AccountItemDto> = emptyList(),
    val pollInterval: String = "30",
    val sprintMode: Boolean = false,
    val httpProxy: String = "",
    val isSavingSettings: Boolean = false,
    // 弹窗状态
    val pendingDeleteAccount: AccountItemDto? = null,
    val pendingSetPrimary: AccountItemDto? = null,
    val pendingSyncAccount: AccountItemDto? = null,
    val showSyncAllDialog: Boolean = false,
    val showChangePasswordDialog: Boolean = false,
    val showAccountFormDialog: Boolean = false,
    val editingAccount: AccountItemDto? = null,
    val verifyResult: VerifyAccountResponse? = null,
    val isVerifying: Boolean = false,
    val actionMessage: String? = null
)

class SettingsViewModel(
    private val repository: SettingsRepository,
    private val prefs: UserPreferencesRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    companion object {
        fun provideFactory(
            repository: SettingsRepository,
            prefs: UserPreferencesRepository
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return SettingsViewModel(repository, prefs) as T
                }
            }
    }

    init {
        loadData()
    }

    fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // 1. 获取账号列表
            val accRes = repository.getAccounts()
            val accounts = if (accRes is ApiResult.Success) accRes.data.accounts else emptyList()

            // 2. 获取配置
            val setRes = repository.getSettings()
            var interval = "30"
            var sprint = false
            var proxy = ""
            if (setRes is ApiResult.Success) {
                val configs = setRes.data.configs
                interval = configs["poll_interval_minutes"] ?: "30"
                sprint = (configs["sprint_mode"] == "1" || configs["sprint_mode"].equals("true", ignoreCase = true))
                proxy = configs["http_proxy"] ?: ""
            }

            _uiState.update {
                it.copy(
                    isLoading = false,
                    accounts = accounts,
                    pollInterval = interval,
                    sprintMode = sprint,
                    httpProxy = proxy
                )
            }
        }
    }

    // 保存全局设置（二次确认）
    fun saveGlobalSettings(interval: String, sprint: Boolean, proxy: String) {
        _uiState.update { it.copy(isSavingSettings = true) }
        viewModelScope.launch {
            val req = SettingsUpdateRequest(
                poll_interval_minutes = interval.trim(),
                sprint_mode = if (sprint) "true" else "false",
                http_proxy = proxy.trim()
            )
            when (val res = repository.updateSettings(req)) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isSavingSettings = false,
                            pollInterval = interval.trim(),
                            sprintMode = sprint,
                            httpProxy = proxy.trim(),
                            actionMessage = "配置已保存"
                        )
                    }
                    AppCacheManager.invalidate(CacheTarget.OVERVIEW, CacheTarget.SUBMISSIONS, CacheTarget.CONTESTS)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isSavingSettings = false, actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSavingSettings = false, actionMessage = "保存失败: 网络错误") }
                }
            }
        }
    }

    // 全量同步（二次确认）
    fun showSyncAllDialog(show: Boolean) {
        _uiState.update { it.copy(showSyncAllDialog = show) }
    }

    fun confirmSyncAll() {
        _uiState.update { it.copy(showSyncAllDialog = false) }
        viewModelScope.launch {
            when (val res = repository.triggerSyncAll()) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(actionMessage = "已触发全量同步") }
                    AppCacheManager.invalidate(CacheTarget.OVERVIEW, CacheTarget.SUBMISSIONS, CacheTarget.CONTESTS)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(actionMessage = "同步触发失败: 网络错误") }
                }
            }
        }
    }

    // 账号增改弹窗控制
    fun openAccountForm(account: AccountItemDto? = null) {
        _uiState.update {
            it.copy(
                showAccountFormDialog = true,
                editingAccount = account,
                verifyResult = null
            )
        }
    }

    fun dismissAccountForm() {
        _uiState.update {
            it.copy(
                showAccountFormDialog = false,
                editingAccount = null,
                verifyResult = null
            )
        }
    }

    // 保存账号（添加或修改）
    fun saveAccount(platform: String, handle: String, cookie: String, alias: String, isPrimary: Boolean) {
        val editing = _uiState.value.editingAccount
        dismissAccountForm()

        viewModelScope.launch {
            if (editing != null) {
                val req = UpdateAccountRequest(
                    handle = handle.trim(),
                    cookie = cookie.trim(),
                    alias = alias.trim(),
                    is_primary = isPrimary
                )
                when (val res = repository.updateAccount(editing.id, req)) {
                    is ApiResult.Success -> {
                        _uiState.update { it.copy(actionMessage = "账号已更新") }
                        loadData()
                        AppCacheManager.invalidate(CacheTarget.OVERVIEW, CacheTarget.SUBMISSIONS, CacheTarget.CONTESTS)
                    }
                    is ApiResult.Error -> {
                        _uiState.update { it.copy(actionMessage = res.message) }
                    }
                    is ApiResult.NetworkError -> {
                        _uiState.update { it.copy(actionMessage = "更新失败: 网络错误") }
                    }
                }
            } else {
                val req = AddAccountRequest(
                    platform = platform.trim(),
                    handle = handle.trim(),
                    cookie = cookie.trim(),
                    alias = alias.trim(),
                    is_primary = isPrimary
                )
                when (val res = repository.addAccount(req)) {
                    is ApiResult.Success -> {
                        _uiState.update { it.copy(actionMessage = "账号已绑定") }
                        loadData()
                        AppCacheManager.invalidate(CacheTarget.OVERVIEW, CacheTarget.SUBMISSIONS, CacheTarget.CONTESTS)
                    }
                    is ApiResult.Error -> {
                        _uiState.update { it.copy(actionMessage = res.message) }
                    }
                    is ApiResult.NetworkError -> {
                        _uiState.update { it.copy(actionMessage = "绑定失败: 网络错误") }
                    }
                }
            }
        }
    }

    // 测试连通性
    fun verifyAccount(platform: String, handle: String, cookie: String, proxy: String) {
        _uiState.update { it.copy(isVerifying = true, verifyResult = null) }
        viewModelScope.launch {
            val req = VerifyAccountRequest(
                platform = platform.trim(),
                handle = handle.trim(),
                cookie = cookie.trim(),
                http_proxy = proxy.trim()
            )
            when (val res = repository.verifyAccount(req)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isVerifying = false, verifyResult = res.data) }
                }
                is ApiResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isVerifying = false,
                            verifyResult = VerifyAccountResponse(valid = false, message = res.message)
                        )
                    }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update {
                        it.copy(
                            isVerifying = false,
                            verifyResult = VerifyAccountResponse(valid = false, message = "验证失败: 网络错误")
                        )
                    }
                }
            }
        }
    }

    // 设为主账号（二次确认）
    fun requestSetPrimary(account: AccountItemDto) {
        _uiState.update { it.copy(pendingSetPrimary = account) }
    }

    fun dismissSetPrimary() {
        _uiState.update { it.copy(pendingSetPrimary = null) }
    }

    fun confirmSetPrimary() {
        val account = _uiState.value.pendingSetPrimary ?: return
        _uiState.update { it.copy(pendingSetPrimary = null) }

        viewModelScope.launch {
            when (val res = repository.setPrimaryAccount(account.id)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(actionMessage = "已设为主账号") }
                    loadData()
                    AppCacheManager.invalidate(CacheTarget.OVERVIEW, CacheTarget.SUBMISSIONS, CacheTarget.CONTESTS)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(actionMessage = "设置失败: 网络错误") }
                }
            }
        }
    }

    // 单账号即时抓取（二次确认）
    fun requestSyncAccount(account: AccountItemDto) {
        _uiState.update { it.copy(pendingSyncAccount = account) }
    }

    fun dismissSyncAccount() {
        _uiState.update { it.copy(pendingSyncAccount = null) }
    }

    fun confirmSyncAccount() {
        val account = _uiState.value.pendingSyncAccount ?: return
        _uiState.update { it.copy(pendingSyncAccount = null) }

        viewModelScope.launch {
            when (val res = repository.syncSingleAccount(account.id)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(actionMessage = "已触发单账号同步") }
                    AppCacheManager.invalidate(CacheTarget.OVERVIEW, CacheTarget.SUBMISSIONS, CacheTarget.CONTESTS)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(actionMessage = "同步失败: 网络错误") }
                }
            }
        }
    }

    // 删除账号（二次确认）
    fun requestDeleteAccount(account: AccountItemDto) {
        _uiState.update { it.copy(pendingDeleteAccount = account) }
    }

    fun dismissDeleteAccount() {
        _uiState.update { it.copy(pendingDeleteAccount = null) }
    }

    fun confirmDeleteAccount() {
        val account = _uiState.value.pendingDeleteAccount ?: return
        _uiState.update { it.copy(pendingDeleteAccount = null) }

        viewModelScope.launch {
            when (val res = repository.deleteAccount(account.id)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(actionMessage = "已移除平台账号") }
                    loadData()
                    AppCacheManager.invalidate(CacheTarget.OVERVIEW, CacheTarget.SUBMISSIONS, CacheTarget.CONTESTS)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(actionMessage = "移除失败: 网络错误") }
                }
            }
        }
    }

    // 修改密码（二次确认）
    fun showChangePasswordDialog(show: Boolean) {
        _uiState.update { it.copy(showChangePasswordDialog = show) }
    }

    fun submitChangePassword(oldPass: String, newPass: String) {
        _uiState.update { it.copy(showChangePasswordDialog = false) }
        viewModelScope.launch {
            val req = ChangePasswordRequest(old_password = oldPass, new_password = newPass)
            when (val res = repository.changePassword(req)) {
                is ApiResult.Success -> {
                    // 修改密码成功后，同步更新或清除已保存的密码
                    val (user, pass, rem) = prefs.getSavedCredentials()
                    if (rem && pass != null) {
                        prefs.saveCredentials(user, newPass, true)
                    } else {
                        prefs.clearSavedPassword()
                    }
                    _uiState.update { it.copy(actionMessage = "密码修改成功") }
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(actionMessage = "修改失败: 网络错误") }
                }
            }
        }
    }

    fun clearSavedPassword() {
        viewModelScope.launch {
            prefs.clearSavedPassword()
            _uiState.update { it.copy(actionMessage = "已清除本地记住的密码") }
        }
    }

    fun clearActionMessage() {
        _uiState.update { it.copy(actionMessage = null) }
    }
}
