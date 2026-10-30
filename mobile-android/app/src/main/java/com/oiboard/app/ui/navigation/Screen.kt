package com.oiboard.app.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Dashboard
import androidx.compose.material.icons.filled.Tune
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(
    val route: String,
    val title: String,
    val icon: ImageVector
) {
    object Overview : Screen("overview", "总览", Icons.Default.Dashboard)
    object Contests : Screen("contests", "比赛", Icons.Default.CalendarMonth)
    object Submissions : Screen("submissions", "提交", Icons.AutoMirrored.Filled.ReceiptLong)
    object Mistakes : Screen("mistakes", "错题", Icons.AutoMirrored.Filled.MenuBook)
    object Settings : Screen("settings", "设置", Icons.Default.Tune)

    companion object {
        val items get() = listOf(Overview, Contests, Submissions, Mistakes, Settings)
    }
}
