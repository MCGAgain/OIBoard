package com.oiboard.app.ui.submissions

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.AssignmentLate
import androidx.compose.material.icons.outlined.BookmarkAdd
import androidx.compose.material.icons.outlined.BookmarkAdded
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
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
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.SubmissionDto

private data class Option(val id: String, val label: String)

private val PLATFORM_OPTIONS = listOf(
    Option("all", "全部"),
    Option("codeforces", "CF"),
    Option("atcoder", "AtCoder"),
    Option("luogu", "洛谷"),
    Option("acwing", "AcWing"),
    Option("leetcode", "力扣")
)

private val VERDICT_OPTIONS = listOf(
    Option("all", "全部评测"),
    Option("AC", "通过 (AC)"),
    Option("FAILED", "未通过")
)

private val DATE_OPTIONS = listOf(
    Option("all", "全部日期"),
    Option("today", "今天"),
    Option("7days", "近7天"),
    Option("30days", "近30天"),
    Option("this_year", "今年"),
    Option("custom", "自定义")
)

@Composable
fun SubmissionsScreen(
    viewModel: SubmissionsViewModel,
    onOpenMistakeDetail: (MistakeItemDto) -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }
    val listState = rememberLazyListState()

    // 页面进入或切回时进行 30 秒缓存时效检查
    LaunchedEffect(Unit) {
        viewModel.checkCacheAndRefresh()
    }

    // 真正的客户端分页滚动窗口检测（使用 snapshotFlow 避免在每次滚动帧中引起整个界面重组）
    LaunchedEffect(listState) {
        snapshotFlow {
            val layoutInfo = listState.layoutInfo
            val totalItems = layoutInfo.totalItemsCount
            val lastVisibleIndex = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            totalItems > 0 && lastVisibleIndex >= totalItems - 5
        }
        .distinctUntilChanged()
        .filter { it }
        .collect {
            viewModel.loadMore()
        }
    }

    LaunchedEffect(uiState.actionMessage) {
        uiState.actionMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
            viewModel.clearActionMessage()
        }
    }

    // 1. 二次确认弹窗：加入错题集
    uiState.pendingAddToMistake?.let { sub ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissAddToMistake() },
            title = {
                Text(
                    text = "加入错题集",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    text = "确定要将题目【${sub.problem_id} ${sub.problem_title}】加入错题集吗？",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmAddToMistake() }) {
                    Text("加入", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissAddToMistake() }) {
                    Text("取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    // 2. 监听查阅错题笔记请求，滑入全屏错题详情页
    LaunchedEffect(uiState.viewingMistakeDetail) {
        uiState.viewingMistakeDetail?.let { mistake ->
            onOpenMistakeDetail(mistake)
            viewModel.closeMistakeDetail()
        }
    }

    // 3. 自定义日期区间弹窗
    if (uiState.showCustomDateDialog) {
        CustomDateDialog(
            initialStart = uiState.customStartDate,
            initialEnd = uiState.customEndDate,
            onDismiss = { viewModel.dismissCustomDateDialog() },
            onConfirm = { start, end -> viewModel.setCustomDateRange(start, end) }
        )
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            // 顶栏：标题、重置与刷新
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "提交记录",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = { viewModel.resetFilters() }) {
                        Icon(
                            imageVector = Icons.Outlined.RestartAlt,
                            contentDescription = "重置",
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("重置", fontSize = 13.sp, color = MaterialTheme.colorScheme.primary)
                    }

                    IconButton(onClick = { viewModel.loadSubmissions(isRefresh = true) }) {
                        Icon(
                            imageVector = Icons.Outlined.Refresh,
                            contentDescription = "刷新",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(4.dp))

            // 搜索框
            OutlinedTextField(
                value = uiState.searchQuery,
                onValueChange = { viewModel.setSearchQuery(it) },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("搜索题号、题目名称或标签", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Outlined.Search,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp)
                    )
                },
                trailingIcon = {
                    if (uiState.searchQuery.isNotBlank()) {
                        IconButton(onClick = { viewModel.setSearchQuery("") }) {
                            Icon(
                                imageVector = Icons.Outlined.Clear,
                                contentDescription = "清空",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                },
                shape = RoundedCornerShape(14.dp),
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface
                )
            )

            Spacer(modifier = Modifier.height(8.dp))

            // 平台筛选
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

            Spacer(modifier = Modifier.height(4.dp))

            // 评测状态 + 日期区间筛选
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                VERDICT_OPTIONS.forEach { opt ->
                    val isSelected = uiState.selectedVerdict == opt.id
                    FilterChip(
                        selected = isSelected,
                        onClick = { viewModel.selectVerdict(opt.id) },
                        label = {
                            Text(
                                text = opt.label,
                                fontSize = 11.sp,
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

                // 日期区间筛选
                DATE_OPTIONS.forEach { opt ->
                    val isSelected = uiState.selectedDateRange == opt.id
                    FilterChip(
                        selected = isSelected,
                        onClick = { viewModel.selectDateRange(opt.id) },
                        label = {
                            Text(
                                text = opt.label,
                                fontSize = 11.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        },
                        shape = RoundedCornerShape(12.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = MaterialTheme.colorScheme.tertiaryContainer,
                            selectedLabelColor = MaterialTheme.colorScheme.onTertiaryContainer,
                            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                            labelColor = MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                        border = null
                    )
                }
            }

            // 标签动态筛选（若有标签）
            if (uiState.availableTags.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    val allSelected = uiState.selectedTag == "all"
                    FilterChip(
                        selected = allSelected,
                        onClick = { viewModel.selectTag("all") },
                        label = { Text("全部标签", fontSize = 11.sp) },
                        shape = RoundedCornerShape(10.dp),
                        border = null
                    )
                    uiState.availableTags.take(12).forEach { tag ->
                        val isSelected = uiState.selectedTag.equals(tag, ignoreCase = true)
                        FilterChip(
                            selected = isSelected,
                            onClick = { viewModel.selectTag(tag) },
                            label = { Text(tag, fontSize = 11.sp) },
                            shape = RoundedCornerShape(10.dp),
                            border = null
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 列表主体
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
                uiState.errorMessage != null && uiState.allSubmissions.isEmpty() -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Outlined.AssignmentLate,
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
                uiState.filteredSubmissions.isEmpty() -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Outlined.AssignmentLate,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(40.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "暂无提交",
                                fontSize = 14.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                else -> {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(
                            items = uiState.visibleSubmissions,
                            key = { it.id.ifBlank { "${it.platform}_${it.raw_id}_${it.problem_id}" } },
                            contentType = { "submission_card" }
                        ) { sub ->
                            val key = "${sub.platform}:${sub.problem_id}"
                            val isMistake = uiState.mistakeKeys.contains(key)
                            SubmissionCard(
                                submission = sub,
                                isMistake = isMistake,
                                onAddToMistake = { viewModel.requestAddToMistake(sub) },
                                onViewMistakeNote = { viewModel.openMistakeDetail(sub.platform, sub.problem_id) },
                                onClickUrl = {
                                    val url = sub.submission_url
                                    if (!url.isNullOrBlank()) {
                                        try {
                                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
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
private fun SubmissionCard(
    submission: SubmissionDto,
    isMistake: Boolean,
    onAddToMistake: () -> Unit,
    onViewMistakeNote: () -> Unit,
    onClickUrl: () -> Unit
) {
    val platformColor = when (submission.platform.lowercase()) {
        "codeforces" -> Color(0xFF1E88E5)
        "atcoder" -> Color(0xFF43A047)
        "luogu" -> Color(0xFFE53935)
        "acwing" -> Color(0xFF00ACC1)
        "leetcode", "leetcode_cn" -> Color(0xFFFFA000)
        else -> MaterialTheme.colorScheme.primary
    }

    val platformName = when (submission.platform.lowercase()) {
        "codeforces" -> "CF"
        "atcoder" -> "AtCoder"
        "luogu" -> "洛谷"
        "acwing" -> "AcWing"
        "leetcode", "leetcode_cn" -> "力扣"
        else -> submission.platform
    }

    val isAc = submission.verdict.equals("AC", ignoreCase = true)
    val verdictColor = if (isAc) {
        Color(0xFF2E7D32)
    } else when (submission.verdict.uppercase()) {
        "WA", "RE" -> Color(0xFFC62828)
        "TLE", "MLE" -> Color(0xFFEF6C00)
        else -> Color(0xFF757575)
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp)),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            // 顶行：平台徽标 + 题号标题 + 评测结果
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = platformColor.copy(alpha = 0.12f)
                ) {
                    Text(
                        text = platformName,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = platformColor,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }

                Spacer(modifier = Modifier.width(8.dp))

                Text(
                    text = "${submission.problem_id} ${submission.problem_title}",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )

                Spacer(modifier = Modifier.width(8.dp))

                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = verdictColor.copy(alpha = 0.12f)
                ) {
                    Text(
                        text = submission.verdict.ifBlank { "PENDING" },
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = verdictColor,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 中间：语言、难度、标签
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (!submission.code_language.isNullOrBlank()) {
                    Text(
                        text = submission.code_language,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                val diff = submission.difficulty ?: submission.difficulty_score?.toString()
                if (!diff.isNullOrBlank() && diff != "0") {
                    Text(
                        text = "· 难度 $diff",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                if (submission.tags.isNotEmpty()) {
                    Text(
                        text = "· ${submission.tags.take(2).joinToString(", ")}",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // 底行：提交时间 + 入错题按钮/已入笔记按钮 + 外链图标
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = submission.submitted_at.take(16),
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (isMistake) {
                        Surface(
                            onClick = onViewMistakeNote,
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.7f)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.BookmarkAdded,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(12.dp)
                                )
                                Text(
                                    text = "已入错题 · 笔记",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer
                                )
                            }
                        }
                    } else {
                        OutlinedButton(
                            onClick = onAddToMistake,
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                            modifier = Modifier.height(26.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.BookmarkAdd,
                                contentDescription = null,
                                modifier = Modifier.size(12.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("入错题", fontSize = 10.sp, fontWeight = FontWeight.Medium)
                        }
                    }

                    if (!submission.submission_url.isNullOrBlank()) {
                        IconButton(
                            onClick = onClickUrl,
                            modifier = Modifier.size(26.dp)
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                                contentDescription = "查看详情",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(15.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CustomDateDialog(
    initialStart: String,
    initialEnd: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit
) {
    var start by remember { mutableStateOf(initialStart) }
    var end by remember { mutableStateOf(initialEnd) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = "自定义日期区间",
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                modifier = Modifier.imePadding(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "请输入日期格式 (如 2026-10-01)",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = start,
                    onValueChange = { start = it },
                    label = { Text("起始日期") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp)
                )
                OutlinedTextField(
                    value = end,
                    onValueChange = { end = it },
                    label = { Text("截止日期") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp)
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(start.trim(), end.trim()) }) {
                Text("确定", fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
