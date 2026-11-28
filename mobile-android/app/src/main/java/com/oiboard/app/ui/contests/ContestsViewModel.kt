package com.oiboard.app.ui.contests

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.oiboard.app.data.local.AppCacheManager
import com.oiboard.app.data.local.AppDiskCache
import com.oiboard.app.data.local.CacheTarget
import com.oiboard.app.data.local.ContestsCacheDto
import com.oiboard.app.data.local.UserPreferencesRepository
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ContestDto
import com.oiboard.app.data.repository.ContestsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ContestsUiState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isOffline: Boolean = false,
    val rawContests: List<ContestDto> = emptyList(),
    val filteredContests: List<ContestDto> = emptyList(),
    val selectedPlatform: String = "all",
    val selectedPhase: String = "all",
    val errorMessage: String? = null
)

class ContestsViewModel(
    private val repository: ContestsRepository,
    private val context: Context,
    private val prefs: UserPreferencesRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ContestsUiState())
    val uiState: StateFlow<ContestsUiState> = _uiState.asStateFlow()

    private var lastFetchTime: Long = 0L

    companion object {
        const val MAX_CONTESTS = 100
        const val CACHE_TTL_MS = 60_000L // 比赛页 60 秒时效缓存

        fun provideFactory(
            repository: ContestsRepository,
            context: Context,
            prefs: UserPreferencesRepository
        ): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return ContestsViewModel(repository, context.applicationContext, prefs) as T
                }
            }
    }

    init {
        loadWithLocalCache()
        observeCacheInvalidation()
    }

    private fun loadWithLocalCache() {
        viewModelScope.launch(Dispatchers.IO) {
            val key = AppDiskCache.computeCacheKey(prefs.currentUserId, prefs.currentServerUrl)
            val cached = AppDiskCache.readContests(context, key)
            if (cached != null && cached.contests.isNotEmpty()) {
                _uiState.update {
                    it.copy(
                        rawContests = cached.contests,
                        isLoading = false,
                        isOffline = false
                    )
                }
                applyPhaseFilter()
            }
            loadContests(isRefresh = false, isSilent = (cached != null && cached.contests.isNotEmpty()))
        }
    }

    private fun observeCacheInvalidation() {
        viewModelScope.launch {
            AppCacheManager.invalidationEvents.collect { targets ->
                if (CacheTarget.CONTESTS in targets) {
                    lastFetchTime = 0L // 立即失效
                    loadContests(isRefresh = false, isSilent = true) // 静默刷新
                }
            }
        }
    }

    /**
     * 60 秒时效缓存检查：
     * 时效内切回比赛直接显示已有数据，过期后静默刷新；下拉刷新强制拉取。
     */
    fun checkCacheAndRefresh() {
        val now = System.currentTimeMillis()
        if (_uiState.value.rawContests.isNotEmpty()) {
            if (now - lastFetchTime > CACHE_TTL_MS) {
                loadContests(isRefresh = false, isSilent = true)
            }
        } else {
            loadContests(isRefresh = false, isSilent = false)
        }
    }

    fun selectPlatform(platform: String) {
        if (_uiState.value.selectedPlatform == platform) return
        _uiState.update { it.copy(selectedPlatform = platform) }
        loadContests()
    }

    fun selectPhase(phase: String) {
        if (_uiState.value.selectedPhase == phase) return
        _uiState.update { it.copy(selectedPhase = phase) }
        applyPhaseFilter()
    }

    fun loadContests(isRefresh: Boolean = false, isSilent: Boolean = false) {
        viewModelScope.launch {
            if (!isSilent) {
                _uiState.update {
                    if (isRefresh) it.copy(isRefreshing = true, errorMessage = null)
                    else it.copy(isLoading = true, errorMessage = null)
                }
            }

            val currentPlatform = _uiState.value.selectedPlatform
            when (val result = repository.getContests(platform = currentPlatform, limit = 60)) {
                is ApiResult.Success -> {
                    lastFetchTime = System.currentTimeMillis()
                    val boundedList = result.data.contests.take(MAX_CONTESTS)
                    
                    // 仅缓存第一页前 20 条，不占空间，覆盖写入
                    val key = AppDiskCache.computeCacheKey(prefs.currentUserId, prefs.currentServerUrl)
                    AppDiskCache.writeContests(context, key, ContestsCacheDto(boundedList.take(20)))

                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            isOffline = false,
                            rawContests = boundedList,
                            errorMessage = null
                        )
                    }
                    applyPhaseFilter()
                }
                is ApiResult.Error -> {
                    if (_uiState.value.rawContests.isNotEmpty()) {
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isRefreshing = false,
                                isOffline = true,
                                errorMessage = null
                            )
                        }
                    } else {
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isRefreshing = false,
                                isOffline = false,
                                errorMessage = result.message
                            )
                        }
                    }
                }
                is ApiResult.NetworkError -> {
                    if (_uiState.value.rawContests.isNotEmpty()) {
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isRefreshing = false,
                                isOffline = true,
                                errorMessage = null
                            )
                        }
                    } else {
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                isRefreshing = false,
                                isOffline = false,
                                errorMessage = "网络连接失败"
                            )
                        }
                    }
                }
            }
        }
    }

    private fun applyPhaseFilter() {
        val state = _uiState.value
        val phase = state.selectedPhase
        val filtered = state.rawContests.filter { contest ->
            when (phase) {
                "all" -> true
                "CODING" -> {
                    contest.phase.equals("CODING", ignoreCase = true) ||
                            contest.phase.equals("RUNNING", ignoreCase = true) ||
                            contest.status_text.contains("进行中")
                }
                "BEFORE" -> {
                    contest.phase.equals("BEFORE", ignoreCase = true) ||
                            contest.status_text.contains("未开始")
                }
                else -> true
            }
        }
        _uiState.update { it.copy(filteredContests = filtered) }
    }
}
