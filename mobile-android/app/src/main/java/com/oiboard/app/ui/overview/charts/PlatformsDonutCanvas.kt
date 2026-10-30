package com.oiboard.app.ui.overview.charts

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PieChart
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oiboard.app.data.model.PlatformStatsDto

import androidx.compose.ui.platform.LocalDensity

private data class PrecomputedDonutArc(
    val color: Color,
    val startAngle: Float,
    val sweepAngle: Float
)

private fun platformColor(platform: String): Color {
    return when (platform.lowercase()) {
        "acwing" -> Color(0xFF1ABC9C)
        "luogu" -> Color(0xFFE74C3C)
        "codeforces" -> Color(0xFF3498DB)
        "atcoder" -> Color(0xFFF39C12)
        "leetcode", "leetcode_cn" -> Color(0xFFFFA116)
        "nowcoder" -> Color(0xFF2ECC71)
        else -> Color(0xFF9B59B6)
    }
}

private fun platformName(platform: String): String {
    return when (platform.lowercase()) {
        "acwing" -> "AcWing"
        "luogu" -> "洛谷"
        "codeforces" -> "Codeforces"
        "atcoder" -> "AtCoder"
        "leetcode", "leetcode_cn" -> "力扣"
        "nowcoder" -> "牛客"
        else -> platform
    }
}

@Composable
fun PlatformsDonutCanvas(
    platforms: Map<String, PlatformStatsDto>,
    modifier: Modifier = Modifier
) {
    val activePlatforms = remember(platforms) {
        platforms.filter { it.value.ac > 0 || it.value.total > 0 }
            .toList()
            .sortedByDescending { it.second.ac }
    }

    val totalAc = remember(activePlatforms) {
        activePlatforms.sumOf { it.second.ac }
    }

    if (activePlatforms.isEmpty()) {
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
                    imageVector = Icons.Outlined.PieChart,
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

    val density = LocalDensity.current
    val strokeWidthPx = with(density) { 14.dp.toPx() }
    val stroke = remember(strokeWidthPx) { Stroke(width = strokeWidthPx, cap = StrokeCap.Butt) }

    val precomputedArcs = remember(activePlatforms, totalAc) {
        if (totalAc == 0) emptyList() else {
            val list = ArrayList<PrecomputedDonutArc>(activePlatforms.size)
            var currentAngle = -90f
            for ((platform, stats) in activePlatforms) {
                val sweep = (stats.ac.toFloat() / totalAc) * 360f
                if (sweep > 0f) {
                    list.add(PrecomputedDonutArc(platformColor(platform), currentAngle, sweep))
                    currentAngle += sweep
                }
            }
            list
        }
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceAround
    ) {
        // Donut Chart
        Box(
            modifier = Modifier.size(130.dp),
            contentAlignment = Alignment.Center
        ) {
            Canvas(modifier = Modifier.size(120.dp)) {
                val diameter = size.minDimension - strokeWidthPx
                val topLeft = Offset(strokeWidthPx / 2f, strokeWidthPx / 2f)
                val arcSize = Size(diameter, diameter)

                if (precomputedArcs.isEmpty()) {
                    drawArc(
                        color = Color.LightGray.copy(alpha = 0.3f),
                        startAngle = 0f,
                        sweepAngle = 360f,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = stroke
                    )
                } else {
                    for (idx in precomputedArcs.indices) {
                        val arc = precomputedArcs[idx]
                        drawArc(
                            color = arc.color,
                            startAngle = arc.startAngle,
                            sweepAngle = arc.sweepAngle,
                            useCenter = false,
                            topLeft = topLeft,
                            size = arcSize,
                            style = stroke
                        )
                    }
                }
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "$totalAc",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Text(
                    text = "累计通过",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        Spacer(modifier = Modifier.width(16.dp))

        // Legend list
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            activePlatforms.forEach { (platform, stats) ->
                val color = platformColor(platform)
                val percent = if (totalAc > 0) (stats.ac.toFloat() / totalAc * 100).toInt() else 0

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f)
                    ) {
                        Surface(
                            modifier = Modifier.size(8.dp),
                            shape = CircleShape,
                            color = color
                        ) {}
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = platformName(platform),
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }

                    Text(
                        text = "${stats.ac} 题 (${percent}%)",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}
