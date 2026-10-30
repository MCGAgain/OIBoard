package com.oiboard.app.ui.overview.charts

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ShowChart
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oiboard.app.data.model.ClimbingCurvePointDto
import kotlin.math.sqrt

/**
 * Intelligent downsampling to keep rendering cost minimal while preserving monotonicity,
 * start point, end point, and all jump inflection points.
 */
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.platform.LocalDensity

private val GRID_RATIOS = floatArrayOf(0.25f, 0.5f, 0.85f)

private data class PrecomputedCurveData(
    val linePath: Path,
    val fillPath: Path,
    val lastOffset: Offset,
    val gridYList: FloatArray
)

private fun downsamplePoints(rawPoints: List<ClimbingCurvePointDto>, maxPoints: Int = 60): List<ClimbingCurvePointDto> {
    if (rawPoints.size <= maxPoints) return rawPoints

    val step = (rawPoints.size.toFloat() / maxPoints).toInt().coerceAtLeast(1)
    val sampled = mutableListOf<ClimbingCurvePointDto>()
    sampled.add(rawPoints.first())

    for (i in 1 until rawPoints.size - 1) {
        val prev = rawPoints[i - 1]
        val curr = rawPoints[i]
        // Retain any day with a new AC jump
        if (curr.dailyNewAc > 0 || curr.totalAc != prev.totalAc || i % step == 0) {
            sampled.add(curr)
        }
    }

    sampled.add(rawPoints.last())
    return sampled
}

/**
 * Builds a Monotone Cubic Hermite Spline (Fritsch-Carlson algorithm).
 * Guarantees that monotonic non-decreasing data stays monotonic non-decreasing,
 * preventing any overshoot, undershoot, or wiggles.
 */
private fun buildMonotoneCubicPath(
    points: List<Offset>,
    linePath: Path,
    fillPath: Path,
    bottomY: Float
) {
    val n = points.size
    if (n == 0) return
    if (n == 1) {
        linePath.moveTo(points[0].x, points[0].y)
        fillPath.moveTo(points[0].x, points[0].y)
        fillPath.lineTo(points[0].x, bottomY)
        return
    }

    val dxs = FloatArray(n - 1)
    val dys = FloatArray(n - 1)
    val deltas = FloatArray(n - 1) // Secant slopes

    for (i in 0 until n - 1) {
        dxs[i] = points[i + 1].x - points[i].x
        dys[i] = points[i + 1].y - points[i].y
        deltas[i] = if (dxs[i] != 0f) dys[i] / dxs[i] else 0f
    }

    // Step 2: Initialize tangents
    val ms = FloatArray(n)
    ms[0] = deltas[0]
    ms[n - 1] = deltas[n - 2]
    for (i in 1 until n - 1) {
        if (deltas[i - 1] * deltas[i] <= 0f) {
            ms[i] = 0f
        } else {
            ms[i] = (deltas[i - 1] + deltas[i]) / 2f
        }
    }

    // Step 3: Fritsch-Carlson monotonicity condition
    for (i in 0 until n - 1) {
        if (deltas[i] == 0f) {
            ms[i] = 0f
            ms[i + 1] = 0f
        } else {
            val alpha = ms[i] / deltas[i]
            val beta = ms[i + 1] / deltas[i]
            val s = alpha * alpha + beta * beta
            if (s > 9f) {
                val tau = 3f / sqrt(s)
                ms[i] = tau * alpha * deltas[i]
                ms[i + 1] = tau * beta * deltas[i]
            }
        }
    }

    // Step 4: Add Bézier cubic curves
    linePath.moveTo(points[0].x, points[0].y)
    fillPath.moveTo(points[0].x, bottomY)
    fillPath.lineTo(points[0].x, points[0].y)

    for (i in 0 until n - 1) {
        val h = dxs[i]
        val p0 = points[i]
        val p1 = points[i + 1]

        val cp1x = p0.x + h / 3f
        val cp1y = p0.y + ms[i] * h / 3f

        val cp2x = p1.x - h / 3f
        val cp2y = p1.y - ms[i + 1] * h / 3f

        linePath.cubicTo(cp1x, cp1y, cp2x, cp2y, p1.x, p1.y)
        fillPath.cubicTo(cp1x, cp1y, cp2x, cp2y, p1.x, p1.y)
    }

    fillPath.lineTo(points.last().x, bottomY)
    fillPath.close()
}

