package com.oiboard.app.ui.theme

import android.app.Activity
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.oiboard.app.data.local.AppThemeMode

// Apple Sapphire 主强调色（与 OIBoard Web 端 Porcelain & Obsidian Tactile 体系完全统一）
val BrandBlueLight = Color(0xFF0071E3)
val BrandBlueDark = Color(0xFF3B96FF)

// 浅色瓷白工作室色板：晨雾瓷石底 + 光学高透瓷白表面 + 精工凹槽灰阶
val BackgroundLight = Color(0xFFEEF2F8)
val SurfaceLight = Color(0xFFFDFEFF)
val SurfaceVariantLight = Color(0xFFE5ECF5)
val TextPrimaryLight = Color(0xFF0F172A)
val TextSecondaryLight = Color(0xFF475569)

// 深色曜石钛金色板：深邃钛灰底 + 曜石表面 + 精工凹槽深钛
val BackgroundDark = Color(0xFF080B12)
val SurfaceDark = Color(0xFF131926)
val SurfaceVariantDark = Color(0xFF1A2233)
val TextPrimaryDark = Color(0xFFF4F6FB)
val TextSecondaryDark = Color(0xFF9AA5BA)

val LocalIsDarkTheme = staticCompositionLocalOf { false }
val LocalAnimationsEnabled = staticCompositionLocalOf { true }

object PlatformColorTokens {
    fun colorFor(platform: String, isDark: Boolean): Color {
        return when (platform.lowercase()) {
            "codeforces" -> if (isDark) Color(0xFF4DA3FF) else Color(0xFF0071E3)
            "atcoder" -> if (isDark) Color(0xFFB197FC) else Color(0xFF7C3AED)
            "luogu" -> if (isDark) Color(0xFF39D353) else Color(0xFF15803D)
            "acwing" -> if (isDark) Color(0xFF818CF8) else Color(0xFF4F46E5)
            "leetcode", "leetcode_cn" -> if (isDark) Color(0xFFF59E0B) else Color(0xFFD97706)
            else -> if (isDark) BrandBlueDark else BrandBlueLight
        }
    }

    fun labelFor(platform: String): String {
        return when (platform.lowercase()) {
            "codeforces" -> "CF"
            "atcoder" -> "AtCoder"
            "luogu" -> "洛谷"
            "acwing" -> "AcWing"
            "leetcode", "leetcode_cn" -> "力扣"
            else -> platform.uppercase()
        }
    }
}

private val DarkColorScheme = darkColorScheme(
    primary = BrandBlueDark,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF15345E),
    onPrimaryContainer = Color(0xFFA8D1FF),
    secondary = Color(0xFF818CF8),
    onSecondary = Color(0xFF0B1020),
    secondaryContainer = Color(0xFF1E2544),
    onSecondaryContainer = Color(0xFFC7D2FE),
    tertiary = Color(0xFF39D353),
    onTertiary = Color(0xFF06210D),
    tertiaryContainer = Color(0xFF10331B),
    onTertiaryContainer = Color(0xFF86EFAC),
    background = BackgroundDark,
    surface = SurfaceDark,
    surfaceVariant = SurfaceVariantDark,
    onBackground = TextPrimaryDark,
    onSurface = TextPrimaryDark,
    onSurfaceVariant = TextSecondaryDark,
    outline = Color(0xFF334155),
    outlineVariant = Color(0xFF1E293B),
    error = Color(0xFFF87171),
    errorContainer = Color(0xFF45141A),
    onErrorContainer = Color(0xFFFECACA)
)

private val LightColorScheme = lightColorScheme(
    primary = BrandBlueLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDCEBFF),
    onPrimaryContainer = Color(0xFF004B9B),
    secondary = Color(0xFF4F46E5),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFE5E7FF),
    onSecondaryContainer = Color(0xFF312E81),
    tertiary = Color(0xFF15803D),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFDCFCE7),
    onTertiaryContainer = Color(0xFF14532D),
    background = BackgroundLight,
    surface = SurfaceLight,
    surfaceVariant = SurfaceVariantLight,
    onBackground = TextPrimaryLight,
    onSurface = TextPrimaryLight,
    onSurfaceVariant = TextSecondaryLight,
    outline = Color(0xFFCBD5E1),
    outlineVariant = Color(0xFFE2E8F0),
    error = Color(0xFFDC2626),
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF991B1B)
)

@Composable
fun OIBoardTheme(
    themeMode: AppThemeMode = AppThemeMode.SYSTEM,
    animationsEnabled: Boolean = true,
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
            @Suppress("DEPRECATION")
            window.statusBarColor = AndroidColor.TRANSPARENT
            @Suppress("DEPRECATION")
            window.navigationBarColor = AndroidColor.TRANSPARENT
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !isDark
            controller.isAppearanceLightNavigationBars = !isDark
        }
    }

    CompositionLocalProvider(
        LocalIsDarkTheme provides isDark,
        LocalAnimationsEnabled provides animationsEnabled
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            content = content
        )
    }
}
