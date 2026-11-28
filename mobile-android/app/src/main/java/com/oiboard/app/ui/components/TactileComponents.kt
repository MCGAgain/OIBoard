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

// 预缓存只读 Shape 与色彩常量，杜绝列表滚动/重组期临时对象分配
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

private val CardBgLight = Color(0xFFFFFFFF)
private val CardBgDark = Color(0xFF151B26)
private val CardBorderLight = Color(0xFFE3E9F3)
private val CardBorderDark = Color(0xFF242E40)

private val WellBgLight = Color(0xFFF3F6FB)
private val WellBgDark = Color(0xFF0E1420)

private val TileBgLight = Color(0xFFEEF3FA)
private val TileBgDark = Color(0xFF1C2434)

private val DockBgLight = Color(0xFFFDFEFF)
private val DockBgDark = Color(0xFF121824)
private val DockBorderLight = Color(0xFFDFE6F2)
private val DockBorderDark = Color(0xFF263144)
private val DockPillBgLight = Color(0x1C0071E3)
private val DockPillBgDark = Color(0x2E3B96FF)
private val DockBadgeAmber = Color(0xFFF59E0B)

private val ProgressActiveLight = Color(0xFF16A34A)
private val ProgressActiveDark = Color(0xFF39D353)
private val ProgressTrackLight = Color(0xFFE1E7F0)
private val ProgressTrackDark = Color(0xFF252E3F)

private var cachedLightBackdrop: ImageBitmap? = null
private var cachedDarkBackdrop: ImageBitmap? = null

