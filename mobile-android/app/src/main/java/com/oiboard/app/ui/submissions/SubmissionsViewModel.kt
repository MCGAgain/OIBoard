package com.oiboard.app.ui.submissions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.oiboard.app.data.local.AppCacheManager
import com.oiboard.app.data.local.CacheTarget
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.MistakeCreateRequest
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.SubmissionDto
import com.oiboard.app.data.repository.SubmissionsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

data class SubmissionsUiState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val allSubmissions: List<SubmissionDto> = emptyList(),
    val filteredSubmissions: List<SubmissionDto> = emptyList(),
    val visibleSubmissions: List<SubmissionDto> = emptyList(),
    val visiblePageSize: Int = 25,
    val selectedPlatform: String = "all",
    val selectedVerdict: String = "all",
    val selectedDateRange: String = "all",
    val customStartDate: String = "",
    val customEndDate: String = "",
    val selectedTag: String = "all",
    val availableTags: List<String> = emptyList(),
    val searchQuery: String = "",
    val mistakeKeys: Set<String> = emptySet(),
    val errorMessage: String? = null,
    val pendingAddToMistake: SubmissionDto? = null,
    val isAddingMistake: Boolean = false,
    val viewingMistakeDetail: MistakeItemDto? = null,
    val isLoadingMistakeDetail: Boolean = false,
    val showCustomDateDialog: Boolean = false,
    val actionMessage: String? = null
)

