package com.oiboard.app.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.oiboard.app.ui.navigation.Screen
import com.oiboard.app.ui.theme.LocalAnimationsEnabled
import com.oiboard.app.ui.theme.LocalIsDarkTheme
import com.oiboard.app.ui.theme.PlatformColorTokens
import kotlin.math.roundToInt

/**
 * 悬浮底栏预留给内部滚动列表的底部安全距离，使内容滑入底栏下方仍能自然透色。
 */
val LocalDockBottomPadding = compositionLocalOf { 0.dp }

// 预缓存只读 Shape 与静态玻璃渐变画笔，保障 120Hz 滚动零额外对象分配与零重绘失效
private val Shape26 = RoundedCornerShape(26.dp)
private val Shape24 = RoundedCornerShape(24.dp)
private val Shape20 = RoundedCornerShape(20.dp)
private val Shape18 = RoundedCornerShape(18.dp)
private val Shape14 = RoundedCornerShape(14.dp)
private val Shape12 = RoundedCornerShape(12.dp)
private val Shape10 = RoundedCornerShape(10.dp)
private val Shape9 = RoundedCornerShape(9.dp)
private val Shape8 = RoundedCornerShape(8.dp)
private val Shape7 = RoundedCornerShape(7.dp)

private fun cachedShape(cornerRadius: Dp): RoundedCornerShape = when (cornerRadius) {
    26.dp -> Shape26
    24.dp -> Shape24
    20.dp -> Shape20
    18.dp -> Shape18
    14.dp -> Shape14
    12.dp -> Shape12
    10.dp -> Shape10
    9.dp -> Shape9
    8.dp -> Shape8
    7.dp -> Shape7
    else -> RoundedCornerShape(cornerRadius)
}

private val LightCardGlassBrush = Brush.verticalGradient(
    colors = listOf(Color(0xD6FFFFFF), Color(0xB8F5F9FF))
)
private val DarkCardGlassBrush = Brush.verticalGradient(
    colors = listOf(Color(0xCE1C2537), Color(0xBA111725))
)

private val LightGlassRimBrush = Brush.verticalGradient(
    colors = listOf(
        Color(0xF5FFFFFF),
        Color(0x96FFFFFF),
        Color(0x220F172A)
    )
)
private val DarkGlassRimBrush = Brush.verticalGradient(
    colors = listOf(
        Color(0x3DFFFFFF),
        Color(0x1CFFFFFF),
        Color(0x45000000)
    )
)

private val WellBgLight = Color(0x0D0F172A)
private val WellBgDark = Color(0x40050810)
private val WellBorderLight = Color(0x120F172A)
private val WellBorderDark = Color(0x14FFFFFF)

private val TileBgLight = Color(0xB8FFFFFF)
private val TileBgDark = Color(0x18FFFFFF)
private val TileBorderLight = Color(0x180F172A)
private val TileBorderDark = Color(0x1FFFFFFF)

private val LightDockGlassBrush = Brush.verticalGradient(
    colors = listOf(Color(0xE8FFFFFF), Color(0xD6F4F8FF))
)
private val DarkDockGlassBrush = Brush.verticalGradient(
    colors = listOf(Color(0xE2182032), Color(0xD4101624))
)
private val DockRimLight = Brush.verticalGradient(
    colors = listOf(Color(0xFFFFFFFF), Color(0x300F172A))
)
private val DockRimDark = Brush.verticalGradient(
    colors = listOf(Color(0x38FFFFFF), Color(0x18FFFFFF))
)
private val DockPillBgLight = Color(0x1F0071E3)
private val DockPillBgDark = Color(0x333B96FF)
private val DockPillBorderLight = Color(0x330071E3)
private val DockPillBorderDark = Color(0x474DA3FF)
private val DockBadgeAmber = Color(0xFFF59E0B)

private val ProgressActiveLight = Color(0xFF16A34A)
private val ProgressActiveDark = Color(0xFF39D353)
private val ProgressTrackLight = Color(0x180F172A)
private val ProgressTrackDark = Color(0x20FFFFFF)

