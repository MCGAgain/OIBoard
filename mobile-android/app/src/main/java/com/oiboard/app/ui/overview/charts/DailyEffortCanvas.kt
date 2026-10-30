package com.oiboard.app.ui.overview.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oiboard.app.data.model.DailyEffortPointDto

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.platform.LocalDensity

private val GRID_EFFORT_RATIOS = floatArrayOf(0.33f, 0.66f, 1f)

private data class PrecomputedEffortBar(
    val subLeft: Float,
    val subTop: Float,
    val subHeight: Float,
    val acLeft: Float,
    val acTop: Float,
    val acHeight: Float,
    val barWidth: Float
)

@Composable
fun DailyEffortCanvas(
    points: List<DailyEffortPointDto>,
    modifier: Modifier = Modifier
) {
    val displayPoints = remember(points) {
        if (points.size > 14) points.takeLast(14) else points
    }

    if (displayPoints.isEmpty()) {
        Box(
            modifier = modifier
                .fillMaxWidth()
                .height(140.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.BarChart,
                    contentDescription = null,
                    modifier = Modifier.size(28.dp),
                    tint = MaterialTheme.colorScheme.outline
                )
                Text(
                    text = "暂无数据",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
        return
    }

    val primaryColor = MaterialTheme.colorScheme.primary
    val subColor = MaterialTheme.colorScheme.secondary.copy(alpha = 0.5f)
    val gridColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f)

    val maxVal = remember(displayPoints) {
        val maxSub = displayPoints.maxOfOrNull { it.total_subs } ?: 0
        if (maxSub <= 0) 5 else (maxSub * 1.15f).toInt()
    }

    Column(modifier = modifier.fillMaxWidth()) {
        // Legend
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                modifier = Modifier.size(8.dp),
                shape = RoundedCornerShape(2.dp),
                color = subColor
            ) {}
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = "提交数",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.width(12.dp))

            Surface(
                modifier = Modifier.size(8.dp),
                shape = RoundedCornerShape(2.dp),
                color = primaryColor
            ) {}
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = "通过数",
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        val density = LocalDensity.current
        val dashEffect = remember { PathEffect.dashPathEffect(floatArrayOf(6f, 6f), 0f) }
        val cornerRadius = remember(density) {
            CornerRadius(with(density) { 2.dp.toPx() }, with(density) { 2.dp.toPx() })
        }
        val gap1dp = with(density) { 1.dp.toPx() }
        val maxBarWidthPx = with(density) { 10.dp.toPx() }

        BoxWithConstraints(modifier = Modifier.fillMaxWidth().height(130.dp)) {
            val widthPx = constraints.maxWidth.toFloat()
            val heightPx = with(density) { 130.dp.toPx() }
            val chartHeightPx = heightPx - 4f

            val gridYs = remember(chartHeightPx) {
                FloatArray(GRID_EFFORT_RATIOS.size) { i ->
                    chartHeightPx * (1f - GRID_EFFORT_RATIOS[i])
                }
            }

            val precomputedBars = remember(displayPoints, widthPx, chartHeightPx, maxVal, gap1dp, maxBarWidthPx) {
                val count = displayPoints.size
                if (count == 0) emptyList() else {
                    val slotWidth = widthPx / count
                    val barWidth = (slotWidth * 0.35f).coerceAtMost(maxBarWidthPx)
                    val list = ArrayList<PrecomputedEffortBar>(count)

                    for (i in displayPoints.indices) {
                        val pt = displayPoints[i]
                        val centerX = i * slotWidth + slotWidth / 2f

                        val subH = chartHeightPx * (pt.total_subs.toFloat() / maxVal).coerceIn(0f, 1f)
                        val subLeft = centerX - barWidth - gap1dp
                        val subTop = chartHeightPx - subH

                        val acH = chartHeightPx * (pt.unique_ac.toFloat() / maxVal).coerceIn(0f, 1f)
                        val acLeft = centerX + gap1dp
                        val acTop = chartHeightPx - acH

                        list.add(
                            PrecomputedEffortBar(
                                subLeft = subLeft,
                                subTop = subTop,
                                subHeight = subH,
                                acLeft = acLeft,
                                acTop = acTop,
                                acHeight = acH,
                                barWidth = barWidth
                            )
                        )
                    }
                    list
                }
            }

            Canvas(modifier = Modifier.matchParentSize()) {
                val width = size.width

                // 1. Draw reference grid lines (zero allocations)
                for (idx in gridYs.indices) {
                    val y = gridYs[idx]
                    drawLine(
                        color = gridColor,
                        start = Offset(0f, y),
                        end = Offset(width, y),
                        strokeWidth = 1f,
                        pathEffect = dashEffect
                    )
                }

                // 2. Draw bars (zero allocations)
                for (idx in precomputedBars.indices) {
                    val bar = precomputedBars[idx]
                    if (bar.subHeight > 0f) {
                        drawRoundRect(
                            color = subColor,
                            topLeft = Offset(bar.subLeft, bar.subTop),
                            size = Size(bar.barWidth, bar.subHeight),
                            cornerRadius = cornerRadius
                        )
                    }
                    if (bar.acHeight > 0f) {
                        drawRoundRect(
                            color = primaryColor,
                            topLeft = Offset(bar.acLeft, bar.acTop),
                            size = Size(bar.barWidth, bar.acHeight),
                            cornerRadius = cornerRadius
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = displayPoints.first().date.takeLast(5),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = displayPoints.last().date.takeLast(5),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
