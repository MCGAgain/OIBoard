package com.oiboard.app.ui.contests

import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oiboard.app.data.model.ContestDto
import kotlinx.coroutines.delay
import java.util.Locale

private data class Option(val id: String, val label: String)

private val PLATFORM_OPTIONS = listOf(
    Option("all", "全部"),
    Option("codeforces", "CF"),
    Option("atcoder", "AtCoder"),
    Option("luogu", "洛谷")
)

private val PHASE_OPTIONS = listOf(
    Option("all", "全部日程"),
    Option("CODING", "进行中"),
    Option("BEFORE", "未开赛")
)

@Composable
fun ContestsScreen(
    viewModel: ContestsViewModel
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    // 页面进入或切回时进行 60 秒缓存时效检查
    LaunchedEffect(Unit) {
        viewModel.checkCacheAndRefresh()
    }

    // 全页统一的单向时间状态提供者（通过 lambda 延迟在底层 Text 中读取，彻底阻止整个列表与整卡片每秒重组）
    val currentTimeSecondsState = remember { mutableLongStateOf(System.currentTimeMillis() / 1000) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000L)
            currentTimeSecondsState.longValue = System.currentTimeMillis() / 1000
        }
    }
    val currentTimeProvider = remember { { currentTimeSecondsState.longValue } }

    LaunchedEffect(uiState.syncMessage) {
        uiState.syncMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
            viewModel.clearSyncMessage()
        }
    }

    if (uiState.showSyncDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.showSyncDialog(false) },
            title = {
                Text(
                    text = "同步比赛",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    text = "是否从各平台重新抓取最新赛事日程？该操作通常耗时数秒至数分钟。",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmSync() }) {
                    Text("同步", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.showSyncDialog(false) }) {
                    Text("取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            // 顶栏：标题与操作
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "比赛日历",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (uiState.isSyncing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.primary
                        )
                    } else {
                        IconButton(onClick = { viewModel.showSyncDialog(true) }) {
                            Icon(
                                imageVector = Icons.Outlined.Sync,
                                contentDescription = "同步",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }

                    IconButton(onClick = { viewModel.loadContests(isRefresh = true) }) {
                        Icon(
                            imageVector = Icons.Outlined.Refresh,
                            contentDescription = "刷新",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 平台筛选 Chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                PLATFORM_OPTIONS.forEach { opt ->
                    val isSelected = uiState.selectedPlatform == opt.id
                    FilterChip(
                        selected = isSelected,
                        onClick = { viewModel.selectPlatform(opt.id) },
                        label = {
                            Text(
                                text = opt.label,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        },
                        shape = RoundedCornerShape(12.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            labelColor = MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                        border = null
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            // 状态筛选 Chips (含进行中)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                PHASE_OPTIONS.forEach { opt ->
                    val isSelected = uiState.selectedPhase == opt.id
                    FilterChip(
                        selected = isSelected,
                        onClick = { viewModel.selectPhase(opt.id) },
                        label = {
                            Text(
                                text = opt.label,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        },
                        shape = RoundedCornerShape(12.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.secondaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.onSecondaryContainer,
                            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                            labelColor = MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                        border = null
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // 主体内容
            when {
                uiState.isLoading -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(32.dp),
                            strokeWidth = 3.dp,
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                }
                uiState.errorMessage != null && uiState.rawContests.isEmpty() -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Outlined.EventBusy,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(40.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = uiState.errorMessage ?: "加载失败",
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                uiState.filteredContests.isEmpty() -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Outlined.EventBusy,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(40.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "暂无比赛",
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        items(
                            items = uiState.filteredContests,
                            key = { it.id },
                            contentType = { "contest_card" }
                        ) { contest ->
                            ContestCard(
                                contest = contest,
                                currentTimeProvider = currentTimeProvider,
                                onClick = {
                                    if (contest.url.isNotBlank()) {
                                        try {
                                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(contest.url))
                                            context.startActivity(intent)
                                        } catch (_: Exception) {}
                                    }
                                }
                            )
                        }
                        item(contentType = { "spacer" }) {
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                    }
                }
            }
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp)
        )
    }
}

@Composable
private fun ContestCard(
    contest: ContestDto,
    currentTimeProvider: () -> Long,
    onClick: () -> Unit
) {
    val platformColor = when (contest.platform.lowercase()) {
        "codeforces" -> Color(0xFF1E88E5)
        "atcoder" -> Color(0xFF43A047)
        "luogu" -> Color(0xFFE53935)
        else -> MaterialTheme.colorScheme.primary
    }

    val platformName = when (contest.platform.lowercase()) {
        "codeforces" -> "CF"
        "atcoder" -> "AtCoder"
        "luogu" -> "洛谷"
        else -> contest.platform
    }

    val isRunning = contest.phase.equals("CODING", ignoreCase = true) ||
            contest.phase.equals("RUNNING", ignoreCase = true) ||
            contest.status_text.contains("进行中")

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            // 顶行：平台徽标 + 动态状态/倒计时
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = platformColor.copy(alpha = 0.12f)
                ) {
                    Text(
                        text = platformName,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = platformColor,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                    )
                }

                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (isRunning) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                    }
                ) {
                    if (isRunning) {
                        Text(
                            text = "进行中",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                        )
                    } else {
                        ContestCountdownText(
                            startTimestamp = contest.start_timestamp,
                            fallbackText = contest.status_text,
                            currentTimeProvider = currentTimeProvider
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // 比赛名称
            Text(
                text = contest.name,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                lineHeight = 20.sp
            )

            Spacer(modifier = Modifier.height(10.dp))

            // 时间与时长信息
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Icon(
                        imageVector = Icons.Outlined.AccessTime,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(14.dp)
                    )
                    Text(
                        text = contest.start_time.take(16),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    val durationStr = contest.duration_text ?: contest.duration_str
                    if (!durationStr.isNullOrBlank()) {
                        Text(
                            text = "·",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Icon(
                            imageVector = Icons.Outlined.Timer,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(14.dp)
                        )
                        Text(
                            text = durationStr,
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                if (contest.url.isNotBlank()) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                        contentDescription = "打开",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}

/**
 * 局部隔离倒计时文字组件：
 * 仅该底层 Text 在每秒时钟变化时重组，父卡片、整个 LazyColumn 与页面绝不被无效拉起重组。
 */
@Composable
private fun ContestCountdownText(
    startTimestamp: Long,
    fallbackText: String,
    currentTimeProvider: () -> Long
) {
    val currentEpochSeconds = currentTimeProvider()
    val countdownText = remember(startTimestamp, currentEpochSeconds) {
        if (startTimestamp > currentEpochSeconds) {
            val diff = startTimestamp - currentEpochSeconds
            val days = diff / 86400
            val hours = (diff % 86400) / 3600
            val mins = (diff % 3600) / 60
            val secs = diff % 60
            if (days > 0) {
                "${days}天 ${hours}时"
            } else {
                String.format(Locale.getDefault(), "%02d:%02d:%02d", hours, mins, secs)
            }
        } else {
            fallbackText.ifBlank { "已结束" }
        }
    }
    Text(
        text = countdownText,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
    )
}
