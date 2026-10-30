package com.oiboard.app.ui.overview.charts

import android.util.Log
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oiboard.app.BuildConfig
import com.oiboard.app.data.model.HeatmapDayDto
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

private data class PrecomputedHeatmapCell(
    val col: Int,
    val row: Int,
    val color: Color,
    val dateStr: String,
    val count: Int,
    val uniqueAc: Int
)

private data class MonthHeaderLabel(
    val col: Int,
    val label: String
)

private data class WeekHeaderLabel(
    val row: Int,
    val label: String
)

private val STATIC_WEEK_LABELS = listOf(
    WeekHeaderLabel(0, "一"),
    WeekHeaderLabel(2, "三"),
    WeekHeaderLabel(4, "五")
)

@Composable
fun HeatmapCanvas(
    heatmap: List<HeatmapDayDto>,
    year: Int,
    modifier: Modifier = Modifier
) {
    val isDark = MaterialTheme.colorScheme.background.red < 0.2f
    val density = LocalDensity.current
    val textMeasurer = rememberTextMeasurer()

    // 4 levels of solid, non-transparent colors (no gradient)
    val emptyColor = if (isDark) Color(0xFF161618) else Color(0xFFEBEDF0)
    val colorLevel1 = if (isDark) Color(0xFF0E4429) else Color(0xFF9BE9A8)
    val colorLevel2 = if (isDark) Color(0xFF006D32) else Color(0xFF40C463)
    val colorLevel3 = if (isDark) Color(0xFF26A641) else Color(0xFF30A14E)
    val colorLevel4 = if (isDark) Color(0xFF39D353) else Color(0xFF216E39)

    fun getColor(count: Int): Color {
        return when {
            count <= 0 -> emptyColor
            count in 1..2 -> colorLevel1
            count in 3..5 -> colorLevel2
            count in 6..9 -> colorLevel3
            else -> colorLevel4
        }
    }

    // Always span the full calendar year (Jan 1 to Dec 31)
    val (startDate, totalDays) = remember(year) {
        val start = try {
            LocalDate.of(year, 1, 1)
        } catch (_: Exception) {
            LocalDate.now().withDayOfYear(1)
        }
        val end = try {
            LocalDate.of(year, 12, 31)
        } catch (_: Exception) {
            start.plusYears(1).minusDays(1)
        }
        val days = ChronoUnit.DAYS.between(start, end).toInt() + 1
        Pair(start, days)
    }

    // Standard Monday-first week indexing (Monday = 0 ... Sunday = 6)
    val startDayOfWeekOffset = remember(startDate) {
        (startDate.dayOfWeek.value - 1) % 7
    }

    val numWeeks = remember(totalDays, startDayOfWeekOffset) {
        (totalDays + startDayOfWeekOffset + 6) / 7
    }

    // Month start column indices for sparse header labels (Jan, Mar, May, Jul, Sep, Nov)
    val monthColumns = remember(year, startDayOfWeekOffset, startDate) {
        val list = ArrayList<MonthHeaderLabel>(6)
        val monthsToLabel = intArrayOf(1, 3, 5, 7, 9, 11)
        for (m in monthsToLabel) {
            try {
                val firstDay = LocalDate.of(year, m, 1)
                val dayOffset = ChronoUnit.DAYS.between(startDate, firstDay).toInt()
                val col = (startDayOfWeekOffset + dayOffset) / 7
                list.add(MonthHeaderLabel(col, "${m}月"))
            } catch (_: Exception) {}
        }
        list
    }

    // Precalculate all 365 cell coordinates, colors, and date strings OUTSIDE draw scope
    val precomputedCells = remember(year, heatmap, isDark, startDate, totalDays, startDayOfWeekOffset) {
        val dateMap = heatmap.filter { it.date.isNotBlank() }
            .associateBy { it.date.trim().take(10) }

        val cells = ArrayList<PrecomputedHeatmapCell>(totalDays)
        for (i in 0 until totalDays) {
            val date = startDate.plusDays(i.toLong())
            val dateStr = date.format(DateTimeFormatter.ISO_LOCAL_DATE)
            val stat = dateMap[dateStr]
            val count = stat?.count ?: 0
            val uniqueAc = stat?.unique_ac ?: 0
            val cellIndex = startDayOfWeekOffset + i
            val col = cellIndex / 7
            val row = cellIndex % 7
            val color = getColor(count)
            cells.add(
                PrecomputedHeatmapCell(
                    col = col,
                    row = row,
                    color = color,
                    dateStr = dateStr,
                    count = count,
                    uniqueAc = uniqueAc
                )
            )
        }
        cells
    }

    var selectedCell by remember(year, heatmap) { mutableStateOf<PrecomputedHeatmapCell?>(null) }

    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
    val labelTextStyle = remember(labelColor) {
        TextStyle(
            color = labelColor,
            fontSize = 8.sp,
            fontWeight = FontWeight.Normal
        )
    }

    Column(modifier = modifier.fillMaxWidth()) {
        // Single screen full year canvas (no horizontal scrolling)
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            val totalWidthPx = constraints.maxWidth.toFloat()
            val leftMarginPx = with(density) { 14.dp.toPx() }
            val topHeaderPx = with(density) { 14.dp.toPx() }

            val availableWidth = (totalWidthPx - leftMarginPx).coerceAtLeast(100f)
            val cellSpacingPx = with(density) { 1.2.dp.toPx() }
            val cellSizePx = ((availableWidth - (numWeeks - 1) * cellSpacingPx) / numWeeks).coerceAtLeast(2f)
            val cornerRadiusPx = with(density) { 1.dp.toPx() }

            val canvasHeightPx = topHeaderPx + 7 * cellSizePx + 6 * cellSpacingPx + with(density) { 4.dp.toPx() }
            val canvasHeightDp = with(density) { canvasHeightPx.toDp() }

            val cornerRadius = remember(cornerRadiusPx) { CornerRadius(cornerRadiusPx, cornerRadiusPx) }
            val cellSize = remember(cellSizePx) { Size(cellSizePx, cellSizePx) }
            val stepPx = cellSizePx + cellSpacingPx
            val weekYOffset = with(density) { 1.dp.toPx() }

            Canvas(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(canvasHeightDp)
                    .pointerInput(precomputedCells, leftMarginPx, topHeaderPx, cellSizePx, cellSpacingPx, numWeeks) {
                        detectTapGestures { offset ->
                            val relX = offset.x - leftMarginPx
                            val relY = offset.y - topHeaderPx
                            if (relX >= 0 && relY >= 0) {
                                val col = (relX / (cellSizePx + cellSpacingPx)).toInt()
                                val row = (relY / (cellSizePx + cellSpacingPx)).toInt()
                                if (col in 0 until numWeeks && row in 0..6) {
                                    val cellIndex = col * 7 + row
                                    val dayIndex = cellIndex - startDayOfWeekOffset
                                    if (dayIndex in 0 until precomputedCells.size) {
                                        selectedCell = precomputedCells[dayIndex]
                                    }
                                }
                            }
                        }
                    }
            ) {
                // 1. Draw sparse Month labels at top (zero allocations)
                for (idx in monthColumns.indices) {
                    val m = monthColumns[idx]
                    val x = leftMarginPx + m.col * stepPx
                    drawText(
                        textMeasurer = textMeasurer,
                        text = m.label,
                        topLeft = Offset(x, 0f),
                        style = labelTextStyle
                    )
                }

                // 2. Draw Mon, Wed, Fri labels on the left (zero allocations, static list)
                for (idx in STATIC_WEEK_LABELS.indices) {
                    val w = STATIC_WEEK_LABELS[idx]
                    val y = topHeaderPx + w.row * stepPx - weekYOffset
                    drawText(
                        textMeasurer = textMeasurer,
                        text = w.label,
                        topLeft = Offset(0f, y),
                        style = labelTextStyle
                    )
                }

                // 3. Draw all cells (strictly precomputed, zero allocations per frame)
                for (idx in precomputedCells.indices) {
                    val cell = precomputedCells[idx]
                    val x = leftMarginPx + cell.col * stepPx
                    val y = topHeaderPx + cell.row * stepPx

                    drawRoundRect(
                        color = cell.color,
                        topLeft = Offset(x, y),
                        size = cellSize,
                        cornerRadius = cornerRadius
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Bottom info & Legend line
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            val sel = selectedCell
            if (sel != null) {
                Text(
                    text = "${sel.dateStr}: 提交 ${sel.count} 次 / 通过 ${sel.uniqueAc} 题",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.primary
                )
            } else {
                val totalSubs = remember(heatmap) { heatmap.sumOf { it.count } }
                val activeDays = remember(heatmap) { heatmap.count { it.count > 0 } }
                Text(
                    text = "${year}年: 提交 ${totalSubs} 次 · 活跃 ${activeDays} 天",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                Text(
                    text = "少",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                listOf(emptyColor, colorLevel1, colorLevel2, colorLevel3, colorLevel4).forEach { col ->
                    Surface(
                        modifier = Modifier.size(8.dp),
                        shape = RoundedCornerShape(1.dp),
                        color = col
                    ) {}
                }
                Text(
                    text = "多",
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