private var cachedLightBackdrop: ImageBitmap? = null
private var cachedDarkBackdrop: ImageBitmap? = null

private fun getOrBakeBackdrop(isDark: Boolean): ImageBitmap {
    if (isDark) {
        cachedDarkBackdrop?.let { return it }
    } else {
        cachedLightBackdrop?.let { return it }
    }

    val sw = 360
    val sh = 800
    val w = sw.toFloat()
    val h = sh.toFloat()
    val bitmap = ImageBitmap(sw, sh)
    val canvas = Canvas(bitmap)
    val drawScope = CanvasDrawScope()

    drawScope.draw(
        density = Density(density = 0.8f, fontScale = 1f),
        layoutDirection = LayoutDirection.Ltr,
        canvas = canvas,
        size = Size(w, h)
    ) {
        val baseBrush = Brush.linearGradient(
            colors = if (isDark) {
                listOf(Color(0xFF05070D), Color(0xFF0A101D), Color(0xFF060911))
            } else {
                listOf(Color(0xFFDCE6F6), Color(0xFFEEF3FA), Color(0xFFD9E3F4))
            },
            start = Offset.Zero,
            end = Offset(w, h)
        )
        val topLeftSapphire = Brush.radialGradient(
            colors = if (isDark) {
                listOf(Color(0xFF1F54B8).copy(alpha = 0.48f), Color.Transparent)
            } else {
                listOf(Color(0xFF5A9EFF).copy(alpha = 0.44f), Color.Transparent)
            },
            center = Offset(w * 0.14f, h * 0.12f),
            radius = maxOf(w, h) * 0.62f
        )
        val topRightAccent = Brush.radialGradient(
            colors = if (isDark) {
                listOf(Color(0xFF0E6166).copy(alpha = 0.34f), Color.Transparent)
            } else {
                listOf(Color(0xFFE7C49F).copy(alpha = 0.38f), Color.Transparent)
            },
            center = Offset(w * 0.90f, h * 0.27f),
            radius = maxOf(w, h) * 0.56f
        )
        val lowerSapphire = Brush.radialGradient(
            colors = if (isDark) {
                listOf(Color(0xFF33297A).copy(alpha = 0.34f), Color.Transparent)
            } else {
                listOf(Color(0xFF6B8CE8).copy(alpha = 0.36f), Color.Transparent)
            },
            center = Offset(w * 0.28f, h * 0.86f),
            radius = maxOf(w, h) * 0.58f
        )
        val midCyan = Brush.radialGradient(
            colors = if (isDark) {
                listOf(Color(0xFF184478).copy(alpha = 0.26f), Color.Transparent)
            } else {
                listOf(Color(0xFF7BC8E8).copy(alpha = 0.26f), Color.Transparent)
            },
            center = Offset(w * 0.78f, h * 0.62f),
            radius = maxOf(w, h) * 0.52f
        )

        drawRect(brush = baseBrush)
        drawRect(brush = topLeftSapphire)
        drawRect(brush = topRightAccent)
        drawRect(brush = lowerSapphire)
        drawRect(brush = midCyan)

        val gridColor = if (isDark) Color(0xFFFFFFFF).copy(alpha = 0.025f) else Color(0xFF0F172A).copy(alpha = 0.028f)
        val step = w / 6f
        var gx = step
        while (gx < w) {
            drawLine(gridColor, Offset(gx, 0f), Offset(gx, h), strokeWidth = 0.6f)
            gx += step
        }
        var gy = step
        while (gy < h) {
            drawLine(gridColor, Offset(0f, gy), Offset(w, gy), strokeWidth = 0.6f)
            gy += step
        }

        val contourPath1 = Path().apply {
            moveTo(-w * 0.1f, h * 0.22f)
            cubicTo(w * 0.25f, h * 0.11f, w * 0.62f, h * 0.33f, w * 1.12f, h * 0.14f)
        }
        val contourPath2 = Path().apply {
            moveTo(-w * 0.1f, h * 0.54f)
            cubicTo(w * 0.34f, h * 0.44f, w * 0.66f, h * 0.63f, w * 1.12f, h * 0.48f)
        }
        val contourPath3 = Path().apply {
            moveTo(-w * 0.1f, h * 0.80f)
            cubicTo(w * 0.30f, h * 0.67f, w * 0.68f, h * 0.88f, w * 1.12f, h * 0.73f)
        }

        drawPath(
            path = contourPath1,
            color = if (isDark) Color(0xFF82B4FF).copy(alpha = 0.16f) else Color(0xFF2B569E).copy(alpha = 0.13f),
            style = Stroke(width = 1.1f, cap = StrokeCap.Round)
        )
        drawPath(
            path = contourPath2,
            color = if (isDark) Color(0xFF5CD8C2).copy(alpha = 0.11f) else Color(0xFF4374B8).copy(alpha = 0.09f),
            style = Stroke(width = 0.9f, cap = StrokeCap.Round)
        )
        drawPath(
            path = contourPath3,
            color = if (isDark) Color(0xFF82B4FF).copy(alpha = 0.12f) else Color(0xFF856547).copy(alpha = 0.10f),
            style = Stroke(width = 1.0f, cap = StrokeCap.Round)
        )
    }

    if (isDark) {
        cachedDarkBackdrop = bitmap
    } else {
        cachedLightBackdrop = bitmap
    }
    return bitmap
}

