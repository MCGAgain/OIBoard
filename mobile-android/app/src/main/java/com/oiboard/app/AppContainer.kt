package com.oiboard.app

import android.content.Context
import com.oiboard.app.data.local.UserPreferencesRepository
import com.oiboard.app.data.remote.AuthApi
import com.oiboard.app.data.remote.StatsApi
import com.oiboard.app.data.remote.createOkHttpClient
import com.oiboard.app.data.repository.AuthRepository
import com.oiboard.app.data.repository.StatsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient

class AppContainer(private val context: Context) {

    val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val userPreferencesRepository: UserPreferencesRepository by lazy {
        UserPreferencesRepository(context.applicationContext, applicationScope)
    }

    val okHttpClient: OkHttpClient by lazy {
        createOkHttpClient(
            prefs = userPreferencesRepository,
            onUnauthorized = {
                authRepository.handleUnauthorized()
            }
        )
    }

    val authApi: AuthApi by lazy {
        AuthApi(okHttpClient)
    }

    val authRepository: AuthRepository by lazy {
        AuthRepository(
            authApi = authApi,
            prefs = userPreferencesRepository,
            externalScope = applicationScope
        )
    }

    val statsApi: StatsApi by lazy {
        StatsApi(okHttpClient)
    }

    val statsRepository: StatsRepository by lazy {
        StatsRepository(statsApi)
    }

    val contestsApi: com.oiboard.app.data.remote.ContestsApi by lazy {
        com.oiboard.app.data.remote.ContestsApi(okHttpClient)
    }

    val contestsRepository: com.oiboard.app.data.repository.ContestsRepository by lazy {
        com.oiboard.app.data.repository.ContestsRepository(contestsApi)
    }

    val submissionsApi: com.oiboard.app.data.remote.SubmissionsApi by lazy {
        com.oiboard.app.data.remote.SubmissionsApi(okHttpClient)
    }

    val submissionsRepository: com.oiboard.app.data.repository.SubmissionsRepository by lazy {
        com.oiboard.app.data.repository.SubmissionsRepository(submissionsApi)
    }

    val mistakesApi: com.oiboard.app.data.remote.MistakesApi by lazy {
        com.oiboard.app.data.remote.MistakesApi(okHttpClient)
    }

    val mistakesRepository: com.oiboard.app.data.repository.MistakesRepository by lazy {
        com.oiboard.app.data.repository.MistakesRepository(mistakesApi)
    }

    val settingsApi: com.oiboard.app.data.remote.SettingsApi by lazy {
        com.oiboard.app.data.remote.SettingsApi(okHttpClient)
    }

    val settingsRepository: com.oiboard.app.data.repository.SettingsRepository by lazy {
        com.oiboard.app.data.repository.SettingsRepository(settingsApi)
    }
}
