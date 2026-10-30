package com.oiboard.app.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.oiboard.app.data.local.UserPreferencesRepository
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.LoginRequest
import com.oiboard.app.data.model.RegisterRequest
import com.oiboard.app.data.repository.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AuthUiState(
    val serverUrl: String = UserPreferencesRepository.DEFAULT_SERVER_URL,
    val isServerUrlDialogOpen: Boolean = false,
    val isRegisterMode: Boolean = false,
    val username: String = "",
    val password: String = "",
    val confirmPassword: String = "",
    val rememberPassword: Boolean = true,
    val captchaId: String = "",
    val captchaImageBase64: String = "",
    val captchaCode: String = "",
    val isLoading: Boolean = false,
    val isCaptchaLoading: Boolean = false,
    val errorMessage: String? = null,
    val successMessage: String? = null
)

class AuthViewModel(
    private val authRepository: AuthRepository,
    private val prefs: UserPreferencesRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AuthUiState())
    val uiState: StateFlow<AuthUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            prefs.serverUrlFlow.collect { url ->
                _uiState.update { it.copy(serverUrl = url) }
            }
        }
        // 预填已记住的用户名与加密解密密码
        viewModelScope.launch {
            val (savedUser, savedPass, remember) = prefs.getSavedCredentials()
            _uiState.update {
                it.copy(
                    username = savedUser,
                    password = savedPass ?: "",
                    rememberPassword = remember
                )
            }
        }
        refreshCaptcha()
    }

    fun setRememberPassword(remember: Boolean) {
        _uiState.update { it.copy(rememberPassword = remember) }
        if (!remember) {
            viewModelScope.launch {
                prefs.clearSavedPassword()
            }
        }
    }

    fun refreshCaptcha() {
        viewModelScope.launch {
            _uiState.update { it.copy(isCaptchaLoading = true) }
            when (val result = authRepository.getCaptcha()) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isCaptchaLoading = false,
                            captchaId = result.data.captcha_id,
                            captchaImageBase64 = result.data.captcha_image,
                            captchaCode = "" // 清空上一轮输入的验证码
                        )
                    }
                }
                is ApiResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isCaptchaLoading = false,
                            errorMessage = "验证码加载失败: ${result.message}"
                        )
                    }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update {
                        it.copy(
                            isCaptchaLoading = false,
                            errorMessage = "连接失败"
                        )
                    }
                }
            }
        }
    }

    fun onUsernameChange(value: String) {
        _uiState.update { it.copy(username = value.trim(), errorMessage = null) }
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(password = value, errorMessage = null) }
    }

    fun onConfirmPasswordChange(value: String) {
        _uiState.update { it.copy(confirmPassword = value, errorMessage = null) }
    }

    fun onCaptchaCodeChange(value: String) {
        _uiState.update { it.copy(captchaCode = value.trim(), errorMessage = null) }
    }

    fun toggleMode() {
        _uiState.update {
            it.copy(
                isRegisterMode = !it.isRegisterMode,
                errorMessage = null,
                successMessage = null,
                confirmPassword = ""
            )
        }
        refreshCaptcha()
    }

    fun showServerUrlDialog(show: Boolean) {
        _uiState.update { it.copy(isServerUrlDialogOpen = show) }
    }

    fun saveServerUrl(newUrl: String) {
        viewModelScope.launch {
            prefs.saveServerUrl(newUrl)
            _uiState.update { it.copy(isServerUrlDialogOpen = false, serverUrl = newUrl, errorMessage = null) }
            refreshCaptcha()
        }
    }

    fun submit() {
        val state = _uiState.value

        if (state.username.isBlank()) {
            _uiState.update { it.copy(errorMessage = "请输入用户名") }
            return
        }

        if (state.password.isBlank()) {
            _uiState.update { it.copy(errorMessage = "请输入密码") }
            return
        }

        if (state.isRegisterMode) {
            if (state.username.length < 3 || state.username.length > 32) {
                _uiState.update { it.copy(errorMessage = "用户名需为 3-32 位") }
                return
            }
            if (state.password.length < 6) {
                _uiState.update { it.copy(errorMessage = "密码不能少于 6 位") }
                return
            }
            if (state.password != state.confirmPassword) {
                _uiState.update { it.copy(errorMessage = "两次输入的密码不一致") }
                return
            }
        }

        if (state.captchaCode.isBlank()) {
            _uiState.update { it.copy(errorMessage = "请输入验证码") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            if (state.isRegisterMode) {
                val req = RegisterRequest(
                    username = state.username,
                    password = state.password,
                    captcha_id = state.captchaId,
                    captcha_code = state.captchaCode
                )
                when (val result = authRepository.register(req)) {
                    is ApiResult.Success -> {
                        prefs.saveCredentials(
                            username = state.username,
                            password = if (state.rememberPassword) state.password else null,
                            remember = state.rememberPassword
                        )
                        _uiState.update { it.copy(isLoading = false, password = "", successMessage = "注册成功并已自动登录") }
                    }
                    is ApiResult.Error -> {
                        _uiState.update { it.copy(isLoading = false, errorMessage = result.message) }
                        refreshCaptcha()
                    }
                    is ApiResult.NetworkError -> {
                        _uiState.update { it.copy(isLoading = false, errorMessage = "连接失败") }
                        refreshCaptcha()
                    }
                }
            } else {
                val req = LoginRequest(
                    username = state.username,
                    password = state.password,
                    captcha_id = state.captchaId,
                    captcha_code = state.captchaCode
                )
                when (val result = authRepository.login(req)) {
                    is ApiResult.Success -> {
                        // 登录成功：安全加密持久化用户名与密码，内存中立即抹除明文密码
                        prefs.saveCredentials(
                            username = state.username,
                            password = if (state.rememberPassword) state.password else null,
                            remember = state.rememberPassword
                        )
                        _uiState.update { it.copy(isLoading = false, password = "", successMessage = "登录成功") }
                    }
                    is ApiResult.Error -> {
                        _uiState.update { it.copy(isLoading = false, errorMessage = result.message) }
                        refreshCaptcha()
                    }
                    is ApiResult.NetworkError -> {
                        _uiState.update { it.copy(isLoading = false, errorMessage = "连接失败") }
                        refreshCaptcha()
                    }
                }
            }
        }
    }

    companion object {
        fun provideFactory(
            authRepository: AuthRepository,
            prefs: UserPreferencesRepository
        ): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                return AuthViewModel(authRepository, prefs) as T
            }
        }
    }
}
