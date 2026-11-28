package com.oiboard.app.ui.overview

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Code
import androidx.compose.material.icons.outlined.CodeOff
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material.icons.outlined.SyncProblem
import androidx.compose.material.icons.outlined.ViewAgenda
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oiboard.app.data.model.LocalCodeDto
import com.oiboard.app.ui.components.AnimatedMetricNumber
import com.oiboard.app.ui.components.TactileGlassCard
import com.oiboard.app.ui.components.TactileIconBadge

@Immutable
data class LanguageStat(
    val name: String,
    val lines: Int,
    val color: Color
)

/**
 * 语言分布提取计算：过滤为 0 项，按行数降序，最多取前 3 项，其余合并为“其他”
 */
fun LocalCodeDto.getLanguageBreakdown(): List<LanguageStat> {
    val items = mutableListOf<LanguageStat>()
    if (c_lines > 0) items.add(LanguageStat("C", c_lines, Color(0xFF0284C7))) // 天空蓝
    if (cpp_lines > 0) items.add(LanguageStat("C++", cpp_lines, Color(0xFF6366F1))) // 经典靛蓝
    if (java_lines > 0) items.add(LanguageStat("Java", java_lines, Color(0xFFF59E0B))) // 琥珀橙

    val knownLines = c_lines + cpp_lines + java_lines
    val remainingLines = total_lines - knownLines
    if (remainingLines > 0) {
        items.add(LanguageStat("其他", remainingLines, Color(0xFF64748B))) // 石板灰
    }

    val sorted = items.sortedByDescending { it.lines }
    return if (sorted.size > 4) {
        val top3 = sorted.take(3)
        val restSum = sorted.drop(3).sumOf { it.lines }
        top3 + LanguageStat("其他", restSum, Color(0xFF64748B))
    } else {
        sorted
    }
}

/**
 * 方案 A：通栏长卡片。
 * 现有四张 KPI 保持 2×2，本地代码做成下方一张通栏卡，左边大号总行数 + 今日变动，右边展示语言分布，整体对称。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LocalCodeCardPlanA(
    localCode: LocalCodeDto?,
    modifier: Modifier = Modifier,
    onSwitchPlan: (() -> Unit)? = null
) {
    val hasData = localCode != null && (localCode.has_data || localCode.total_lines > 0 || localCode.total_files > 0)
    val languages = remember(localCode) { localCode?.getLanguageBreakdown() ?: emptyList() }

    TactileGlassCard(
        modifier = modifier.fillMaxWidth(),
        cornerRadius = 20.dp
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp)
        ) {
            // 顶栏：标题 + 方案标签 + 同步状态
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.clickable(enabled = onSwitchPlan != null) { onSwitchPlan?.invoke() }
                ) {
                    TactileIconBadge(
                        icon = Icons.Outlined.Code,
                        tint = Color(0xFF0891B2)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "本地代码",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (onSwitchPlan != null) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.clickable { onSwitchPlan() }
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.GridView,
                                contentDescription = "切换为双卡片视图",
                                modifier = Modifier
                                    .padding(5.dp)
                                    .size(14.dp),
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                    SyncStatusBadge(isSynced = hasData)
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            if (!hasData) {
                EmptyLocalCodeContent()
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // 左侧：大号总行数 + 今日变动
                    Column(
                        modifier = Modifier.weight(1.18f),
                        verticalArrangement = Arrangement.Center
                    ) {
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                text = String.format("%,d", localCode?.total_lines ?: 0),
                                fontSize = 26.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                color = Color(0xFF06B6D4)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "行",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(bottom = 3.dp)
                            )
                        }

                        Spacer(modifier = Modifier.height(6.dp))

                        val todayLines = localCode?.today_lines ?: 0
                        val isPositive = todayLines > 0
                        Text(
                            text = "今日 ${if (isPositive) "+$todayLines" else "0"} 行 · ${localCode?.total_files ?: 0} 个文件",
                            fontSize = 10.5.sp,
                            fontWeight = if (isPositive) FontWeight.SemiBold else FontWeight.Normal,
                            fontFamily = FontFamily.Monospace,
                            color = if (isPositive) Color(0xFF10B981) else MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1
                        )
                    }

                    Spacer(modifier = Modifier.width(10.dp))

                    // 右侧：语言分布占比条与图例
                    Column(
                        modifier = Modifier.weight(0.92f),
                        verticalArrangement = Arrangement.Center
                    ) {
                        if (languages.isNotEmpty()) {
                            LanguageProportionBar(
                                languages = languages,
                                totalLines = localCode?.total_lines ?: 1,
                                modifier = Modifier.fillMaxWidth()
                            )

                            Spacer(modifier = Modifier.height(8.dp))

                            FlowRow(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                languages.forEach { lang ->
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .size(6.dp)
                                                .clip(CircleShape)
                                                .background(lang.color)
                                        )
                                        Spacer(modifier = Modifier.width(4.dp))
                                        Text(
                                            text = "${lang.name}: ${String.format("%,d", lang.lines)}",
                                            fontSize = 11.sp,
                                            fontFamily = FontFamily.Monospace,
                                            color = MaterialTheme.colorScheme.onSurface
                                        )
                                    }
                                }
                            }
                        } else {
                            Text(
                                text = "未统计语言",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * 方案 B：拆成两张卡，与现有四张组成 2×3。
 * 左卡：“本地代码”（总行数 + 今日变动 + 同步状态）；右卡：“语言分布”（占比条 + 3–4 行数字）。
 */
