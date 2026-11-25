package com.sunviloz.cleancare.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val NavyPrimary = Color(0xFF0B1F3A)
val TealAccent = Color(0xFF0F766E)
val TealContainer = Color(0xFFCCFBF1)
val SlateSurface = Color(0xFFF8FAFC)
val AmberWarning = Color(0xFFB45309)
val AmberBg = Color(0xFFFFFBEB)
val RedError = Color(0xFFB91C1C)

private val SunvilozColorScheme = lightColorScheme(
    primary = TealAccent,
    onPrimary = Color.White,
    primaryContainer = TealContainer,
    onPrimaryContainer = NavyPrimary,
    secondary = NavyPrimary,
    onSecondary = Color.White,
    background = SlateSurface,
    onBackground = NavyPrimary,
    surface = Color.White,
    onSurface = NavyPrimary,
    surfaceVariant = Color(0xFFF1F5F9),
    onSurfaceVariant = Color(0xFF475569),
    error = RedError,
    onError = Color.White
)

@Composable
fun SunvilozTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = SunvilozColorScheme,
        content = content
    )
}
