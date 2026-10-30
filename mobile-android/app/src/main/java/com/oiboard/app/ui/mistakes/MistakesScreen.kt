package com.oiboard.app.ui.mistakes

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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Replay
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Star
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
import com.oiboard.app.data.model.MistakeCreateRequest
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.MistakeUpdateRequest

private data class StatusFilter(val id: String, val label: String)

@Composable
fun MistakesScreen(
    viewModel: MistakesViewModel,
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

    // 服务端真实分页滑动监听（使用 snapshotFlow 去重监听，避免滚动时反复重组外层）
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
            viewModel.loadNextPage()
        }
    }

    LaunchedEffect(uiState.actionMessage) {
        uiState.actionMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
            viewModel.clearActionMessage()
        }
    }

    // 1. 删除二次确认弹窗
    uiState.pendingDeleteMistake?.let { mistake ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissDelete() },
            title = {
                Text(
                    text = "删除错题",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    text = "此操作不可撤销，确定从错题集中删除【${mistake.problem_title}】吗？",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmDelete() }) {
                    Text("删除", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissDelete() }) {
                    Text("取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    // 2. 复习确认弹窗
    uiState.pendingReviewMistake?.let { mistake ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissReview() },
            title = {
                Text(
                    text = "复习题目",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    text = "记录一次题目复习？当前为第 ${mistake.review_count}/6 轮，确认后将按艾宾浩斯周期推进下次复习日期。",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmReview() }) {
                    Text("复习", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissReview() }) {
                    Text("取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    // 3. 切换掌握二次确认弹窗
    uiState.pendingToggleMasterMistake?.let { mistake ->
        val isMastered = mistake.status == "mastered"
        AlertDialog(
            onDismissRequest = { viewModel.dismissToggleMaster() },
            title = {
                Text(
                    text = "切换掌握",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    text = if (isMastered) "确定将题目恢复为待复习状态？" else "确定将题目标记为已完全掌握？",
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmToggleMaster() }) {
                    Text("确定", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissToggleMaster() }) {
                    Text("取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    // 4. 监听错题详情更新并滑入全屏页
    LaunchedEffect(uiState.selectedMistakeForDetail) {
        uiState.selectedMistakeForDetail?.let { detail ->
            onOpenMistakeDetail(detail)
            viewModel.closeDetail()
        }
    }

    // 5. 新增 / 编辑错题表单弹窗
    if (uiState.showAddDialog) {
        MistakeFormDialog(
            initialMistake = null,
            onDismiss = { viewModel.showAddForm(false) },
            onConfirmAdd = { viewModel.submitAdd(it) },
            onConfirmEdit = { _, _ -> }
        )
    }

    uiState.editingMistake?.let { editing ->
        MistakeFormDialog(
            initialMistake = editing,
            onDismiss = { viewModel.showEditForm(null) },
            onConfirmAdd = { },
            onConfirmEdit = { id, req -> viewModel.submitEdit(id, req) }
        )
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            // 顶栏：标题、新增与刷新
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "错题集",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onBackground
                )

                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { viewModel.showAddForm(true) }) {
                        Icon(
                            imageVector = Icons.Outlined.Add,
                            contentDescription = "新增",
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }

                    IconButton(onClick = { viewModel.loadMistakes(isRefresh = true) }) {
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
                placeholder = { Text("搜索题号、考点或笔记", fontSize = 13.sp) },
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

            // 状态筛选 Chips (带各状态计数，remember 缓存避免重复分配集合)
            val counts = uiState.counts
            val statusFilters = remember(counts) {
                listOf(
                    StatusFilter("all", "全部 ${counts.total}"),
                    StatusFilter("due", "待复习 ${counts.due}"),
                    StatusFilter("pending_review", "复习中 ${counts.in_progress}"),
                    StatusFilter("mastered", "已掌握 ${counts.mastered}")
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                statusFilters.forEach { filter ->
                    val isSelected = uiState.selectedStatus == filter.id
                    val isDueTab = filter.id == "due" && counts.due > 0
                    FilterChip(
                        selected = isSelected,
                        onClick = { viewModel.selectStatus(filter.id) },
                        label = {
                            Text(
                                text = filter.label,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected || isDueTab) FontWeight.Bold else FontWeight.Normal,
                                color = if (isDueTab && !isSelected) MaterialTheme.colorScheme.error else Color.Unspecified
                            )
                        },
                        shape = RoundedCornerShape(12.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = if (isDueTab) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer,
                            selectedLabelColor = if (isDueTab) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onPrimaryContainer,
                            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            labelColor = MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                        border = null
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

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
                uiState.errorMessage != null && uiState.mistakes.isEmpty() -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Outlined.AutoStories,
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
                uiState.mistakes.isEmpty() -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Outlined.AutoStories,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(40.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "暂无错题",
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
                            items = uiState.mistakes,
                            key = { it.id },
                            contentType = { "mistake_card" }
                        ) { mistake ->
                            MistakeCard(
                                mistake = mistake,
                                onClick = {
                                    onOpenMistakeDetail(mistake)
                                    viewModel.openDetail(mistake)
                                },
                                onReview = { viewModel.requestReview(mistake) },
                                onToggleMaster = { viewModel.requestToggleMaster(mistake) },
                                onEdit = { viewModel.showEditForm(mistake) },
                                onDelete = { viewModel.requestDelete(mistake) },
                                onClickUrl = {
                                    val url = mistake.problem_url
                                    if (!url.isNullOrBlank()) {
                                        try {
                                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                            context.startActivity(intent)
                                        } catch (_: Exception) {}
                                    }
                                }
                            )
                        }
                        if (uiState.isLoadingNextPage) {
                            item(contentType = { "loading" }) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 8.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                }
                            }
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
private fun MistakeCard(
    mistake: MistakeItemDto,
    onClick: () -> Unit,
    onReview: () -> Unit,
    onToggleMaster: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onClickUrl: () -> Unit
) {
    val platformColor = when (mistake.platform.lowercase()) {
        "codeforces" -> Color(0xFF1E88E5)
        "atcoder" -> Color(0xFF43A047)
        "luogu" -> Color(0xFFE53935)
        "acwing" -> Color(0xFF00ACC1)
        "leetcode", "leetcode_cn" -> Color(0xFFFFA000)
        else -> MaterialTheme.colorScheme.primary
    }

    val platformName = when (mistake.platform.lowercase()) {
        "codeforces" -> "CF"
        "atcoder" -> "AtCoder"
        "luogu" -> "洛谷"
        "acwing" -> "AcWing"
        "leetcode", "leetcode_cn" -> "力扣"
        else -> mistake.platform
    }

    val isMastered = mistake.status == "mastered"

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .clickable(onClick = onClick),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            // 顶行：平台徽标 + 题号标题 + 掌握状态
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
                    text = "${mistake.problem_id} ${mistake.problem_title}",
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
                    color = if (isMastered) {
                        Color(0xFF2E7D32).copy(alpha = 0.12f)
                    } else if (mistake.is_due) {
                        MaterialTheme.colorScheme.errorContainer
                    } else {
                        MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                    }
                ) {
                    Text(
                        text = if (isMastered) "已掌握" else if (mistake.is_due) "今日到期" else "第 ${mistake.review_count}/6 轮",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isMastered) {
                            Color(0xFF2E7D32)
                        } else if (mistake.is_due) {
                            MaterialTheme.colorScheme.onErrorContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }

            // 考点或笔记预览
            val previewText = mistake.key_point?.ifBlank { null } ?: mistake.notes?.ifBlank { null }
            if (!previewText.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = previewText,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            // 底行：下次复习时间 + 操作区
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                val nextDate = mistake.next_review_at
                Text(
                    text = if (!nextDate.isNullOrBlank() && !isMastered) "下次: $nextDate" else "已掌握",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // 复习按钮
                    if (!isMastered) {
                        OutlinedButton(
                            onClick = onReview,
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                            modifier = Modifier.height(26.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Check,
                                contentDescription = null,
                                modifier = Modifier.size(12.dp)
                            )
                            Spacer(modifier = Modifier.width(3.dp))
                            Text("复习", fontSize = 10.sp, fontWeight = FontWeight.Medium)
                        }
                    }

                    // 掌握切换按钮
                    OutlinedButton(
                        onClick = onToggleMaster,
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 8.dp, vertical = 2.dp),
                        modifier = Modifier.height(26.dp)
                    ) {
                        Icon(
                            imageVector = if (isMastered) Icons.Outlined.Replay else Icons.Outlined.Star,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp)
                        )
                        Spacer(modifier = Modifier.width(3.dp))
                        Text(if (isMastered) "重学" else "掌握", fontSize = 10.sp, fontWeight = FontWeight.Medium)
                    }

                    // 编辑按钮
                    IconButton(
                        onClick = onEdit,
                        modifier = Modifier.size(26.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Edit,
                            contentDescription = "编辑",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(14.dp)
                        )
                    }

                    // 删除按钮
                    IconButton(
                        onClick = onDelete,
                        modifier = Modifier.size(26.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.DeleteOutline,
                            contentDescription = "删除",
                            tint = MaterialTheme.colorScheme.error.copy(alpha = 0.8f),
                            modifier = Modifier.size(14.dp)
                        )
                    }

                    // 外链直达
                    if (!mistake.problem_url.isNullOrBlank()) {
                        IconButton(
                            onClick = onClickUrl,
                            modifier = Modifier.size(26.dp)
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                                contentDescription = "题面链接",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(14.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MistakeFormDialog(
    initialMistake: MistakeItemDto?,
    onDismiss: () -> Unit,
    onConfirmAdd: (MistakeCreateRequest) -> Unit,
    onConfirmEdit: (Int, MistakeUpdateRequest) -> Unit
) {
    val isEdit = initialMistake != null

    var platform by remember { mutableStateOf(initialMistake?.platform ?: "codeforces") }
    var problemId by remember { mutableStateOf(initialMistake?.problem_id ?: "") }
    var title by remember { mutableStateOf(initialMistake?.problem_title ?: "") }
    var difficulty by remember { mutableStateOf(initialMistake?.difficulty ?: "") }
    var tagsStr by remember { mutableStateOf(initialMistake?.tags?.joinToString(", ") ?: "") }
    var keyPoint by remember { mutableStateOf(initialMistake?.key_point ?: "") }
    var notes by remember { mutableStateOf(initialMistake?.notes ?: "") }
    var url by remember { mutableStateOf(initialMistake?.problem_url ?: "") }

    var showConfirmDialog by remember { mutableStateOf(false) }

    if (showConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showConfirmDialog = false },
            title = { Text(if (isEdit) "确认更新错题" else "确认录入错题", fontSize = 17.sp, fontWeight = FontWeight.Bold) },
            text = { Text(if (isEdit) "确定保存对该题考点和笔记的更改吗？" else "确定将该题目添加至错题集吗？", fontSize = 13.sp) },
            confirmButton = {
                TextButton(onClick = {
                    showConfirmDialog = false
                    val tagList = tagsStr.split(",").map { it.trim() }.filter { it.isNotBlank() }
                    if (initialMistake != null) {
                        onConfirmEdit(
                            initialMistake.id,
                            MistakeUpdateRequest(
                                key_point = keyPoint.trim(),
                                notes = notes.trim(),
                                tags = tagList,
                                problem_url = url.trim()
                            )
                        )
                    } else {
                        onConfirmAdd(
                            MistakeCreateRequest(
                                platform = platform.trim(),
                                problem_id = problemId.trim(),
                                problem_title = title.trim(),
                                difficulty = difficulty.trim(),
                                tags = tagList,
                                key_point = keyPoint.trim(),
                                notes = notes.trim(),
                                problem_url = url.trim()
                            )
                        )
                    }
                }) {
                    Text("确定", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmDialog = false }) { Text("取消") }
            }
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = if (isEdit) "编辑错题" else "录入错题",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .imePadding()
                    .padding(vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (!isEdit) {
                    OutlinedTextField(
                        value = platform,
                        onValueChange = { platform = it },
                        label = { Text("平台代码 (如 codeforces, luogu, atcoder)") },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = problemId,
                        onValueChange = { problemId = it },
                        label = { Text("题目编号 (如 1800E2)") },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = title,
                        onValueChange = { title = it },
                        label = { Text("题目名称") },
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                OutlinedTextField(
                    value = keyPoint,
                    onValueChange = { keyPoint = it },
                    label = { Text("核心考点与错因") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("解题思路与笔记") },
                    maxLines = 4,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = tagsStr,
                    onValueChange = { tagsStr = it },
                    label = { Text("算法标签 (以逗号分隔)") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("题面链接") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { showConfirmDialog = true },
                enabled = isEdit || (problemId.isNotBlank() && title.isNotBlank())
            ) {
                Text("保存", fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("取消")
            }
        }
    )
}
