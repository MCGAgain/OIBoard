package com.oiboard.app.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.io.IOException

enum class AppThemeMode(val title: String) {
    SYSTEM("跟随系统"),
    LIGHT("浅色模式"),
    DARK("纯黑深色")
}

val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "oiboard_prefs")

class UserPreferencesRepository(
    private val context: Context,
    private val scope: CoroutineScope
) {
    companion object {
        val KEY_SERVER_URL = stringPreferencesKey("server_url")
        val KEY_ENCRYPTED_TOKEN = stringPreferencesKey("enc_auth_token")
        val KEY_LEGACY_TOKEN = stringPreferencesKey("auth_token")
        val KEY_USER_ID = longPreferencesKey("user_id")
        val KEY_USERNAME = stringPreferencesKey("username")
        val KEY_THEME_MODE = stringPreferencesKey("theme_mode")

        val KEY_SAVED_USERNAME = stringPreferencesKey("saved_username")
        val KEY_ENCRYPTED_PASSWORD = stringPreferencesKey("enc_password")
        val KEY_REMEMBER_PASSWORD = booleanPreferencesKey("remember_password")

        const val DEFAULT_SERVER_URL = "http://10.0.2.2:8888"
    }

    // 内存同步缓存，供 OkHttp 拦截器读取
    @Volatile
    var currentServerUrl: String = DEFAULT_SERVER_URL
        private set

    @Volatile
    var currentToken: String? = null
        private set

    private val prefsFlow: Flow<Preferences> = context.dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }

    val serverUrlFlow: Flow<String> = prefsFlow.map { prefs ->
        prefs[KEY_SERVER_URL]?.takeIf { it.isNotBlank() } ?: DEFAULT_SERVER_URL
    }.distinctUntilChanged()

    val tokenFlow: Flow<String?> = prefsFlow.map { prefs ->
        val encToken = prefs[KEY_ENCRYPTED_TOKEN]
        if (!encToken.isNullOrBlank()) {
            CryptoManager.decrypt(encToken)
        } else {
            // 兼容老版本迁移
            prefs[KEY_LEGACY_TOKEN]
        }
    }.distinctUntilChanged()

    val usernameFlow: Flow<String?> = prefsFlow.map { prefs ->
        prefs[KEY_USERNAME]
    }.distinctUntilChanged()

    val rememberPasswordFlow: Flow<Boolean> = prefsFlow.map { prefs ->
        prefs[KEY_REMEMBER_PASSWORD] ?: true
    }.distinctUntilChanged()

    val themeModeFlow: Flow<AppThemeMode> = prefsFlow.map { prefs ->
        val modeStr = prefs[KEY_THEME_MODE]
        try {
            if (!modeStr.isNullOrBlank()) AppThemeMode.valueOf(modeStr) else AppThemeMode.SYSTEM
        } catch (_: Exception) {
            AppThemeMode.SYSTEM
        }
    }.distinctUntilChanged()

    init {
        scope.launch(Dispatchers.IO) {
            serverUrlFlow.collect { currentServerUrl = it }
        }
        scope.launch(Dispatchers.IO) {
            tokenFlow.collect { currentToken = it }
        }
    }

    /**
     * 冷启动或会话校验时，挂起等待从 DataStore 读取并解密 Token，避免内存缓存未初始化的时序空值
     */
    suspend fun getOrRestoreToken(): String? {
        val prefs = prefsFlow.first()
        val enc = prefs[KEY_ENCRYPTED_TOKEN]
        val token = if (!enc.isNullOrBlank()) {
            CryptoManager.decrypt(enc)
        } else {
            prefs[KEY_LEGACY_TOKEN]
        }
        currentToken = token
        return token
    }

    suspend fun saveServerUrl(url: String) {
        val cleanUrl = url.trim().trimEnd('/')
        currentServerUrl = cleanUrl
        context.dataStore.edit { prefs ->
            prefs[KEY_SERVER_URL] = cleanUrl
        }
    }

    suspend fun saveSession(token: String, userId: Long, username: String) {
        currentToken = token
        val encToken = CryptoManager.encrypt(token) ?: ""
        context.dataStore.edit { prefs ->
            prefs[KEY_ENCRYPTED_TOKEN] = encToken
            prefs.remove(KEY_LEGACY_TOKEN)
            prefs[KEY_USER_ID] = userId
            prefs[KEY_USERNAME] = username
        }
    }

    suspend fun saveCredentials(username: String, password: String?, remember: Boolean) {
        val encPass = if (!password.isNullOrBlank() && remember) {
            CryptoManager.encrypt(password)
        } else null

        context.dataStore.edit { prefs ->
            prefs[KEY_SAVED_USERNAME] = username.trim()
            prefs[KEY_REMEMBER_PASSWORD] = remember
            if (encPass != null) {
                prefs[KEY_ENCRYPTED_PASSWORD] = encPass
            } else {
                prefs.remove(KEY_ENCRYPTED_PASSWORD)
            }
        }
    }

    suspend fun getSavedCredentials(): Triple<String, String?, Boolean> {
        val prefs = prefsFlow.first()
        val username = prefs[KEY_SAVED_USERNAME] ?: prefs[KEY_USERNAME] ?: ""
        val remember = prefs[KEY_REMEMBER_PASSWORD] ?: true
        val encPass = prefs[KEY_ENCRYPTED_PASSWORD]
        val password = if (remember && !encPass.isNullOrBlank()) {
            CryptoManager.decrypt(encPass)
        } else null
        return Triple(username, password, remember)
    }

    suspend fun clearSavedPassword() {
        context.dataStore.edit { prefs ->
            prefs.remove(KEY_ENCRYPTED_PASSWORD)
            prefs[KEY_REMEMBER_PASSWORD] = false
        }
    }

    suspend fun hasSavedPassword(): Boolean {
        val prefs = prefsFlow.first()
        return !prefs[KEY_ENCRYPTED_PASSWORD].isNullOrBlank()
    }

    suspend fun saveThemeMode(mode: AppThemeMode) {
        context.dataStore.edit { prefs ->
            prefs[KEY_THEME_MODE] = mode.name
        }
    }

    suspend fun clearSession() {
        currentToken = null
        context.dataStore.edit { prefs ->
            prefs.remove(KEY_ENCRYPTED_TOKEN)
            prefs.remove(KEY_LEGACY_TOKEN)
            prefs.remove(KEY_USER_ID)
            prefs.remove(KEY_USERNAME)
        }
    }
}
