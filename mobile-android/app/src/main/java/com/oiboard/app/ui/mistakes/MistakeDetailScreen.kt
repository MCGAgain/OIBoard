package com.oiboard.app.ui.mistakes

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.ui.components.MarkdownBlockItem
import com.oiboard.app.ui.components.rememberMarkdownBlocks

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MistakeDetailScreen(
    mistake: MistakeItemDto,
    onBack: () -> Unit,
    onEdit: ((MistakeItemDto) -> Unit)? = null,
    onReview: ((MistakeItemDto) -> Unit)? = null,
    onToggleMaster: ((MistakeItemDto) -> Unit)? = null,
    onDelete: ((MistakeItemDto) -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    // 处理系统返回键与手势
    BackHandler(onBack = onBack)

    var showReviewConfirm by remember { mutableStateOf(false) }
    var showMasterConfirm by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf(false) }

    val isMastered = mistake.status == "mastered"
    val blocks = rememberMarkdownBlocks(mistake.notes ?: "")

    // 二次确认弹窗 - 复习
    if (showReviewConfirm) {
        AlertDialog(
            onDismissRequest = { showReviewConfirm = false },
            title = { Text("记录复习", fontWeight = FontWeight.Bold) },
            text = { Text("确定记录本次复习打卡？状态将推进至下一轮复习周期。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showReviewConfirm = false
                        onReview?.invoke(mistake)
                    }
                ) {
                    Text("确定", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            },
            dismissButton = {
                TextButton(onClick = { showReviewConfirm = false }) {
                    Text("取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    // 二次确认弹窗 - 掌握
    if (showMasterConfirm) {
        AlertDialog(
            onDismissRequest = { showMasterConfirm = false },
            title = { Text(if (isMastered) "恢复复习" else "标记掌握", fontWeight = FontWeight.Bold) },
            text = {
                Text(if (isMastered) "确定将题目恢复为待复习状态？" else "确定将题目标记为已完全掌握？")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showMasterConfirm = false
                        onToggleMaster?.invoke(mistake)
                    }
                ) {
                    Text("确定", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            },
            dismissButton = {
                TextButton(onClick = { showMasterConfirm = false }) {
                    Text("取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    // 二次确认弹窗 - 删除
    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text("删除错题", fontWeight = FontWeight.Bold) },
            text = { Text("确定删除此错题记录？此操作不可撤销。") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteConfirm = false
                        onDelete?.invoke(mistake)
                    }
                ) {
                    Text("删除", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text("取消", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        )
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "${mistake.problem_id} 笔记详情",
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "返回",
                            tint = MaterialTheme.colorScheme.onBackground
                        )
                    }
                },
                actions = {
                    if (onEdit != null) {
                        IconButton(onClick = { onEdit(mistake) }) {
                            Icon(
                                imageVector = Icons.Outlined.Edit,
                                contentDescription = "编辑",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    if (onDelete != null) {
                        IconButton(onClick = { showDeleteConfirm = true }) {
                            Icon(
                                imageVector = Icons.Outlined.DeleteOutline,
                                contentDescription = "删除",
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface
                )
            )
        }
    ) { innerPadding ->
        // 单个 LazyColumn 垂直滚动，严禁嵌套垂直滚动容器，无固定高度
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Spacer(modifier = Modifier.height(6.dp))
            }

            // 1. 题目信息头部卡片
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Surface(
                                shape = RoundedCornerShape(6.dp),
                                color = MaterialTheme.colorScheme.primaryContainer
                            ) {
                                Text(
                                    text = mistake.platform.uppercase(),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                )
                            }

                            if (isMastered) {
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = Color(0xFF2E7D32).copy(alpha = 0.15f)
                                ) {
                                    Text(
                                        text = "已掌握",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = Color(0xFF2E7D32),
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                    )
                                }
                            } else {
                                Text(
                                    text = "第 ${mistake.review_count}/6 轮复习",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(10.dp))

                        Text(
                            text = "${mistake.problem_id} ${mistake.problem_title}",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )

                        if (!mistake.next_review_at.isNullOrBlank() && !isMastered) {
                            Spacer(modifier = Modifier.height(6.dp))
                            val dateStr = mistake.next_review_at.take(10)
                            Text(
                                text = "下次复习：$dateStr",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        if (!mistake.problem_url.isNullOrBlank()) {
                            Spacer(modifier = Modifier.height(10.dp))
                            OutlinedButton(
                                onClick = {
                                    try {
                                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(mistake.problem_url))
                                        context.startActivity(intent)
                                    } catch (_: Exception) {}
                                },
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Outlined.OpenInNew,
                                    contentDescription = null,
                                    modifier = Modifier.size(15.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("打开官方原题", fontSize = 12.sp)
                            }
                        }
                    }
                }
            }

            // 2. 考点与错因分析
            if (!mistake.key_point.isNullOrBlank()) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(16.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = "核心考点与错因",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = mistake.key_point,
                                fontSize = 13.sp,
                                lineHeight = 19.sp,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    }
                }
            }

            // 3. 标签列表
            if (mistake.tags.isNotEmpty()) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        mistake.tags.forEach { tag ->
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                            ) {
                                Text(
                                    text = tag,
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                )
                            }
                        }
                    }
                }
            }

            // 4. 解题心得与代码标题
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "解题笔记与代码",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                }
            }

            // 5. 原生轻量 Markdown 懒加载块（段落、代码块、列表、引用）
            if (blocks.isNotEmpty()) {
                items(blocks) { block ->
                    MarkdownBlockItem(
                        block = block,
                        onOpenUrl = { url ->
                            if (url.startsWith("http://") || url.startsWith("https://")) {
                                try {
                                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                    context.startActivity(intent)
                                } catch (_: Exception) {}
                            }
                        }
                    )
                }
            } else if (!mistake.notes.isNullOrBlank()) {
                // 加载中过渡态
                item {
                    Text(
                        text = mistake.notes,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                item {
                    Text(
                        text = "暂无解题笔记与代码",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // 6. 底部操作栏（复习打卡 / 掌握切换）
            if (onReview != null || onToggleMaster != null) {
                item {
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(bottom = 24.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        if (onReview != null && !isMastered) {
                            FilledTonalButton(
                                onClick = { showReviewConfirm = true },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.EventAvailable,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("复习一次", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            }
                        }

                        if (onToggleMaster != null) {
                            OutlinedButton(
                                onClick = { showMasterConfirm = true },
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.CheckCircle,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = if (isMastered) "恢复复习" else "标为掌握",
                                    fontSize = 13.sp
                                )
                            }
                        }
                    }
                }
            } else {
                item {
                    Spacer(modifier = Modifier.height(24.dp))
                }
            }
        }
    }
}