@Composable
fun LocalCodeCardsPlanB(
    localCode: LocalCodeDto?,
    modifier: Modifier = Modifier,
    onSwitchPlan: (() -> Unit)? = null
) {
    val hasData = localCode != null && (localCode.has_data || localCode.total_lines > 0 || localCode.total_files > 0)
    val languages = remember(localCode) { localCode?.getLanguageBreakdown() ?: emptyList() }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Max),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // 卡片 5：本地代码
        TactileGlassCard(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight(),
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
                        text = "本地代码",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.clickable(enabled = onSwitchPlan != null) { onSwitchPlan?.invoke() }
                    )
                    SyncStatusBadge(isSynced = hasData)
                }

                Spacer(modifier = Modifier.height(10.dp))

                if (!hasData) {
                    EmptyLocalCodeContent(compact = true)
                } else {
                    Column {
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                text = String.format("%,d", localCode?.total_lines ?: 0),
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                color = Color(0xFF06B6D4)
                            )
                            Spacer(modifier = Modifier.width(2.dp))
                            Text(
                                text = "行",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(bottom = 2.dp)
                            )
                        }

                        Spacer(modifier = Modifier.height(6.dp))

                        val todayLines = localCode?.today_lines ?: 0
                        val isPositive = todayLines > 0
                        Text(
                            text = "今日 ${if (isPositive) "+$todayLines" else "0"} 行",
                            fontSize = 11.sp,
                            fontWeight = if (isPositive) FontWeight.SemiBold else FontWeight.Normal,
                            fontFamily = FontFamily.Monospace,
                            color = if (isPositive) Color(0xFF10B981) else MaterialTheme.colorScheme.primary
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "${localCode?.total_files ?: 0} 个文件",
                            fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }

        // 卡片 6：语言分布
        TactileGlassCard(
            modifier = Modifier
                .weight(1f)
                .fillMaxHeight(),
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
                        text = "语言分布",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (onSwitchPlan != null) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.clickable { onSwitchPlan() }
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.ViewAgenda,
                                contentDescription = "切换为通栏卡片视图",
                                modifier = Modifier
                                    .padding(5.dp)
                                    .size(14.dp),
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    } else {
                        Icon(
                            imageVector = Icons.Outlined.PieChart,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                if (!hasData || languages.isEmpty()) {
                    EmptyLocalCodeContent(compact = true)
                } else {
                    LanguageProportionBar(
                        languages = languages,
                        totalLines = localCode?.total_lines ?: 1,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        languages.take(3).forEach { lang ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(6.dp)
                                            .clip(CircleShape)
                                            .background(lang.color)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = lang.name,
                                        fontSize = 11.sp,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                }
                                Text(
                                    text = String.format("%,d", lang.lines),
                                    fontSize = 11.sp,
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * 语言分布连续占比进度条
 */
@Composable
private fun LanguageProportionBar(
    languages: List<LanguageStat>,
    totalLines: Int,
    modifier: Modifier = Modifier
) {
    val safeTotal = if (totalLines > 0) totalLines.toFloat() else 1f

    Row(
        modifier = modifier
            .height(6.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
    ) {
        languages.forEach { lang ->
            val weight = (lang.lines / safeTotal).coerceIn(0.01f, 1f)
            Box(
                modifier = Modifier
                    .weight(weight)
                    .height(6.dp)
                    .background(lang.color)
            )
        }
    }
}

/**
 * 同步状态胶囊标识（已同步 / 未同步）
 */
@Composable
private fun SyncStatusBadge(isSynced: Boolean) {
    val bgColor = if (isSynced) Color(0x1A10B981) else Color(0x1A64748B)
    val contentColor = if (isSynced) Color(0xFF10B981) else MaterialTheme.colorScheme.onSurfaceVariant
    val icon = if (isSynced) Icons.Outlined.CheckCircle else Icons.Outlined.SyncProblem
    val text = if (isSynced) "已同步" else "未同步"

    Surface(
        shape = RoundedCornerShape(100.dp),
        color = bgColor
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.size(10.dp),
                tint = contentColor
            )
            Spacer(modifier = Modifier.width(3.dp))
            Text(
                text = text,
                fontSize = 10.sp,
                fontWeight = FontWeight.Medium,
                color = contentColor,
                maxLines = 1,
                softWrap = false
            )
        }
    }
}

/**
 * 空数据状态展示
 */
@Composable
private fun EmptyLocalCodeContent(compact: Boolean = false) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = if (compact) 8.dp else 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = Icons.Outlined.CodeOff,
            contentDescription = null,
            modifier = Modifier.size(if (compact) 16.dp else 20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = "暂无数据",
            fontSize = if (compact) 11.sp else 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
        )
    }
}