/**
 * 光学建筑背景：一次烘焙缓存纹理 + 单次 GPU drawImage 铺底 (<0.1ms)，
 * 其柔和光晕与曲线通过上方半透明层压玻璃卡片自然透出。
 */
@Composable
fun OIBoardAmbientBackdrop(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit
) {
    val isDark = LocalIsDarkTheme.current
    val backdrop = remember(isDark) { getOrBakeBackdrop(isDark) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .drawBehind {
                drawImage(
                    image = backdrop,
                    dstSize = IntSize(
                        width = size.width.roundToInt().coerceAtLeast(1),
                        height = size.height.roundToInt().coerceAtLeast(1)
                    ),
                    filterQuality = FilterQuality.Low
                )
            },
        content = content
    )
}

/**
 * 轻量按压微缩放（仅用于单点主操作按钮）。
 */
@Composable
fun Modifier.tactilePressScale(
    interactionSource: MutableInteractionSource,
    pressedScale: Float = 0.978f,
    enabled: Boolean = true
): Modifier {
    val animEnabled = LocalAnimationsEnabled.current
    val isPressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (enabled && animEnabled && isPressed) pressedScale else 1f,
        animationSpec = if (animEnabled) {
            spring(
                dampingRatio = Spring.DampingRatioMediumBouncy,
                stiffness = Spring.StiffnessMediumLow
            )
        } else {
            snap()
        },
        label = "tactilePressScale"
    )
    return if (!animEnabled) {
        this
    } else {
        this.graphicsLayer {
            scaleX = scale
            scaleY = scale
        }
    }
}

/**
 * Web 同款 macOS 15 层压光学玻璃卡片（静态 RenderNode，零滚动失效、零阴影灰圈）：
 * - 半透明渐变乳白 / 熏黑玻璃面板，让底层柔和光晕自然穿透；
 * - 顶部光学高光 + 0.85dp 镜面高光描边；
 * - 零 onGloballyPositioned 与零 RenderNode 重录，保证 120Hz 满帧。
 */
@Composable
fun TactileGlassCard(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 20.dp,
    accentBorderColor: Color? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable BoxScope.() -> Unit
) {
    val isDark = LocalIsDarkTheme.current
    val shape = cachedShape(cornerRadius)
    val fillBrush = if (isDark) DarkCardGlassBrush else LightCardGlassBrush
    val rimBrush = if (isDark) DarkGlassRimBrush else LightGlassRimBrush

    val styledModifier = if (onClick != null) {
        modifier
            .clip(shape)
            .background(fillBrush, shape)
            .let { m ->
                if (accentBorderColor != null) {
                    m.border(0.85.dp, accentBorderColor, shape)
                } else {
                    m.border(0.85.dp, rimBrush, shape)
                }
            }
            .clickable(onClick = onClick)
    } else {
        modifier
            .background(fillBrush, shape)
            .let { m ->
                if (accentBorderColor != null) {
                    m.border(0.85.dp, accentBorderColor, shape)
                } else {
                    m.border(0.85.dp, rimBrush, shape)
                }
            }
    }

    Box(
        modifier = styledModifier,
        content = content
    )
}

