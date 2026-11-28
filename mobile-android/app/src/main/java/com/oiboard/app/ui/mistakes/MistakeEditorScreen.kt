package com.oiboard.app.ui.mistakes

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oiboard.app.data.model.MistakeCreateRequest
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.MistakeUpdateRequest
import com.oiboard.app.ui.components.MarkdownBlockItem
import com.oiboard.app.ui.components.OIBoardAmbientBackdrop
import com.oiboard.app.ui.components.TactileGlassCard
import com.oiboard.app.ui.components.TactileRecessedWell
import com.oiboard.app.ui.components.rememberMarkdownBlocks
import com.oiboard.app.ui.theme.LocalAnimationsEnabled
import com.oiboard.app.ui.theme.LocalIsDarkTheme

private enum class EditorPaneMode { EDIT, PREVIEW }

/**
 * 全屏层压玻璃 Markdown 错题编辑器子页面（替代生硬弹窗），支持 编辑 / 实时预览 切换、
 * 快捷 Markdown 片段输入及从外部驱动的预测性返回手势过渡。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MistakeEditorScreen(
    initialMistake: MistakeItemDto?,
    onBack: () -> Unit,
    onConfirmAdd: (MistakeCreateRequest) -> Unit,
    onConfirmEdit: (Int, MistakeUpdateRequest) -> Unit,
    modifier: Modifier = Modifier
) {
    val isDark = LocalIsDarkTheme.current
    val animEnabled = LocalAnimationsEnabled.current
    val context = LocalContext.current
    val isEdit = initialMistake != null

    var platform by remember(initialMistake?.id) { mutableStateOf(initialMistake?.platform ?: "codeforces") }
    var problemId by remember(initialMistake?.id) { mutableStateOf(initialMistake?.problem_id ?: "") }
    var title by remember(initialMistake?.id) { mutableStateOf(initialMistake?.problem_title ?: "") }
    var difficulty by remember(initialMistake?.id) { mutableStateOf(initialMistake?.difficulty ?: "") }
    var tagsStr by remember(initialMistake?.id) { mutableStateOf(initialMistake?.tags?.joinToString(", ") ?: "") }
    var keyPoint by remember(initialMistake?.id) { mutableStateOf(initialMistake?.key_point ?: "") }
    var notes by remember(initialMistake?.id) { mutableStateOf(initialMistake?.notes ?: "") }
    var url by remember(initialMistake?.id) { mutableStateOf(initialMistake?.problem_url ?: "") }

    var paneMode by remember { mutableStateOf(EditorPaneMode.EDIT) }
    var showConfirmDialog by remember { mutableStateOf(false) }

    val canSave = isEdit || (problemId.isNotBlank() && title.isNotBlank())

    if (showConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showConfirmDialog = false },
            title = { Text(if (isEdit) "确认更新错题" else "确认录入错题", fontSize = 17.sp, fontWeight = FontWeight.Bold) },
            text = { Text(if (isEdit) "确定保存对该题考点和笔记的更改吗？" else "确定将该题目添加至错题集吗？", fontSize = 13.sp) },
            confirmButton = {
                TextButton(onClick = {
                    showConfirmDialog = false
                    val tagList = tagsStr.split(",", "，").map { it.trim() }.filter { it.isNotBlank() }
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

    OIBoardAmbientBackdrop(modifier = modifier.fillMaxSize()) {
        Scaffold(
            modifier = Modifier
                .fillMaxSize()
                .imePadding(),
            containerColor = Color.Transparent,
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            text = if (isEdit) "编辑 ${initialMistake?.problem_id ?: ""} 笔记" else "录入新错题",
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
                        Button(
                            onClick = { showConfirmDialog = true },
                            enabled = canSave,
                            shape = RoundedCornerShape(10.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary
                            ),
                            modifier = Modifier.padding(end = 10.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Check,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("保存", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surface.copy(alpha = if (isDark) 0.84f else 0.88f),
                        titleContentColor = MaterialTheme.colorScheme.onSurface
                    )
                )
            }
        ) { innerPadding ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // 基础题面信息卡
                TactileGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    cornerRadius = 18.dp
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (!isEdit) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedTextField(
                                    value = platform,
                                    onValueChange = { platform = it },
                                    label = { Text("平台代码", fontSize = 12.sp) },
                                    singleLine = true,
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.weight(1f)
                                )
                                OutlinedTextField(
                                    value = problemId,
                                    onValueChange = { problemId = it },
                                    label = { Text("题号", fontSize = 12.sp) },
                                    singleLine = true,
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            OutlinedTextField(
                                value = title,
                                onValueChange = { title = it },
                                label = { Text("题目名称", fontSize = 12.sp) },
                                singleLine = true,
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth()
                            )
                        }

                        OutlinedTextField(
                            value = keyPoint,
                            onValueChange = { keyPoint = it },
                            label = { Text("核心考点与错因", fontSize = 12.sp) },
                            singleLine = true,
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedTextField(
                                value = tagsStr,
                                onValueChange = { tagsStr = it },
                                label = { Text("算法标签 (逗号分隔)", fontSize = 12.sp) },
                                singleLine = true,
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedTextField(
                                value = url,
                                onValueChange = { url = it },
                                label = { Text("题面链接", fontSize = 12.sp) },
                                singleLine = true,
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }

                // Markdown 工作室卡片（支持 编辑 / 实时预览 平滑动画切换）
                TactileGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    cornerRadius = 18.dp
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = "Markdown 解题笔记",
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                val linesCount = if (notes.isEmpty()) 0 else notes.lines().size
                                Text(
                                    text = "$linesCount 行 · ${notes.length} 字",
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }

                            TactileRecessedWell(cornerRadius = 10.dp) {
                                Row(
                                    modifier = Modifier.padding(3.dp),
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    listOf(
                                        EditorPaneMode.EDIT to ("编辑" to Icons.Outlined.Edit),
                                        EditorPaneMode.PREVIEW to ("预览" to Icons.Outlined.Visibility)
                                    ).forEach { (mode, meta) ->
                                        val selected = paneMode == mode
                                        Surface(
                                            shape = RoundedCornerShape(8.dp),
                                            color = if (selected) MaterialTheme.colorScheme.surface else Color.Transparent,
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(8.dp))
                                                .clickable { paneMode = mode }
                                        ) {
                                            Row(
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                                            ) {
                                                Icon(
                                                    imageVector = meta.second,
                                                    contentDescription = null,
                                                    modifier = Modifier.size(13.dp),
                                                    tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                                )
                                                Text(
                                                    text = meta.first,
                                                    fontSize = 12.sp,
                                                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                                                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // 快捷 Markdown 片段栏
                        val snippets = listOf(
                            "## 思路" to "## 核心思路\n",
                            "## 复杂度" to "## 复杂度分析\n- 时间：`O(...)`\n- 空间：`O(...)`",
                            "C++" to "```cpp\n// code\n```",
                            "[ ]" to "- [ ] ",
                            "+ OI 模板" to "## 核心思路\n\n## 复杂度分析\n- 时间：`O(...)`\n- 空间：`O(...)`\n\n## 易错点与边界\n- [ ] \n\n## AC 代码\n```cpp\n\n```"
                        )
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            snippets.forEach { (chipLabel, snippet) ->
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.09f),
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.22f)),
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .clickable {
                                            notes = if (notes.isBlank()) snippet else notes.trimEnd() + "\n\n" + snippet
                                            paneMode = EditorPaneMode.EDIT
                                        }
                                ) {
                                    Text(
                                        text = chipLabel,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Medium,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp)
                                    )
                                }
                            }
                        }

                        // 编辑 / 预览平滑切换过渡
                        AnimatedContent(
                            targetState = paneMode,
                            transitionSpec = {
                                if (!animEnabled) {
                                    fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                                } else {
                                    fadeIn(tween(180, easing = FastOutSlowInEasing)) togetherWith
                                        fadeOut(tween(130, easing = FastOutSlowInEasing))
                                }
                            },
                            label = "md_editor_pane_mode"
                        ) { mode ->
                            if (mode == EditorPaneMode.EDIT) {
                                OutlinedTextField(
                                    value = notes,
                                    onValueChange = { notes = it },
                                    placeholder = { Text("输入解题思路、错因洞察与 AC 代码 (支持 Markdown)...", fontSize = 13.sp) },
                                    minLines = 10,
                                    maxLines = 24,
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier.fillMaxWidth()
                                )
                            } else {
                                TactileRecessedWell(
                                    modifier = Modifier.fillMaxWidth(),
                                    cornerRadius = 12.dp
                                ) {
                                    val blocks = rememberMarkdownBlocks(notes)
                                    Column(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(12.dp),
                                        verticalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        if (blocks.isEmpty()) {
                                            Text(
                                                text = "暂无笔记内容，点击上方快捷片段或切回「编辑」输入",
                                                fontSize = 13.sp,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        } else {
                                            blocks.forEach { block ->
                                                MarkdownBlockItem(
                                                    block = block,
                                                    onOpenUrl = { link ->
                                                        if (link.startsWith("http://") || link.startsWith("https://")) {
                                                            try {
                                                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)))
                                                            } catch (_: Exception) {}
                                                        }
                                                    }
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(
                    modifier = Modifier
                        .navigationBarsPadding()
                        .height(16.dp)
                )
            }
        }
    }
}
