package com.oiboard.app.ui.overview

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.Equalizer
import androidx.compose.material.icons.outlined.LocalFireDepartment
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oiboard.app.data.model.ContestDto
import com.oiboard.app.ui.components.AnimatedMetricNumber
import com.oiboard.app.ui.components.TactileGlassCard
import com.oiboard.app.ui.components.TactileIconBadge
import com.oiboard.app.ui.components.TactilePlatformBadge
import com.oiboard.app.ui.components.TactileRecessedWell
import com.oiboard.app.ui.overview.charts.ClimbingCurveCanvas
import com.oiboard.app.ui.overview.charts.DailyEffortCanvas
import com.oiboard.app.ui.overview.charts.HeatmapCanvas
import com.oiboard.app.ui.overview.charts.PlatformsDonutCanvas
import com.oiboard.app.ui.overview.charts.TagsDistributionCanvas
import com.oiboard.app.ui.theme.LocalAnimationsEnabled
import com.oiboard.app.ui.theme.LocalIsDarkTheme

@Composable
fun OverviewScreen(
    viewModel: OverviewViewModel,
    modifier: Modifier = Modifier,
    onNavigateToContests: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var selectedPlan by rememberSaveable { mutableStateOf("PLAN_A") }

    // 页面进入或切回时进行 60 秒缓存时效检查
    androidx.compose.runtime.LaunchedEffect(Unit) {
        viewModel.checkCacheAndRefresh()
    }

    if (uiState.isLoading && uiState.overview == null) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .background(Color.Transparent)
                .statusBarsPadding(),
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
            .background(Color.Transparent)
            .statusBarsPadding()
            .padding(horizontal = 16.dp),
        contentPadding = PaddingValues(top = 8.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item(key = "overview_header", contentType = "overview_header") {
            OverviewHeader(
                lastSyncTime = uiState.overview?.last_sync_time,
                isOffline = uiState.isOffline,
                isRefreshing = uiState.isRefreshing,
                onRefresh = viewModel::refresh
            )
        }

        if (uiState.errorMessage != null) {
            item(key = "overview_error", contentType = "overview_error") {
                ErrorBanner(
                    message = uiState.errorMessage ?: "",
                    onRetry = viewModel::refresh
                )
            }
        }

        // KPI Metric Cards
        item(key = "kpi_metrics_section", contentType = "overview_kpis") {
            val stats = uiState.overview?.stats
            val totalAc = stats?.total_ac ?: 0
            val totalSubs = stats?.total_subs ?: 0
            val todayAc = stats?.today_ac ?: 0
            val todaySubs = stats?.today_subs ?: 0
            val streak = stats?.streak ?: 0
            val acRate = if (totalSubs > 0) (totalAc.toFloat() / totalSubs * 100).toInt() else 0

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(IntrinsicSize.Max),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    KpiCard(
                        title = "累计通过",
                        value = totalAc,
                        suffix = " 题",
                        subBadge = "今日通过 $todayAc",
                        icon = Icons.Outlined.CheckCircle,
                        accentTint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                    )
                    KpiCard(
                        title = "通过率",
                        value = acRate,
                        suffix = "%",
                        subBadge = "总提交 $totalSubs",
                        icon = Icons.Outlined.Equalizer,
                        accentTint = Color(0xFF6366F1),
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(IntrinsicSize.Max),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    KpiCard(
                        title = "连续活跃",
                        value = streak,
                        suffix = " 天",
                        subBadge = "活跃天数",
                        icon = Icons.Outlined.LocalFireDepartment,
                        accentTint = Color(0xFFF59E0B),
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                    )
                    KpiCard(
                        title = "今日提交",
                        value = todaySubs,
                        suffix = " 次",
                        subBadge = "今日通过 $todayAc",
                        icon = Icons.Outlined.DateRange,
                        accentTint = Color(0xFF10B981),
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                    )
                }

                // 方案 B：拆成两张卡，与现有四张组成 2×3
                if (selectedPlan == "PLAN_B") {
                    LocalCodeCardsPlanB(
                        localCode = uiState.overview?.local_code,
                        onSwitchPlan = { selectedPlan = "PLAN_A" }
                    )
                }
            }
        }

        // 方案 A：通栏长卡片（位于 2×2 卡片下方，左右对称）
        if (selectedPlan == "PLAN_A") {
            item(key = "local_code_plan_a", contentType = "overview_local_code") {
                LocalCodeCardPlanA(
                    localCode = uiState.overview?.local_code,
                    onSwitchPlan = { selectedPlan = "PLAN_B" }
                )
            }
        }

        // Upcoming Contests Card
        item(key = "upcoming_contests", contentType = "overview_upcoming") {
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
        item(key = "heatmap_section", contentType = "overview_heatmap") {
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
        item(key = "analytics_workbench", contentType = "overview_analytics") {
            AnalyticsWorkbenchCard(
                uiState = uiState,
                onChartTabChanged = viewModel::onChartTabChanged
            )
        }

        item(key = "bottom_spacer", contentType = "overview_spacer") {
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun OverviewHeader(
    lastSyncTime: String?,
    isOffline: Boolean = false,
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isOffline) {
                    Icon(
                        imageVector = Icons.Outlined.CloudOff,
                        contentDescription = "离线缓存",
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.tertiary
                    )
                    Spacer(modifier = Modifier.width(3.dp))
                    Text(
                        text = "离线缓存",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.tertiary
                    )
                    if (!lastSyncTime.isNullOrBlank()) {
                        Text(
                            text = " · 同步: $lastSyncTime",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else if (!lastSyncTime.isNullOrBlank()) {
                    Text(
                        text = "同步: $lastSyncTime",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
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
    value: Int,
    suffix: String,
    subBadge: String?,
    icon: ImageVector,
    accentTint: Color,
    modifier: Modifier = Modifier
) {
    TactileGlassCard(
        modifier = modifier.fillMaxHeight(),
        cornerRadius = 20.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight()
                .padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                TactileIconBadge(
                    icon = icon,
                    tint = accentTint,
                    size = 28.dp,
                    iconSize = 15.dp
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            Column {
                AnimatedMetricNumber(
                    targetValue = value,
                    suffix = suffix,
                    style = MaterialTheme.typography.headlineSmall.copy(
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold
                    ),
                    color = MaterialTheme.colorScheme.onSurface
                )

                Spacer(modifier = Modifier.height(4.dp))

                if (!subBadge.isNullOrBlank()) {
                    Text(
                        text = subBadge,
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                        color = accentTint,
                        maxLines = 1
                    )
                } else {
                    Text(
                        text = " ",
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                        maxLines = 1
                    )
                }
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
    TactileGlassCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 20.dp
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TactileIconBadge(
                        icon = Icons.Outlined.DateRange,
                        tint = MaterialTheme.colorScheme.primary,
                        size = 28.dp,
                        iconSize = 15.dp
                    )
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

            Spacer(modifier = Modifier.height(8.dp))

            if (contests.isEmpty()) {
                TactileRecessedWell(
                    modifier = Modifier.fillMaxWidth(),
                    cornerRadius = 12.dp
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 14.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "暂无比赛",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    contests.forEach { contest ->
                        TactileRecessedWell(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { onContestClick(contest) },
                            cornerRadius = 12.dp
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                TactilePlatformBadge(
                                    platform = contest.platform,
                                    modifier = Modifier.padding(end = 10.dp)
                                )

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

    TactileGlassCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 20.dp
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

            val animationsEnabled = LocalAnimationsEnabled.current
            val animProgress = remember { Animatable(if (animationsEnabled) 0f else 1f) }
            androidx.compose.runtime.LaunchedEffect(heatmap, year, animationsEnabled) {
                if (!animationsEnabled) {
                    animProgress.snapTo(1f)
                } else if (heatmap.isNotEmpty()) {
                    animProgress.snapTo(0f)
                    animProgress.animateTo(1f, animationSpec = tween(260, easing = FastOutSlowInEasing))
                } else {
                    animProgress.snapTo(1f)
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .graphicsLayer {
                        alpha = animProgress.value
                        translationY = (1f - animProgress.value) * 10f
                    }
            ) {
                HeatmapCanvas(
                    heatmap = heatmap,
                    year = year
                )
            }
        }
    }
}

@Composable
private fun AnalyticsWorkbenchCard(
    uiState: OverviewUiState,
    onChartTabChanged: (ChartTab) -> Unit
) {
    val isDark = LocalIsDarkTheme.current
    val animationsEnabled = LocalAnimationsEnabled.current

    TactileGlassCard(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 20.dp
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TactileIconBadge(
                    icon = Icons.Outlined.Equalizer,
                    tint = MaterialTheme.colorScheme.primary,
                    size = 28.dp,
                    iconSize = 15.dp
                )
                Text(
                    text = "统计分析",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Segment tabs inside recessed well
            TactileRecessedWell(
                modifier = Modifier.fillMaxWidth(),
                cornerRadius = 14.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    ChartTab.entries.forEach { tab ->
                        val isSelected = uiState.activeChartTab == tab
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = if (isSelected) MaterialTheme.colorScheme.surface else Color.Transparent,
                            border = if (isSelected) {
                                BorderStroke(
                                    0.75.dp,
                                    if (isDark) Color.White.copy(alpha = 0.14f) else Color.Black.copy(alpha = 0.08f)
                                )
                            } else null,
                            shadowElevation = 0.dp,
                            modifier = Modifier
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onChartTabChanged(tab) }
                        ) {
                            Text(
                                text = tab.label,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            AnimatedContent(
                targetState = uiState.activeChartTab,
                transitionSpec = {
                    if (!animationsEnabled) {
                        fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                    } else {
                        fadeIn(tween(140)) togetherWith fadeOut(tween(100))
                    }
                },
                label = "overview_chart_tab"
            ) { tab ->
                when (tab) {
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