/**
 * 磨砂玻璃内部精工凹槽（Tier 2 / Tier 2.5）：半透明微凹陷，透出上层卡片玻璃色阶。
 */
@Composable
fun TactileRecessedWell(
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 12.dp,
    accentBarColor: Color? = null,
    content: @Composable BoxScope.() -> Unit
) {
    val isDark = LocalIsDarkTheme.current
    val shape = cachedShape(cornerRadius)
    val bgColor = if (isDark) WellBgDark else WellBgLight
    val borderColor = if (isDark) WellBorderDark else WellBorderLight

    Box(
        modifier = modifier
            .background(bgColor, shape)
            .border(0.5.dp, borderColor, shape)
    ) {
        if (accentBarColor != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .padding(start = 10.dp, top = 10.dp, bottom = 10.dp)
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(accentBarColor, Shape7)
            )
        }
        content()
    }
}

/**
 * 半透明瓷白/熏黑精密圆角图标磁贴。
 */
@Composable
fun TactileIconBadge(
    icon: ImageVector,
    tint: Color,
    modifier: Modifier = Modifier,
    size: Dp = 30.dp,
    iconSize: Dp = 16.dp
) {
    val isDark = LocalIsDarkTheme.current
    val bg = if (isDark) TileBgDark else TileBgLight
    val border = if (isDark) TileBorderDark else TileBorderLight

    Box(
        modifier = modifier
            .size(size)
            .background(bg, Shape9)
            .border(0.5.dp, border, Shape9),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(iconSize)
        )
    }
}

/**
 * 半透明磨砂质感平台微标。
 */
