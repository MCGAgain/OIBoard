package com.oiboard.app.data.repository

import com.oiboard.app.data.local.UserPreferencesRepository
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.AuthResponse
import com.oiboard.app.data.model.CaptchaResponse
import com.oiboard.app.data.model.LoginRequest
import com.oiboard.app.data.model.RegisterRequest
import com.oiboard.app.data.model.UserDto
import com.oiboard.app.data.remote.AuthApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

sealed interface AuthState {
    object Loading : AuthState
    object LoggedOut : AuthState
    data class LoggedIn(val user: UserDto, val serverUrl: String) : AuthState
}

class AuthRepository(
    private val authApi: AuthApi,
    private val prefs: UserPreferencesRepository,
    private val externalScope: CoroutineScope
) {
    private val _authState = MutableStateFlow<AuthState>(AuthState.Loading)
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    init {
        checkSession()
    }

    fun checkSession() {
        externalScope.launch(Dispatchers.IO) {
            // 通过挂起函数直接等待 DataStore 解密读取完成，避免冷启动时序导致的误判登出
            val token = prefs.getOrRestoreToken()
            val serverUrl = prefs.currentServerUrl

            if (token.isNullOrBlank()) {
                _authState.value = AuthState.LoggedOut
                return@launch
            }

            when (val result = authApi.getMe()) {
                is ApiResult.Success -> {
                    _authState.value = AuthState.LoggedIn(result.data, serverUrl)
                }
                is ApiResult.Error -> {
                    if (result.code == 401) {
                        prefs.clearSession()
                        _authState.value = AuthState.LoggedOut
                    } else {
                        // 遇到非 401 的网络或服务端异常，保留本地会话，避免误退出
                        val cachedUsername = prefs.usernameFlow.first() ?: "在线用户"
                        _authState.value = AuthState.LoggedIn(
                            UserDto(id = 0, username = cachedUsername),
                            serverUrl
                        )
                    }
                }
                is ApiResult.NetworkError -> {
                    val cachedUsername = prefs.usernameFlow.first() ?: "离线用户"
                    _authState.value = AuthState.LoggedIn(
                        UserDto(id = 0, username = cachedUsername),
                        serverUrl
                    )
                }
            }
        }
    }

    suspend fun getCaptcha(): ApiResult<CaptchaResponse> {
        return authApi.getCaptcha()
    }

    suspend fun login(
        req: LoginRequest
    ): ApiResult<AuthResponse> {
        val result = authApi.login(req)
        if (result is ApiResult.Success) {
            val data = result.data
            val token = data.token
            val user = data.user
            if (!token.isNullOrBlank() && user != null) {
                prefs.saveSession(token, user.id, user.username)
                _authState.value = AuthState.LoggedIn(user, prefs.currentServerUrl)
            }
        }
        return result
    }

    suspend fun register(
        req: RegisterRequest
    ): ApiResult<AuthResponse> {
        val result = authApi.register(req)
        if (result is ApiResult.Success) {
            val data = result.data
            val token = data.token
            val user = data.user
            if (!token.isNullOrBlank() && user != null) {
                prefs.saveSession(token, user.id, user.username)
                _authState.value = AuthState.LoggedIn(user, prefs.currentServerUrl)
            }
        }
        return result
    }

    fun logout(clearSavedPassword: Boolean = false) {
        externalScope.launch(Dispatchers.IO) {
            try {
                if (clearSavedPassword) {
                    prefs.clearSavedPassword()
                }
                prefs.clearSession()
                _authState.value = AuthState.LoggedOut
                authApi.logout()
            } catch (_: Exception) {
            }
        }
    }

    fun handleUnauthorized() {
        externalScope.launch(Dispatchers.IO) {
            prefs.clearSession()
            _authState.value = AuthState.LoggedOut
        }
    }

    suspend fun updateServerUrl(newUrl: String) {
        prefs.saveServerUrl(newUrl)
    }
}
