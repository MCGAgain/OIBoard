package com.oiboard.app.ui.overview

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.Equalizer
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oiboard.app.data.model.ContestDto
import com.oiboard.app.ui.overview.charts.ClimbingCurveCanvas
import com.oiboard.app.ui.overview.charts.DailyEffortCanvas
import com.oiboard.app.ui.overview.charts.HeatmapCanvas
import com.oiboard.app.ui.overview.charts.PlatformsDonutCanvas
import com.oiboard.app.ui.overview.charts.TagsDistributionCanvas

@Composable
fun OverviewScreen(
    viewModel: OverviewViewModel,
    modifier: Modifier = Modifier,
    onNavigateToContests: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // 页面进入或切回时进行 60 秒缓存时效检查
    androidx.compose.runtime.LaunchedEffect(Unit) {
        viewModel.checkCacheAndRefresh()
    }

    if (uiState.isLoading && uiState.overview == null) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(36.dp),
                strokeWidth = 3.dp,
                color = MaterialTheme.colorScheme.primary
            )
        }
        return
    }

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Spacer(modifier = Modifier.height(4.dp))
            OverviewHeader(
                lastSyncTime = uiState.overview?.last_sync_time,
                isRefreshing = uiState.isRefreshing,
                onRefresh = viewModel::refresh
            )
        }

        if (uiState.errorMessage != null) {
            item {
                ErrorBanner(
                    message = uiState.errorMessage ?: "",
                    onRetry = viewModel::refresh
                )
            }
        }

        // KPI Metric Cards
        item {
            val stats = uiState.overview?.stats
            val totalAc = stats?.total_ac ?: 0
            val totalSubs = stats?.total_subs ?: 0
            val todayAc = stats?.today_ac ?: 0
            val todaySubs = stats?.today_subs ?: 0
            val streak = stats?.streak ?: 0
            val acRate = if (totalSubs > 0) (totalAc.toFloat() / totalSubs * 100).toInt() else 0

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    KpiCard(
                        title = "累计通过",
                        mainValue = "$totalAc 题",
                        subBadge = if (todayAc > 0) "+今日 $todayAc" else null,
                        icon = Icons.Outlined.CheckCircle,
                        modifier = Modifier.weight(1f)
                    )
                    KpiCard(
                        title = "通过率",
                        mainValue = "$acRate%",
                        subBadge = "总提交 $totalSubs",
                        icon = Icons.Outlined.Equalizer,
                        modifier = Modifier.weight(1f)
                    )
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    KpiCard(
                        title = "连续活跃",
                        mainValue = "$streak 天",
                        subBadge = "最长连续",
                        icon = Icons.Outlined.LocalFireDepartment,
                        modifier = Modifier.weight(1f)
                    )
                    KpiCard(
                        title = "今日提交",
                        mainValue = "$todaySubs 次",
                        subBadge = "今日通过 $todayAc",
                        icon = Icons.Outlined.DateRange,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }

        // Upcoming Contests Card
        item {
            UpcomingContestsCard(
                contests = uiState.upcomingContests,
                onNavigateToContests = onNavigateToContests,
                onContestClick = { contest ->
                    if (contest.url.isNotBlank()) {
                        try {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(contest.url))
                            context.startActivity(intent)
                        } catch (_: Exception) {}
                    }
                }
            )
        }

        // Heatmap Card
        item {
            HeatmapSection(
                heatmap = uiState.heatmap?.heatmap ?: emptyList(),
                year = uiState.selectedYear,
                availableYears = uiState.availableYears,
                selectedPlatform = uiState.selectedPlatform,
                onYearSelected = viewModel::onYearChanged,
                onPlatformSelected = viewModel::onPlatformChanged
            )
        }

        // Analytics Workbench
        item {
            AnalyticsWorkbenchCard(
                uiState = uiState,
                onChartTabChanged = viewModel::onChartTabChanged
            )
        }

        item {
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun OverviewHeader(
    lastSyncTime: String?,
    isRefreshing: Boolean,
    onRefresh: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(
                text = "数据总览",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground
            )
            if (!lastSyncTime.isNullOrBlank()) {
                Text(
                    text = "同步: $lastSyncTime",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        IconButton(
            onClick = onRefresh,
            enabled = !isRefreshing
        ) {
            if (isRefreshing) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.primary
                )
            } else {
                Icon(
                    imageVector = Icons.Outlined.Refresh,
                    contentDescription = "刷新",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun KpiCard(
    title: String,
    mainValue: String,
    subBadge: String?,
    icon: ImageVector,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            Text(
                text = mainValue,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )

            if (!subBadge.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = subBadge,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }
    }
}

@Composable
private fun UpcomingContestsCard(
    contests: List<ContestDto>,
    onNavigateToContests: () -> Unit,
    onContestClick: (ContestDto) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Outlined.DateRange,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = MaterialTheme.colorScheme.primary
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "近期比赛",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }

                TextButton(
                    onClick = onNavigateToContests,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.primary)
                ) {
                    Text(
                        text = "全部",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Spacer(modifier = Modifier.width(2.dp))
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            if (contests.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "暂无比赛",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    contests.forEach { contest ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { onContestClick(contest) }
                                .padding(vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Surface(
                                shape = RoundedCornerShape(6.dp),
                                color = MaterialTheme.colorScheme.primaryContainer,
                                modifier = Modifier.padding(end = 10.dp)
                            ) {
                                Text(
                                    text = contest.platform.uppercase(),
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            }

                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = contest.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Text(
                                    text = "${contest.start_time.take(16)} · ${contest.status_text}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }

                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                                contentDescription = "打开链接",
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.outline
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeatmapSection(
    heatmap: List<com.oiboard.app.data.model.HeatmapDayDto>,
    year: Int,
    availableYears: List<Int>,
    selectedPlatform: String,
    onYearSelected: (Int) -> Unit,
    onPlatformSelected: (String) -> Unit
) {
    val platforms = listOf(
        "all" to "全部",
        "acwing" to "AcWing",
        "luogu" to "洛谷",
        "codeforces" to "CF",
        "atcoder" to "AtCoder",
        "leetcode" to "力扣"
    )

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text(
                text = "活跃度",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )

            Spacer(modifier = Modifier.height(10.dp))

            // Year selector chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val years = if (availableYears.contains(year)) availableYears else listOf(year) + availableYears
                years.distinct().sortedDescending().forEach { y ->
                    FilterChip(
                        selected = y == year,
                        onClick = { onYearSelected(y) },
                        label = { Text("${y}年", fontSize = 11.sp) },
                        shape = RoundedCornerShape(12.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            // Platform selector chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                platforms.forEach { (id, name) ->
                    FilterChip(
                        selected = id == selectedPlatform,
                        onClick = { onPlatformSelected(id) },
                        label = { Text(name, fontSize = 11.sp) },
                        shape = RoundedCornerShape(12.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            HeatmapCanvas(
                heatmap = heatmap,
                year = year
            )
        }
    }
}

@Composable
private fun AnalyticsWorkbenchCard(
    uiState: OverviewUiState,
    onChartTabChanged: (ChartTab) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Text(
                text = "统计分析",
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Segment tabs
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                ChartTab.entries.forEach { tab ->
                    val isSelected = uiState.activeChartTab == tab
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = if (isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { onChartTabChanged(tab) }
                    ) {
                        Text(
                            text = tab.label,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                            color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Lazy rendering of the selected chart
            when (uiState.activeChartTab) {
                ChartTab.CLIMBING_CURVE -> {
                    ClimbingCurveCanvas(
                        points = uiState.overview?.climbing_curve ?: emptyList()
                    )
                }
                ChartTab.DAILY_EFFORT -> {
                    DailyEffortCanvas(
                        points = uiState.overview?.daily_effort ?: emptyList()
                    )
                }
                ChartTab.PLATFORMS -> {
                    PlatformsDonutCanvas(
                        platforms = uiState.overview?.stats?.platforms ?: emptyMap()
                    )
                }
                ChartTab.TAGS -> {
                    TagsDistributionCanvas(
                        tags = uiState.tags
                    )
                }
            }
        }
    }
}

@Composable
private fun ErrorBanner(
    message: String,
    onRetry: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Warning,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer
                )
            }
            TextButton(
                onClick = onRetry,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
            ) {
                Text(text = "重试", fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}
