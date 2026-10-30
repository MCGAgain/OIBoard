package com.oiboard.app.data.remote

/**
 * Release no-op implementation of NetworkMetricsTracker.
 * Completely empty, zero allocations, zero Logcat output.
 */
object NetworkMetricsTracker {
    @Suppress("UNUSED_PARAMETER")
    fun record(
        method: String,
        pathWithQuery: String,
        statusCode: Int,
        responseBytes: Long,
        durationMs: Long
    ) {
        // No-op in release
    }
}