@Composable
fun ClimbingCurveCanvas(
    points: List<ClimbingCurvePointDto>,
    modifier: Modifier = Modifier
) {
    // If empty or all zero values, show empty state instead of flat line at bottom
    val maxAcVal = remember(points) { points.maxOfOrNull { it.totalAc } ?: 0 }
    if (points.isEmpty() || maxAcVal <= 0) {
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
                    imageVector = Icons.AutoMirrored.Outlined.ShowChart,
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

    // Default to true polyline (no smoothing), optional monotone cubic smoothing switch
    var isSmooth by remember { mutableStateOf(false) }

    // Downsample points if data spans a whole year (365 days)
    val displayPoints = remember(points) {
        downsamplePoints(points, maxPoints = 50)
    }

    val primaryColor = MaterialTheme.colorScheme.primary
    val gridColor = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f)
    val areaBrush = remember(primaryColor) {
        Brush.verticalGradient(
            colors = listOf(
                primaryColor.copy(alpha = 0.25f),
                primaryColor.copy(alpha = 0.01f)
            )
        )
    }

    val maxVal = remember(maxAcVal) {
        (maxAcVal * 1.1f).toInt().coerceAtLeast(10)
    }

    val firstDate = displayPoints.first().date
    val lastDate = displayPoints.last().date
    val latestAc = displayPoints.last().totalAc

    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "累计通过",
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "$latestAc 题",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = primaryColor
                )
            }

            // Monotone Smooth vs Polyline Toggle
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (!isSmooth) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { isSmooth = false }
                ) {
                    Text(
                        text = "折线",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                        color = if (!isSmooth) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (isSmooth) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable { isSmooth = true }
                ) {
                    Text(
                        text = "平滑",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                        color = if (isSmooth) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        val density = LocalDensity.current
        val dashEffect = remember { PathEffect.dashPathEffect(floatArrayOf(6f, 6f), 0f) }
        val stroke = remember(density) {
            Stroke(
                width = with(density) { 2.dp.toPx() },
                cap = StrokeCap.Round,
                join = StrokeJoin.Round
            )
        }
        val circleRadiusPx = with(density) { 3.5.dp.toPx() }

        BoxWithConstraints(modifier = Modifier.fillMaxWidth().height(130.dp)) {
            val widthPx = constraints.maxWidth.toFloat()
            val heightPx = with(density) { 130.dp.toPx() }
            val chartHeightPx = (heightPx - with(density) { 12.dp.toPx() }).coerceAtLeast(10f)

            // Rebuild Path and coordinates ONLY when data, smoothing, or size changes!
            val curveData = remember(displayPoints, isSmooth, widthPx, chartHeightPx, maxVal) {
                val gridYs = FloatArray(GRID_RATIOS.size) { i ->
                    chartHeightPx * (1f - GRID_RATIOS[i])
                }

                val stepX = widthPx / (displayPoints.size - 1).coerceAtLeast(1)
                val offsets = ArrayList<Offset>(displayPoints.size)
                for (index in displayPoints.indices) {
                    val pt = displayPoints[index]
                    val x = index * stepX
                    val normalizedY = (pt.totalAc.toFloat() / maxVal).coerceIn(0f, 1f)
                    val y = chartHeightPx * (1f - normalizedY)
                    offsets.add(Offset(x, y))
                }

                val linePath = Path()
                val fillPath = Path()

                if (isSmooth) {
                    buildMonotoneCubicPath(offsets, linePath, fillPath, chartHeightPx)
                } else {
                    for (i in offsets.indices) {
                        val offset = offsets[i]
                        if (i == 0) {
                            linePath.moveTo(offset.x, offset.y)
                            fillPath.moveTo(offset.x, chartHeightPx)
                            fillPath.lineTo(offset.x, offset.y)
                        } else {
                            linePath.lineTo(offset.x, offset.y)
                            fillPath.lineTo(offset.x, offset.y)
                        }
                    }
                    if (offsets.isNotEmpty()) {
                        fillPath.lineTo(offsets.last().x, chartHeightPx)
                        fillPath.close()
                    }
                }

                val last = offsets.lastOrNull() ?: Offset.Zero
                PrecomputedCurveData(
                    linePath = linePath,
                    fillPath = fillPath,
                    lastOffset = last,
                    gridYList = gridYs
                )
            }

            Canvas(modifier = Modifier.matchParentSize()) {
                val width = size.width

                // 1. Draw background grid lines (zero allocations)
                for (idx in curveData.gridYList.indices) {
                    val y = curveData.gridYList[idx]
                    drawLine(
                        color = gridColor,
                        start = Offset(0f, y),
                        end = Offset(width, y),
                        strokeWidth = 1f,
                        pathEffect = dashEffect
                    )
                }

                // 2. Draw area gradient
                drawPath(path = curveData.fillPath, brush = areaBrush)

                // 3. Draw curve line
                drawPath(path = curveData.linePath, color = primaryColor, style = stroke)

                // 4. Draw last point indicator
                drawCircle(
                    color = primaryColor,
                    radius = circleRadiusPx,
                    center = curveData.lastOffset
                )
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = firstDate,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = lastDate,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
