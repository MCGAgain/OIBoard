package com.oiboard.app.data.local

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

enum class CacheTarget {
    OVERVIEW,
    CONTESTS,
    SUBMISSIONS,
    MISTAKES
}

/**
 * 全局缓存失效与刷新事件总线：
 * 任何写操作成功后，精确触发相关页面的缓存失效并启动静默刷新。
 */
object AppCacheManager {
    private val _invalidationEvents = MutableSharedFlow<Set<CacheTarget>>(extraBufferCapacity = 32)
    val invalidationEvents: SharedFlow<Set<CacheTarget>> = _invalidationEvents.asSharedFlow()

    fun invalidate(vararg targets: CacheTarget) {
        _invalidationEvents.tryEmit(targets.toSet())
    }
}
