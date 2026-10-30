package com.oiboard.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.oiboard.app.data.local.AppThemeMode

// 科技青蓝主强调色 (与 OIBoard Web 品牌一致)
val BrandCyanLight = Color(0xFF0891B2)
val BrandCyanDark = Color(0xFF06B6D4)

// 浅色现代色板：浅灰白底 + 纯白卡片 + 层次灰块
val BackgroundLight = Color(0xFFF8FAFC)
val SurfaceLight = Color(0xFFFFFFFF)
val SurfaceVariantLight = Color(0xFFF1F5F9)
val TextPrimaryLight = Color(0xFF0F172A)
val TextSecondaryLight = Color(0xFF64748B)

// 深色现代色板：纯黑底 (OLED) + 深灰色块卡片 (Tonal Surface)
val BackgroundDark = Color(0xFF000000)
val SurfaceDark = Color(0xFF0F172A)
val SurfaceVariantDark = Color(0xFF1E293B)
val TextPrimaryDark = Color(0xFFF8FAFC)
val TextSecondaryDark = Color(0xFF94A3B8)

private val DarkColorScheme = darkColorScheme(
    primary = BrandCyanDark,
    onPrimary = Color(0xFF000000),
    primaryContainer = Color(0xFF164E63),
    onPrimaryContainer = Color(0xFF67E8F9),
    background = BackgroundDark,
    surface = SurfaceDark,
    surfaceVariant = SurfaceVariantDark,
    onBackground = TextPrimaryDark,
    onSurface = TextPrimaryDark,
    onSurfaceVariant = TextSecondaryDark,
    outline = Color(0xFF334155),
    outlineVariant = Color(0xFF1E293B),
    error = Color(0xFFF87171),
    errorContainer = Color(0xFF450A0A),
    onErrorContainer = Color(0xFFFECACA)
)

private val LightColorScheme = lightColorScheme(
    primary = BrandCyanLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE0F2FE),
    onPrimaryContainer = Color(0xFF0369A1),
    background = BackgroundLight,
    surface = SurfaceLight,
    surfaceVariant = SurfaceVariantLight,
    onBackground = TextPrimaryLight,
    onSurface = TextPrimaryLight,
    onSurfaceVariant = TextSecondaryLight,
    outline = Color(0xFFCBD5E1),
    outlineVariant = Color(0xFFE2E8F0),
    error = Color(0xFFEF4444),
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF991B1B)
)

@Composable
fun OIBoardTheme(
    themeMode: AppThemeMode = AppThemeMode.SYSTEM,
    content: @Composable () -> Unit
) {
    val systemInDark = isSystemInDarkTheme()
    val isDark = when (themeMode) {
        AppThemeMode.SYSTEM -> systemInDark
        AppThemeMode.LIGHT -> false
        AppThemeMode.DARK -> true
    }

    val colorScheme = if (isDark) DarkColorScheme else LightColorScheme
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            window.navigationBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !isDark
            WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = !isDark
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
