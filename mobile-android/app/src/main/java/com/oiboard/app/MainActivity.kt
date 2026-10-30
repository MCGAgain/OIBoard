package com.oiboard.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.oiboard.app.data.local.AppThemeMode
import com.oiboard.app.data.repository.AuthState
import com.oiboard.app.ui.auth.AuthViewModel
import com.oiboard.app.ui.auth.LoginScreen
import com.oiboard.app.ui.navigation.MainScreen
import com.oiboard.app.ui.theme.OIBoardTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // 刷新率优化：请求同物理分辨率下最高刷新率显示模式（如 120Hz）
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            try {
                val currentDisplay = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                    display
                } else {
                    @Suppress("DEPRECATION")
                    windowManager.defaultDisplay
                }
                val modes = currentDisplay?.supportedModes
                val activeMode = currentDisplay?.mode
                if (modes != null && activeMode != null) {
                    val maxRefreshMode = modes
                        .filter { it.physicalWidth == activeMode.physicalWidth && it.physicalHeight == activeMode.physicalHeight }
                        .maxByOrNull { it.refreshRate }
                    if (maxRefreshMode != null && maxRefreshMode.refreshRate > activeMode.refreshRate) {
                        val lp = window.attributes
                        lp.preferredDisplayModeId = maxRefreshMode.modeId
                        window.attributes = lp
                    }
                }
            } catch (_: Exception) {}
        }

        val container = (application as OIBoardApp).container

        setContent {
            val themeMode by container.userPreferencesRepository.themeModeFlow
                .collectAsStateWithLifecycle(initialValue = AppThemeMode.SYSTEM)

            OIBoardTheme(themeMode = themeMode) {
                val coroutineScope = rememberCoroutineScope()
                val authState by container.authRepository.authState.collectAsStateWithLifecycle()

                when (val state = authState) {
                    is AuthState.Loading -> {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(MaterialTheme.colorScheme.background),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(32.dp),
                                strokeWidth = 3.dp,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                    is AuthState.LoggedOut -> {
                        val authViewModel: AuthViewModel = viewModel(
                            factory = AuthViewModel.provideFactory(
                                container.authRepository,
                                container.userPreferencesRepository
                            )
                        )
                        LoginScreen(
                            viewModel = authViewModel,
                            currentThemeMode = themeMode,
                            onThemeToggle = {
                                val nextMode = if (themeMode == AppThemeMode.DARK) AppThemeMode.LIGHT else AppThemeMode.DARK
                                coroutineScope.launch {
                                    container.userPreferencesRepository.saveThemeMode(nextMode)
                                }
                            }
                        )
                    }
                    is AuthState.LoggedIn -> {
                        MainScreen(
                            statsRepository = container.statsRepository,
                            contestsRepository = container.contestsRepository,
                            submissionsRepository = container.submissionsRepository,
                            mistakesRepository = container.mistakesRepository,
                            settingsRepository = container.settingsRepository,
                            userPreferencesRepository = container.userPreferencesRepository,
                            currentUser = state.user,
                            currentServerUrl = state.serverUrl,
                            currentThemeMode = themeMode,
                            onThemeChange = { newMode ->
                                coroutineScope.launch {
                                    container.userPreferencesRepository.saveThemeMode(newMode)
                                }
                            },
                            onSaveServerUrl = { newUrl ->
                                coroutineScope.launch {
                                    container.userPreferencesRepository.saveServerUrl(newUrl)
                                }
                            },
                            onLogout = { clearPassword ->
                                container.authRepository.logout(clearPassword)
                            }
                        )
                    }
                }
            }
        }
    }
}