class SubmissionsViewModel(
    private val repository: SubmissionsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SubmissionsUiState())
    val uiState: StateFlow<SubmissionsUiState> = _uiState.asStateFlow()

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
    private var lastFetchTime: Long = 0L

    companion object {
        const val MAX_SUBMISSIONS = 150
        const val CACHE_TTL_MS = 30_000L // 提交页 30 秒时效缓存

        fun provideFactory(repository: SubmissionsRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return SubmissionsViewModel(repository) as T
                }
            }
    }

    init {
        loadSubmissions()
        observeCacheInvalidation()
    }

    private fun observeCacheInvalidation() {
        viewModelScope.launch {
            AppCacheManager.invalidationEvents.collect { targets ->
                if (CacheTarget.SUBMISSIONS in targets) {
                    lastFetchTime = 0L // 立即失效
                    loadSubmissions(isRefresh = false, isSilent = true) // 静默刷新提交流
                }
            }
        }
    }

    /**
     * 30 秒时效缓存检查：
     * 时效内切回页面直接显示已有数据，不请求网络；
     * 超过 30 秒时触发静默后台刷新，已有列表不白屏。
     */
    fun checkCacheAndRefresh() {
        val now = System.currentTimeMillis()
        if (_uiState.value.allSubmissions.isNotEmpty()) {
            if (now - lastFetchTime > CACHE_TTL_MS) {
                loadSubmissions(isRefresh = false, isSilent = true)
            }
        } else {
            loadSubmissions(isRefresh = false, isSilent = false)
        }
    }

    fun selectPlatform(platform: String) {
        if (_uiState.value.selectedPlatform == platform) return
        _uiState.update { it.copy(selectedPlatform = platform) }
        loadSubmissions()
    }

    fun selectVerdict(verdict: String) {
        if (_uiState.value.selectedVerdict == verdict) return
        _uiState.update { it.copy(selectedVerdict = verdict) }
        onFilterConditionChanged()
    }

    fun selectDateRange(range: String) {
        if (range == "custom") {
            _uiState.update { it.copy(showCustomDateDialog = true) }
        } else {
            _uiState.update { it.copy(selectedDateRange = range) }
            onFilterConditionChanged()
        }
    }

    fun setCustomDateRange(start: String, end: String) {
        _uiState.update {
            it.copy(
                selectedDateRange = "custom",
                customStartDate = start,
                customEndDate = end,
                showCustomDateDialog = false
            )
        }
        onFilterConditionChanged()
    }

    fun dismissCustomDateDialog() {
        _uiState.update { it.copy(showCustomDateDialog = false) }
    }

    fun selectTag(tag: String) {
        if (_uiState.value.selectedTag == tag) return
        _uiState.update { it.copy(selectedTag = tag) }
        onFilterConditionChanged()
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        onFilterConditionChanged()
    }

    fun resetFilters() {
        _uiState.update {
            it.copy(
                selectedPlatform = "all",
                selectedVerdict = "all",
                selectedDateRange = "all",
                selectedTag = "all",
                searchQuery = "",
                customStartDate = "",
                customEndDate = "",
                visiblePageSize = 25
            )
        }
        loadSubmissions(forceFullFetch = false)
    }

    fun loadMore() {
        val currentSize = _uiState.value.visiblePageSize
        if (currentSize < _uiState.value.filteredSubmissions.size && currentSize < MAX_SUBMISSIONS) {
            val newSize = (currentSize + 25).coerceAtMost(MAX_SUBMISSIONS)
            _uiState.update { state ->
                state.copy(
                    visiblePageSize = newSize,
                    visibleSubmissions = state.filteredSubmissions.take(newSize)
                )
            }
        }
    }

    private fun hasActiveFilters(state: SubmissionsUiState): Boolean {
        return state.selectedVerdict != "all" ||
                state.selectedDateRange != "all" ||
                state.selectedTag != "all" ||
                state.searchQuery.isNotBlank()
    }

    private fun onFilterConditionChanged() {
        val hasFilters = hasActiveFilters(_uiState.value)
        if (hasFilters) {
            // 有筛选条件时，向后端拉取更大 limit (2000)，在流式读取中实时过滤并截断最多 150 条
            loadSubmissions(forceFullFetch = true)
        } else {
            applyClientFilters()
        }
    }

    fun loadSubmissions(
        isRefresh: Boolean = false,
        isSilent: Boolean = false,
        forceFullFetch: Boolean = false
    ) {
        viewModelScope.launch {
            if (!isSilent) {
                _uiState.update {
                    if (isRefresh) it.copy(isRefreshing = true, errorMessage = null)
                    else it.copy(isLoading = true, errorMessage = null)
                }
            }

            val keysResult = repository.getMistakeKeys()
            val keys = if (keysResult is ApiResult.Success) {
                keysResult.data.keys.toSet()
            } else {
                _uiState.value.mistakeKeys
            }

            val platform = _uiState.value.selectedPlatform
            val filterActive = forceFullFetch || hasActiveFilters(_uiState.value)

            // 构建实时流式解析 predicate
            val predicate: ((SubmissionDto) -> Boolean)? = if (filterActive) {
                val state = _uiState.value
                val verdict = state.selectedVerdict
                val query = state.searchQuery.trim().lowercase()
                val dateRange = state.selectedDateRange
                val tagFilter = state.selectedTag

                val now = Date()
                val todayStr = dateFormat.format(now)
                val cal = Calendar.getInstance()
                cal.time = now
                cal.add(Calendar.DAY_OF_YEAR, -7)
                val sevenDaysAgo = cal.time
                cal.time = now
                cal.add(Calendar.DAY_OF_YEAR, -30)
                val thirtyDaysAgo = cal.time
                val currentYearStr = Calendar.getInstance().get(Calendar.YEAR).toString()

                val filterLambda: (SubmissionDto) -> Boolean = { sub: SubmissionDto ->
                    val matchVerdict = when (verdict) {
                        "all" -> true
                        "AC" -> sub.verdict.equals("AC", ignoreCase = true)
                        "FAILED" -> !sub.verdict.equals("AC", ignoreCase = true)
                        else -> true
                    }
                    val matchTag = if (tagFilter == "all") true else {
                        sub.tags.any { it.equals(tagFilter, ignoreCase = true) }
                    }
                    val subDateStr = sub.submitted_at.take(10)
                    val matchDate = when (dateRange) {
                        "all" -> true
                        "today" -> subDateStr == todayStr
                        "7days" -> {
                            try {
                                val d = dateFormat.parse(subDateStr)
                                d != null && !d.before(sevenDaysAgo)
                            } catch (_: Exception) { true }
                        }
                        "30days" -> {
                            try {
                                val d = dateFormat.parse(subDateStr)
                                d != null && !d.before(thirtyDaysAgo)
                            } catch (_: Exception) { true }
                        }
                        "this_year" -> subDateStr.startsWith(currentYearStr)
                        "custom" -> {
                            val start = state.customStartDate
                            val end = state.customEndDate
                            if (start.isBlank() || end.isBlank()) true
                            else subDateStr in start..end
                        }
                        else -> true
                    }
                    val matchQuery = if (query.isBlank()) true else {
                        sub.problem_id.lowercase().contains(query) ||
                                sub.problem_title.lowercase().contains(query) ||
                                sub.tags.any { it.lowercase().contains(query) }
                    }
                    matchVerdict && matchTag && matchDate && matchQuery
                }
                filterLambda
            } else {
                null
            }

            val fetchLimit = if (filterActive) 2000 else 100

            when (val streamResult = repository.getSubmissionsStream(
                platform = platform,
                limit = fetchLimit,
                predicate = predicate,
                maxResults = MAX_SUBMISSIONS
            )) {
                is ApiResult.Success -> {
                    lastFetchTime = System.currentTimeMillis()
                    val (items, tags) = streamResult.data
                    val bounded = items.take(MAX_SUBMISSIONS)

                    _uiState.update {
                        val mergedTags = if (it.availableTags.isNotEmpty() && tags.isEmpty()) it.availableTags else tags
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            allSubmissions = bounded,
                            filteredSubmissions = bounded,
                            visibleSubmissions = bounded.take(it.visiblePageSize),
                            availableTags = mergedTags,
                            mistakeKeys = keys,
                            errorMessage = null
                        )
                    }
                }
                is ApiResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            errorMessage = streamResult.message
                        )
                    }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            errorMessage = "网络连接失败"
                        )
                    }
                }
            }
        }
    }

    private fun applyClientFilters() {
        val state = _uiState.value
        val verdict = state.selectedVerdict
        val query = state.searchQuery.trim().lowercase()
        val dateRange = state.selectedDateRange
        val tagFilter = state.selectedTag

        val now = Date()
        val todayStr = dateFormat.format(now)
        val cal = Calendar.getInstance()
        cal.time = now
        cal.add(Calendar.DAY_OF_YEAR, -7)
        val sevenDaysAgo = cal.time
        cal.time = now
        cal.add(Calendar.DAY_OF_YEAR, -30)
        val thirtyDaysAgo = cal.time
        val currentYear = Calendar.getInstance().get(Calendar.YEAR).toString()

        val filtered = state.allSubmissions.filter { sub ->
            val matchVerdict = when (verdict) {
                "all" -> true
                "AC" -> sub.verdict.equals("AC", ignoreCase = true)
                "FAILED" -> !sub.verdict.equals("AC", ignoreCase = true)
                else -> true
            }

            val matchTag = if (tagFilter == "all") true else {
                sub.tags.any { it.equals(tagFilter, ignoreCase = true) }
            }

            val subDateStr = sub.submitted_at.take(10)
            val matchDate = when (dateRange) {
                "all" -> true
                "today" -> subDateStr == todayStr
                "7days" -> {
                    try {
                        val d = dateFormat.parse(subDateStr)
                        d != null && !d.before(sevenDaysAgo)
                    } catch (_: Exception) { true }
                }
                "30days" -> {
                    try {
                        val d = dateFormat.parse(subDateStr)
                        d != null && !d.before(thirtyDaysAgo)
                    } catch (_: Exception) { true }
                }
                "this_year" -> subDateStr.startsWith(currentYear)
                "custom" -> {
                    val start = state.customStartDate
                    val end = state.customEndDate
                    if (start.isBlank() || end.isBlank()) true
                    else subDateStr in start..end
                }
                else -> true
            }

            val matchQuery = if (query.isBlank()) true else {
                sub.problem_id.lowercase().contains(query) ||
                        sub.problem_title.lowercase().contains(query) ||
                        sub.tags.any { it.lowercase().contains(query) }
            }

            matchVerdict && matchTag && matchDate && matchQuery
        }

        val visible = filtered.take(state.visiblePageSize)
        _uiState.update { it.copy(filteredSubmissions = filtered, visibleSubmissions = visible) }
    }

    // 查阅错题详情（点击已入错题打开，传入 platform 与 problemId 精准匹配）
    fun openMistakeDetail(platform: String, problemId: String) {
        _uiState.update { it.copy(isLoadingMistakeDetail = true) }
        viewModelScope.launch {
            when (val res = repository.getMistakeDetail(platform = platform, problemId = problemId)) {
                is ApiResult.Success -> {
                    val item = res.data
                    if (item != null) {
                        _uiState.update { it.copy(isLoadingMistakeDetail = false, viewingMistakeDetail = item) }
                    } else {
                        _uiState.update { it.copy(isLoadingMistakeDetail = false, actionMessage = "未查询到错题详情") }
                    }
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isLoadingMistakeDetail = false, actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isLoadingMistakeDetail = false, actionMessage = "网络错误") }
                }
            }
        }
    }

    fun closeMistakeDetail() {
        _uiState.update { it.copy(viewingMistakeDetail = null) }
    }

    fun requestAddToMistake(submission: SubmissionDto) {
        _uiState.update { it.copy(pendingAddToMistake = submission) }
    }

    fun dismissAddToMistake() {
        _uiState.update { it.copy(pendingAddToMistake = null) }
    }

    fun confirmAddToMistake() {
        val submission = _uiState.value.pendingAddToMistake ?: return
        _uiState.update { it.copy(pendingAddToMistake = null, isAddingMistake = true, actionMessage = null) }

        viewModelScope.launch {
            val req = MistakeCreateRequest(
                platform = submission.platform,
                problem_id = submission.problem_id,
                problem_title = submission.problem_title,
                difficulty = submission.difficulty ?: submission.difficulty_score?.toString() ?: "",
                tags = submission.tags,
                key_point = "",
                notes = "",
                problem_url = submission.submission_url ?: "",
                last_submitted_at = submission.submitted_at,
                last_submission_id = submission.raw_id ?: submission.id
            )

            when (val res = repository.addMistake(req)) {
                is ApiResult.Success -> {
                    val key = "${submission.platform}:${submission.problem_id}"
                    _uiState.update {
                        it.copy(
                            isAddingMistake = false,
                            mistakeKeys = it.mistakeKeys + key,
                            actionMessage = "已加入错题集"
                        )
                    }
                    // 入错题成功：触发提交页与错题页缓存立即失效并刷新
                    AppCacheManager.invalidate(CacheTarget.SUBMISSIONS, CacheTarget.MISTAKES)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isAddingMistake = false, actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isAddingMistake = false, actionMessage = "网络请求失败") }
                }
            }
        }
    }

    fun clearActionMessage() {
        _uiState.update { it.copy(actionMessage = null) }
    }
}