@Composable
fun TactilePlatformBadge(
    platform: String,
    modifier: Modifier = Modifier
) {
    val isDark = LocalIsDarkTheme.current
    val dotColor = PlatformColorTokens.colorFor(platform, isDark)
    val label = PlatformColorTokens.labelFor(platform)
    val bg = if (isDark) TileBgDark else TileBgLight
    val border = if (isDark) TileBorderDark else TileBorderLight

    Row(
        modifier = modifier
            .background(bg, Shape7)
            .border(0.5.dp, border, Shape7)
            .padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp)
    ) {
        Box(
            modifier = Modifier
                .size(6.dp)
                .background(dotColor, CircleShape)
        )
        Text(
            text = label,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}

/**
 * 6 段复习进度条（单节点 drawBehind 绘制）。
 */
@Composable
fun ReviewStepProgressBar(
    reviewCount: Int,
    modifier: Modifier = Modifier
) {
    val isDark = LocalIsDarkTheme.current
    val activeColor = if (isDark) ProgressActiveDark else ProgressActiveLight
    val trackColor = if (isDark) ProgressTrackDark else ProgressTrackLight

    Spacer(
        modifier = modifier
            .width(104.dp)
            .height(5.dp)
            .drawBehind {
                val segWidth = 14.dp.toPx()
                val gap = 4.dp.toPx()
                val segHeight = size.height
                val radius = CornerRadius(segHeight / 2f, segHeight / 2f)
                for (step in 0 until 6) {
                    val left = step * (segWidth + gap)
                    drawRoundRect(
                        color = if (step < reviewCount) activeColor else trackColor,
                        topLeft = Offset(left, 0f),
                        size = Size(segWidth, segHeight),
                        cornerRadius = radius
                    )
                }
            }
    )
}

/**
 * KPI 核心数值（启用动效时支持轻量递增；关闭时直接静态渲染）。
 */
@Composable
fun AnimatedMetricNumber(
    targetValue: Int,
    suffix: String = "",
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier
) {
    val animEnabled = LocalAnimationsEnabled.current
    val displayValue by animateIntAsState(
        targetValue = targetValue,
        animationSpec = if (animEnabled) tween(durationMillis = 320) else snap(),
        label = "metricNumber"
    )
    val shown = if (animEnabled) displayValue else targetValue
    Text(
        text = "$shown$suffix",
        style = style.copy(fontFeatureSettings = "tnum"),
        color = color,
        modifier = modifier
    )
}

/**
 * 轻盈悬浮玻璃胶囊底栏（Floating Frosted Dock）：
 * - 半透明层压渐变底 + 0.85dp 镜面高光框 + 单一弹簧滑块；
 * - 零全屏 RenderNode 重录与零阴影，兼顾通透玻璃感与 120Hz 满帧率。
 */
@Composable
fun FloatingTactileDock(
    items: List<Screen>,
    selectedRoute: String,
    dueMistakesCount: Int,
    onSelect: (Screen) -> Unit,
    modifier: Modifier = Modifier
) {
    val isDark = LocalIsDarkTheme.current
    val animEnabled = LocalAnimationsEnabled.current
    val haptic = LocalHapticFeedback.current
    val selectedIndex = items.indexOfFirst { it.route == selectedRoute }.coerceAtLeast(0)

    val dockBrush = if (isDark) DarkDockGlassBrush else LightDockGlassBrush
    val dockRim = if (isDark) DockRimDark else DockRimLight
    val pillBg = if (isDark) DockPillBgDark else DockPillBgLight
    val pillBorder = if (isDark) DockPillBorderDark else DockPillBorderLight

    val animatedIndex by animateFloatAsState(
        targetValue = selectedIndex.toFloat(),
        animationSpec = if (animEnabled) {
            spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMedium)
        } else {
            snap()
        },
        label = "dockIndicatorIndex"
    )
    val activeIdx = if (animEnabled) animatedIndex else selectedIndex.toFloat()

    Box(
        modifier = modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(66.dp)
                .background(dockBrush, Shape26)
                .border(0.85.dp, dockRim, Shape26)
                .drawBehind {
                    val inset = 6.dp.toPx()
                    val innerW = (size.width - inset * 2f).coerceAtLeast(0f)
                    val innerH = (size.height - inset * 2f).coerceAtLeast(0f)
                    val count = items.size.coerceAtLeast(1)
                    val stepW = innerW / count
                    val pillInsetX = 2.dp.toPx()
                    val pillW = (stepW - pillInsetX * 2f).coerceAtLeast(0f)
                    val pillLeft = inset + stepW * activeIdx + pillInsetX
                    val pillCorner = CornerRadius(20.dp.toPx(), 20.dp.toPx())
                    drawRoundRect(
                        color = pillBg,
                        topLeft = Offset(pillLeft, inset),
                        size = Size(pillW, innerH),
                        cornerRadius = pillCorner
                    )
                    drawRoundRect(
                        color = pillBorder,
                        topLeft = Offset(pillLeft, inset),
                        size = Size(pillW, innerH),
                        cornerRadius = pillCorner,
                        style = Stroke(width = 0.7.dp.toPx())
                    )
                }
                .padding(horizontal = 6.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            items.forEach { screen ->
                val isSelected = screen.route == selectedRoute
                val tint = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                val interactionSource = remember { MutableInteractionSource() }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clip(Shape20)
                        .clickable(
                            interactionSource = interactionSource,
                            indication = null,
                            onClick = {
                                if (!isSelected) {
                                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    onSelect(screen)
                                }
                            }
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Box {
                            Icon(
                                imageVector = screen.icon,
                                contentDescription = screen.title,
                                tint = tint,
                                modifier = Modifier.size(21.dp)
                            )
                            if (screen == Screen.Mistakes && dueMistakesCount > 0) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .offset(x = 5.dp, y = (-2).dp)
                                        .size(7.dp)
                                        .background(DockBadgeAmber, CircleShape)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = screen.title,
                            fontSize = 10.sp,
                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                            color = tint,
                            maxLines = 1,
                            overflow = TextOverflow.Clip
                        )
                    }
                }
            }
        }
    }
}
