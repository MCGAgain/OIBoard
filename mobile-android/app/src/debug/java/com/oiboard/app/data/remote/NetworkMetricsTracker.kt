package com.oiboard.app.data.remote

import android.util.Log

data class RequestMetric(
    val method: String,
    val pathWithQuery: String,
    val statusCode: Int,
    val responseBytes: Long,
    val durationMs: Long
)

/**
 * Debug-only Network Metrics Tracker:
 * 1. Fixed-capacity circular ring buffer (max 50 items).
 * 2. Desensitized logging to Logcat (method, relative path, status, bytes, ms - NO Token, NO host/address).
 */
object NetworkMetricsTracker {
    private const val MAX_CAPACITY = 50
    private const val TAG = "OIBoard_Net"

    private val lock = Any()
    private val ringBuffer = ArrayDeque<RequestMetric>(MAX_CAPACITY)

    fun record(
        method: String,
        pathWithQuery: String,
        statusCode: Int,
        responseBytes: Long,
        durationMs: Long
    ) {
        val metric = RequestMetric(
            method = method,
            pathWithQuery = pathWithQuery,
            statusCode = statusCode,
            responseBytes = responseBytes,
            durationMs = durationMs
        )

        synchronized(lock) {
            if (ringBuffer.size >= MAX_CAPACITY) {
                ringBuffer.removeFirst()
            }
            ringBuffer.addLast(metric)
        }

        // Desensitized Logcat output only
        Log.d(TAG, "$method $pathWithQuery -> $statusCode (${responseBytes}B, ${durationMs}ms)")
    }
}
