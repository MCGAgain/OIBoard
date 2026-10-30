package com.oiboard.app.ui.overview

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.ContestDto
import com.oiboard.app.data.model.HeatmapResponse
import com.oiboard.app.data.model.StatsOverviewResponse
import com.oiboard.app.data.model.TagStatDto
import com.oiboard.app.data.repository.StatsRepository
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate

import com.oiboard.app.data.local.AppCacheManager
import com.oiboard.app.data.local.CacheTarget

enum class ChartTab(val label: String) {
    CLIMBING_CURVE("累计通过"),
    DAILY_EFFORT("每日提交"),
    PLATFORMS("平台分布"),
    TAGS("标签分布")
}

data class OverviewUiState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val errorMessage: String? = null,
    val overview: StatsOverviewResponse? = null,
    val heatmap: HeatmapResponse? = null,
    val availableYears: List<Int> = emptyList(),
    val upcomingContests: List<ContestDto> = emptyList(),
    val tags: List<TagStatDto> = emptyList(),
    val selectedYear: Int = LocalDate.now().year,
    val selectedPlatform: String = "all",
    val activeChartTab: ChartTab = ChartTab.CLIMBING_CURVE
)

class OverviewViewModel(
    private val statsRepository: StatsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(OverviewUiState(isLoading = true))
    val uiState: StateFlow<OverviewUiState> = _uiState.asStateFlow()

    private var lastFetchTime: Long = 0L

    companion object {
        const val CACHE_TTL_MS = 60_000L // 总览页 60 秒时效缓存

        fun provideFactory(statsRepository: StatsRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return OverviewViewModel(statsRepository) as T
                }
            }
    }

    init {
        loadInitialData()
        observeCacheInvalidation()
    }

    private fun observeCacheInvalidation() {
        viewModelScope.launch {
            AppCacheManager.invalidationEvents.collect { targets ->
                if (CacheTarget.OVERVIEW in targets) {
                    lastFetchTime = 0L // 立即失效
                    loadInitialData(isSilent = true) // 静默后台拉取最新大盘数据
                }
            }
        }
    }

    /**
     * 60 秒时效缓存检查：
     * 时效内切回总览直接复用已有数据，零额外网络请求；
     * 过期后静默后台重拉最新数据，用户界面无白屏感。
     */
    fun checkCacheAndRefresh() {
        val now = System.currentTimeMillis()
        if (_uiState.value.overview != null) {
            if (now - lastFetchTime > CACHE_TTL_MS) {
                loadInitialData(isSilent = true)
            }
        } else {
            loadInitialData(isSilent = false)
        }
    }

    fun loadInitialData(isSilent: Boolean = false) {
        viewModelScope.launch {
            if (!isSilent) {
                _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            }

            val curYear = _uiState.value.selectedYear
            val curPlatform = _uiState.value.selectedPlatform

            // On-demand fetch of exactly the 4 required Overview endpoints concurrently
            val overviewDeferred = async { statsRepository.getOverview() }
            val heatmapDeferred = async { statsRepository.getHeatmap(year = curYear, platform = curPlatform) }
            val contestsDeferred = async { statsRepository.getUpcomingContests(limit = 3) }
            val tagsDeferred = async { statsRepository.getTags() }

            val overviewRes = overviewDeferred.await()
            val heatmapRes = heatmapDeferred.await()
            val contestsRes = contestsDeferred.await()
            val tagsRes = tagsDeferred.await()

            lastFetchTime = System.currentTimeMillis()

            var error: String? = null
            val overview = if (overviewRes is ApiResult.Success) overviewRes.data else {
                if (overviewRes is ApiResult.Error) error = overviewRes.message
                null
            }
            val heatmap = if (heatmapRes is ApiResult.Success) heatmapRes.data else null
            val contests = if (contestsRes is ApiResult.Success) contestsRes.data.contests else emptyList()
            val tags = if (tagsRes is ApiResult.Success) tagsRes.data.tags else emptyList()

            val years = mutableListOf<Int>()
            if (heatmap != null && heatmap.available_years.isNotEmpty()) {
                years.addAll(heatmap.available_years)
            }
            if (!years.contains(curYear)) {
                years.add(curYear)
            }

            _uiState.update {
                it.copy(
                    isLoading = false,
                    isRefreshing = false,
                    errorMessage = error,
                    overview = overview,
                    heatmap = heatmap,
                    availableYears = years.distinct().sortedDescending(),
                    upcomingContests = contests,
                    tags = tags
                )
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true, errorMessage = null) }
            loadInitialData()
        }
    }

    fun onYearChanged(year: Int) {
        if (_uiState.value.selectedYear == year) return
        viewModelScope.launch {
            _uiState.update { it.copy(selectedYear = year) }
            val res = statsRepository.getHeatmap(year = year, platform = _uiState.value.selectedPlatform)
            if (res is ApiResult.Success) {
                val newYears = res.data.available_years
                _uiState.update { current ->
                    val mergedYears = if (newYears.isNotEmpty()) {
                        (current.availableYears + newYears).distinct().sortedDescending()
                    } else {
                        current.availableYears
                    }
                    current.copy(
                        heatmap = res.data,
                        availableYears = mergedYears
                    )
                }
            }
        }
    }

    fun onPlatformChanged(platform: String) {
        if (_uiState.value.selectedPlatform == platform) return
        viewModelScope.launch {
            _uiState.update { it.copy(selectedPlatform = platform) }
            val res = statsRepository.getHeatmap(year = _uiState.value.selectedYear, platform = platform)
            if (res is ApiResult.Success) {
                _uiState.update {
                    it.copy(
                        heatmap = res.data
                    )
                }
            }
        }
    }

    fun onChartTabChanged(tab: ChartTab) {
        _uiState.update { it.copy(activeChartTab = tab) }
    }
}