private fun getOrBakeBackdrop(isDark: Boolean): ImageBitmap {
    if (isDark) {
        cachedDarkBackdrop?.let { return it }
    } else {
        cachedLightBackdrop?.let { return it }
    }

    val width = 240
    val height = 534
    val w = width.toFloat()
    val h = height.toFloat()
    val bitmap = ImageBitmap(width, height)
    val canvas = Canvas(bitmap)
    val drawScope = CanvasDrawScope()

    drawScope.draw(
        density = Density(density = 0.6f, fontScale = 1f),
        layoutDirection = LayoutDirection.Ltr,
        canvas = canvas,
        size = Size(w, h)
    ) {
        val baseBrush = Brush.linearGradient(
            colors = if (isDark) {
                listOf(Color(0xFF06080E), Color(0xFF0A0F1A), Color(0xFF070A12))
            } else {
                listOf(Color(0xFFE0E7F3), Color(0xFFEEF2F8), Color(0xFFDDE4F1))
            },
            start = Offset.Zero,
            end = Offset(w, h)
        )
        val topGlow = Brush.radialGradient(
            colors = if (isDark) {
                listOf(Color(0xFF1F448B).copy(alpha = 0.34f), Color.Transparent)
            } else {
                listOf(Color(0xFF8CB9F8).copy(alpha = 0.34f), Color.Transparent)
            },
            center = Offset(w * 0.16f, h * 0.12f),
            radius = maxOf(w, h) * 0.62f
        )
        val warmOrTealGlow = Brush.radialGradient(
            colors = if (isDark) {
                listOf(Color(0xFF124A4D).copy(alpha = 0.24f), Color.Transparent)
            } else {
                listOf(Color(0xFFE6CEB4).copy(alpha = 0.28f), Color.Transparent)
            },
            center = Offset(w * 0.88f, h * 0.28f),
            radius = maxOf(w, h) * 0.55f
        )
        val lowerGlow = Brush.radialGradient(
            colors = if (isDark) {
                listOf(Color(0xFF27225A).copy(alpha = 0.24f), Color.Transparent)
            } else {
                listOf(Color(0xFF9EB5E3).copy(alpha = 0.24f), Color.Transparent)
            },
            center = Offset(w * 0.35f, h * 0.88f),
            radius = maxOf(w, h) * 0.58f
        )
        val contourPath1 = Path().apply {
            moveTo(-w * 0.1f, h * 0.22f)
            cubicTo(w * 0.25f, h * 0.12f, w * 0.62f, h * 0.32f, w * 1.12f, h * 0.15f)
        }
        val contourPath2 = Path().apply {
            moveTo(-w * 0.1f, h * 0.78f)
            cubicTo(w * 0.30f, h * 0.66f, w * 0.68f, h * 0.86f, w * 1.12f, h * 0.72f)
        }

        drawRect(brush = baseBrush)
        drawRect(brush = topGlow)
        drawRect(brush = warmOrTealGlow)
        drawRect(brush = lowerGlow)
        drawPath(
            path = contourPath1,
            color = if (isDark) Color(0xFF82B4FF).copy(alpha = 0.10f) else Color(0xFF2C5394).copy(alpha = 0.10f),
            style = Stroke(width = 0.8f, cap = StrokeCap.Round)
        )
        drawPath(
            path = contourPath2,
            color = if (isDark) Color(0xFF5CD8C2).copy(alpha = 0.08f) else Color(0xFF7C5F43).copy(alpha = 0.08f),
            style = Stroke(width = 0.7f, cap = StrokeCap.Round)
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
 * 预烘焙静态光学建筑背景：
 * 将渐变与弧线一次性离线烘焙到低分辨率缓存纹理中，运行期仅 1 次 drawImage 贴图 (<0.1ms GPU)，
 * 消除全屏多重径向渐变过绘，保障 120Hz 满帧流畅。
 */
@Composable
fun OIBoardAmbientBackdrop(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit
) {
    val isDark = LocalIsDarkTheme.current
    val bitmap = remember(isDark) { getOrBakeBackdrop(isDark) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .drawBehind {
                drawImage(
                    image = bitmap,
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
 * 轻量按压微缩放（仅用于单点主操作按钮，不应用于高频滚动列表卡片）。
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
 * 120Hz 零外圈/零阴影极简瓷白 & 黑曜石卡片：
 * 干净单层不透明面板 + 0.5dp 细描边，彻底消除半透明阴影透底造成的"外圈双层"视觉干扰。
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
    val bgColor = if (isDark) CardBgDark else CardBgLight
    val borderColor = accentBorderColor ?: if (isDark) CardBorderDark else CardBorderLight

    val cardModifier = if (onClick != null) {
        modifier
            .clip(shape)
            .background(bgColor, shape)
            .border(0.5.dp, borderColor, shape)
            .clickable(onClick = onClick)
    } else {
        modifier
            .background(bgColor, shape)
            .border(0.5.dp, borderColor, shape)
    }

    Box(
        modifier = cardModifier,
        content = content
    )
}

/**
 * 极简色调内凹槽（Tier 2 / Tier 2.5）：无外描边，仅靠纯净色调明度区分层次。
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

    Box(
        modifier = modifier.background(bgColor, shape)
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
 * 与 Web 端 .ui-icon-box 一致的纯净色调圆角图标磁贴（无多余外描边）。
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

    Box(
        modifier = modifier
            .size(size)
            .background(bg, Shape9),
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
 * 与 Web 端 .platform-badge 一致的中性底 + 语义圆点徽标（纯色调底，无多余外描边）。
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

    Row(
        modifier = modifier
            .background(bg, Shape7)
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
 * 6 段复习进度条（单节点 drawBehind 绘制，避免每张错题卡片创建 6 个 Box + 6 个 clip）。
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
 * 极轻悬浮胶囊底栏（Floating Tactile Dock）：
 * - 单一动画驱动胶囊滑块（drawBehind 直接绘制，零 Shadow / 零多重嵌套边框）
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

    val dockBg = if (isDark) DockBgDark else DockBgLight
    val dockBorder = if (isDark) DockBorderDark else DockBorderLight
    val pillBg = if (isDark) DockPillBgDark else DockPillBgLight

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
                .background(dockBg, Shape26)
                .border(0.5.dp, dockBorder, Shape26)
                .padding(horizontal = 6.dp, vertical = 6.dp)
                .drawBehind {
                    val count = items.size.coerceAtLeast(1)
                    val stepW = size.width / count
                    val insetX = 2.dp.toPx()
                    val pillW = (stepW - insetX * 2f).coerceAtLeast(0f)
                    val pillLeft = stepW * activeIdx + insetX
                    val r = 20.dp.toPx()
                    val corner = CornerRadius(r, r)
                    drawRoundRect(
                        color = pillBg,
                        topLeft = Offset(pillLeft, 0f),
                        size = Size(pillW, size.height),
                        cornerRadius = corner
                    )
                },
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
                                        .border(1.dp, dockBg, CircleShape)
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
