package com.oiboard.app.ui.mistakes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.oiboard.app.data.local.AppCacheManager
import com.oiboard.app.data.local.CacheTarget
import com.oiboard.app.data.model.ApiResult
import com.oiboard.app.data.model.MistakeCountsDto
import com.oiboard.app.data.model.MistakeCreateRequest
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.MistakeUpdateRequest
import com.oiboard.app.data.repository.MistakesRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class MistakesUiState(
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isLoadingNextPage: Boolean = false,
    val mistakes: List<MistakeItemDto> = emptyList(),
    val counts: MistakeCountsDto = MistakeCountsDto(),
    val selectedStatus: String = "all",
    val searchQuery: String = "",
    val currentPage: Int = 1,
    val hasNextPage: Boolean = true,
    val errorMessage: String? = null,
    // 弹窗状态
    val selectedMistakeForDetail: MistakeItemDto? = null,
    val showAddDialog: Boolean = false,
    val editingMistake: MistakeItemDto? = null,
    val pendingDeleteMistake: MistakeItemDto? = null,
    val pendingReviewMistake: MistakeItemDto? = null,
    val pendingToggleMasterMistake: MistakeItemDto? = null,
    val isActionInProgress: Boolean = false,
    val actionMessage: String? = null
)

class MistakesViewModel(
    private val repository: MistakesRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(MistakesUiState())
    val uiState: StateFlow<MistakesUiState> = _uiState.asStateFlow()

    private var lastFetchTime: Long = 0L

    companion object {
        const val MAX_MISTAKES = 150
        const val PAGE_SIZE = 50
        const val CACHE_TTL_MS = 30_000L // 错题页 30 秒时效缓存

        fun provideFactory(repository: MistakesRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return MistakesViewModel(repository) as T
                }
            }
    }

    init {
        loadMistakes()
        observeCacheInvalidation()
    }

    private fun observeCacheInvalidation() {
        viewModelScope.launch {
            AppCacheManager.invalidationEvents.collect { targets ->
                if (CacheTarget.MISTAKES in targets) {
                    lastFetchTime = 0L // 立即失效
                    loadMistakes(isRefresh = false, isSilent = true) // 静默刷新错题列表
                }
            }
        }
    }

    /**
     * 30 秒时效缓存检查：
     * 时效内切回错题页直接展示，过期后后台静默刷新；下拉刷新强制拉取。
     */
    fun checkCacheAndRefresh() {
        val now = System.currentTimeMillis()
        if (_uiState.value.mistakes.isNotEmpty()) {
            if (now - lastFetchTime > CACHE_TTL_MS) {
                loadMistakes(isRefresh = false, isSilent = true)
            }
        } else {
            loadMistakes(isRefresh = false, isSilent = false)
        }
    }

    fun selectStatus(status: String) {
        if (_uiState.value.selectedStatus == status) return
        _uiState.update { it.copy(selectedStatus = status, currentPage = 1) }
        loadMistakes()
    }

    fun setSearchQuery(query: String) {
        if (_uiState.value.searchQuery == query) return
        _uiState.update { it.copy(searchQuery = query, currentPage = 1) }
        loadMistakes()
    }

    fun loadMistakes(isRefresh: Boolean = false, isSilent: Boolean = false) {
        viewModelScope.launch {
            if (!isSilent) {
                _uiState.update {
                    if (isRefresh) it.copy(isRefreshing = true, errorMessage = null, currentPage = 1)
                    else it.copy(isLoading = true, errorMessage = null, currentPage = 1)
                }
            }

            val status = _uiState.value.selectedStatus
            val query = _uiState.value.searchQuery.trim()

            when (val res = repository.getMistakes(status = status, search = query, page = 1, pageSize = PAGE_SIZE)) {
                is ApiResult.Success -> {
                    lastFetchTime = System.currentTimeMillis()
                    val items = res.data.items
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            mistakes = items.take(MAX_MISTAKES),
                            counts = res.data.counts,
                            currentPage = 1,
                            hasNextPage = items.size >= PAGE_SIZE,
                            errorMessage = null
                        )
                    }
                }
                is ApiResult.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            errorMessage = res.message
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

    // 滑动到底部时加载下一页（服务端真实分页，内存严格限制最多 150 条）
    fun loadNextPage() {
        val state = _uiState.value
        if (state.isLoading || state.isLoadingNextPage || !state.hasNextPage) return

        val nextPage = state.currentPage + 1
        _uiState.update { it.copy(isLoadingNextPage = true) }

        viewModelScope.launch {
            val status = state.selectedStatus
            val query = state.searchQuery.trim()

            when (val res = repository.getMistakes(status = status, search = query, page = nextPage, pageSize = PAGE_SIZE)) {
                is ApiResult.Success -> {
                    val newItems = res.data.items
                    val combined = (state.mistakes + newItems)
                    // 若超过最大上限，丢弃最早的页保持平滑与低内存
                    val bounded = if (combined.size > MAX_MISTAKES) combined.takeLast(MAX_MISTAKES) else combined

                    _uiState.update {
                        it.copy(
                            isLoadingNextPage = false,
                            mistakes = bounded,
                            currentPage = nextPage,
                            hasNextPage = newItems.size >= PAGE_SIZE
                        )
                    }
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isLoadingNextPage = false) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isLoadingNextPage = false) }
                }
            }
        }
    }

    // 详情页（打开时才请求最新详情）
    fun openDetail(mistake: MistakeItemDto) {
        _uiState.update { it.copy(selectedMistakeForDetail = mistake) }
        viewModelScope.launch {
            when (val res = repository.getMistakes(search = mistake.problem_id, page = 1, pageSize = 20)) {
                is ApiResult.Success -> {
                    val fresh = res.data.items.firstOrNull { it.id == mistake.id }
                    if (fresh != null) {
                        _uiState.update { it.copy(selectedMistakeForDetail = fresh) }
                    }
                }
                else -> {}
            }
        }
    }

    fun closeDetail() {
        _uiState.update { it.copy(selectedMistakeForDetail = null) }
    }

    // 新增表单
    fun showAddForm(show: Boolean) {
        _uiState.update { it.copy(showAddDialog = show) }
    }

    fun submitAdd(request: MistakeCreateRequest) {
        _uiState.update { it.copy(showAddDialog = false, isActionInProgress = true, actionMessage = null) }
        viewModelScope.launch {
            when (val res = repository.addMistake(request)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "已录入错题") }
                    loadMistakes(isRefresh = true)
                    AppCacheManager.invalidate(CacheTarget.MISTAKES, CacheTarget.SUBMISSIONS)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "录入失败: 网络错误") }
                }
            }
        }
    }

    // 编辑表单
    fun showEditForm(mistake: MistakeItemDto?) {
        _uiState.update { it.copy(editingMistake = mistake) }
    }

    fun submitEdit(mistakeId: Int, request: MistakeUpdateRequest) {
        _uiState.update { it.copy(editingMistake = null, isActionInProgress = true, actionMessage = null) }
        viewModelScope.launch {
            when (val res = repository.updateMistake(mistakeId, request)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "已更新错题") }
                    loadMistakes(isRefresh = true)
                    AppCacheManager.invalidate(CacheTarget.MISTAKES, CacheTarget.OVERVIEW)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "更新失败: 网络错误") }
                }
            }
        }
    }

    // 删除流程（二次确认）
    fun requestDelete(mistake: MistakeItemDto) {
        _uiState.update { it.copy(pendingDeleteMistake = mistake) }
    }

    fun dismissDelete() {
        _uiState.update { it.copy(pendingDeleteMistake = null) }
    }

    fun confirmDelete() {
        val mistake = _uiState.value.pendingDeleteMistake ?: return
        _uiState.update { it.copy(pendingDeleteMistake = null, isActionInProgress = true, actionMessage = null) }

        viewModelScope.launch {
            when (val res = repository.deleteMistake(mistake.id)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "已删除错题") }
                    loadMistakes(isRefresh = true)
                    AppCacheManager.invalidate(CacheTarget.MISTAKES, CacheTarget.OVERVIEW)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "删除失败: 网络错误") }
                }
            }
        }
    }

    // 复习流程（二次确认，统一规范为“复习”）
    fun requestReview(mistake: MistakeItemDto) {
        _uiState.update { it.copy(pendingReviewMistake = mistake) }
    }

    fun dismissReview() {
        _uiState.update { it.copy(pendingReviewMistake = null) }
    }

    fun confirmReview() {
        val mistake = _uiState.value.pendingReviewMistake ?: return
        _uiState.update { it.copy(pendingReviewMistake = null, isActionInProgress = true, actionMessage = null) }

        viewModelScope.launch {
            when (val res = repository.reviewMistake(mistake.id)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "复习进度已推进") }
                    loadMistakes(isRefresh = true)
                    AppCacheManager.invalidate(CacheTarget.MISTAKES, CacheTarget.OVERVIEW)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "复习记录失败: 网络错误") }
                }
            }
        }
    }

    // 切换掌握状态（二次确认）
    fun requestToggleMaster(mistake: MistakeItemDto) {
        _uiState.update { it.copy(pendingToggleMasterMistake = mistake) }
    }

    fun dismissToggleMaster() {
        _uiState.update { it.copy(pendingToggleMasterMistake = null) }
    }

    fun confirmToggleMaster() {
        val mistake = _uiState.value.pendingToggleMasterMistake ?: return
        val newMastered = mistake.status != "mastered"
        _uiState.update { it.copy(pendingToggleMasterMistake = null, isActionInProgress = true, actionMessage = null) }

        viewModelScope.launch {
            when (val res = repository.toggleMaster(mistake.id, newMastered)) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            isActionInProgress = false,
                            actionMessage = if (newMastered) "已标记为已掌握" else "已移入待复习"
                        )
                    }
                    loadMistakes(isRefresh = true)
                    AppCacheManager.invalidate(CacheTarget.MISTAKES, CacheTarget.OVERVIEW)
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isActionInProgress = false, actionMessage = "操作失败: 网络错误") }
                }
            }
        }
    }

    fun clearActionMessage() {
        _uiState.update { it.copy(actionMessage = null) }
    }
}
