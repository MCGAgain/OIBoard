package com.oiboard.app.ui.navigation

import androidx.activity.BackEventCompat
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import com.oiboard.app.data.local.AppThemeMode
import com.oiboard.app.data.local.UserPreferencesRepository
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.UserDto
import com.oiboard.app.data.repository.ContestsRepository
import com.oiboard.app.data.repository.MistakesRepository
import com.oiboard.app.data.repository.SettingsRepository
import com.oiboard.app.data.repository.StatsRepository
import com.oiboard.app.data.repository.SubmissionsRepository
import com.oiboard.app.ui.components.FloatingTactileDock
import com.oiboard.app.ui.components.LocalDockBottomPadding
import com.oiboard.app.ui.components.OIBoardAmbientBackdrop
import com.oiboard.app.ui.contests.ContestsScreen
import com.oiboard.app.ui.contests.ContestsViewModel
import com.oiboard.app.ui.mistakes.MistakeDetailScreen
import com.oiboard.app.ui.mistakes.MistakeEditorScreen
import com.oiboard.app.ui.mistakes.MistakesScreen
import com.oiboard.app.ui.mistakes.MistakesViewModel
import com.oiboard.app.ui.overview.OverviewScreen
import com.oiboard.app.ui.overview.OverviewViewModel
import com.oiboard.app.ui.screens.TabPlaceholderScreen
import com.oiboard.app.ui.settings.SettingsScreen
import com.oiboard.app.ui.settings.SettingsViewModel
import com.oiboard.app.ui.submissions.SubmissionsScreen
import com.oiboard.app.ui.submissions.SubmissionsViewModel
import com.oiboard.app.ui.theme.LocalAnimationsEnabled

@Composable
fun MainScreen(
    statsRepository: StatsRepository,
    contestsRepository: ContestsRepository? = null,
    submissionsRepository: SubmissionsRepository? = null,
    mistakesRepository: MistakesRepository? = null,
    settingsRepository: SettingsRepository? = null,
    userPreferencesRepository: UserPreferencesRepository? = null,
    currentUser: UserDto? = null,
    currentServerUrl: String = "",
    currentThemeMode: AppThemeMode = AppThemeMode.SYSTEM,
    onThemeChange: (AppThemeMode) -> Unit = {},
    onSaveServerUrl: (String) -> Unit = {},
    onLogout: (clearPassword: Boolean) -> Unit = {}
) {
    var selectedTab by rememberSaveable { mutableStateOf(Screen.Overview.route) }
    val context = LocalContext.current.applicationContext

    // 全屏错题详情页与 Markdown 编辑器状态（错题页与提交页共用）
    var activeMistakeDetail by remember { mutableStateOf<MistakeItemDto?>(null) }
    var showMistakeEditor by remember { mutableStateOf(false) }
    var editingMistakeTarget by remember { mutableStateOf<MistakeItemDto?>(null) }

    val detailBackProgress = remember { Animatable(0f) }
    var detailBackEdge by remember { mutableIntStateOf(BackEventCompat.EDGE_LEFT) }
    val editorBackProgress = remember { Animatable(0f) }
    var editorBackEdge by remember { mutableIntStateOf(BackEventCompat.EDGE_LEFT) }

    LaunchedEffect(activeMistakeDetail?.id) {
        detailBackProgress.snapTo(0f)
    }
    LaunchedEffect(showMistakeEditor, editingMistakeTarget?.id) {
        editorBackProgress.snapTo(0f)
    }

    val hasDetail = activeMistakeDetail != null
    val hasEditor = showMistakeEditor
    val hasOverlay = hasDetail || hasEditor

    // X (Twitter) 风格预测性返回手势：边缘滑动时页面实时缩退、圆角剥离，松手回弹或退出
    PredictiveBackHandler(enabled = hasDetail && !hasEditor) { progress: Flow<BackEventCompat> ->
        try {
            progress.collect { backEvent ->
                detailBackEdge = backEvent.swipeEdge
                detailBackProgress.snapTo(backEvent.progress)
            }
            activeMistakeDetail = null
        } catch (_: CancellationException) {
            detailBackProgress.animateTo(
                targetValue = 0f,
                animationSpec = spring(stiffness = Spring.StiffnessMediumLow)
            )
        }
    }

    PredictiveBackHandler(enabled = hasEditor) { progress: Flow<BackEventCompat> ->
        try {
            progress.collect { backEvent ->
                editorBackEdge = backEvent.swipeEdge
                editorBackProgress.snapTo(backEvent.progress)
            }
            showMistakeEditor = false
            editingMistakeTarget = null
        } catch (_: CancellationException) {
            editorBackProgress.animateTo(
                targetValue = 0f,
                animationSpec = spring(stiffness = Spring.StiffnessMediumLow)
            )
        }
    }

    val mistakesViewModel: MistakesViewModel? = if (mistakesRepository != null && userPreferencesRepository != null) {
        viewModel(factory = MistakesViewModel.provideFactory(mistakesRepository, context, userPreferencesRepository))
    } else null

    val animEnabled = LocalAnimationsEnabled.current
    val tabInDuration = if (animEnabled) 150 else 0
    val tabOutDuration = if (animEnabled) 100 else 0
    val detailAnimDuration = if (animEnabled) 220 else 0
    val editorAnimDuration = if (animEnabled) 240 else 0
    val density = LocalDensity.current
    val tabOrder = remember { Screen.items.mapIndexed { index, screen -> screen.route to index }.toMap() }
    val mainUnderlyingProgress = when {
        hasEditor && !hasDetail -> editorBackProgress.value.coerceIn(0f, 1f)
        hasDetail -> detailBackProgress.value.coerceIn(0f, 1f)
        else -> 1f
    }

    Box(modifier = Modifier.fillMaxSize()) {
        // 主视图容器：仅当存在子页面浮层时启用视差缩放与压暗遮罩，平时零额外图层开销保持 120Hz 满帧滚动
        Box(
            modifier = if (hasOverlay) {
                Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        val scale = if (hasEditor && hasDetail) 0.92f else 0.94f + 0.06f * mainUnderlyingProgress
                        scaleX = scale
                        scaleY = scale
                    }
            } else {
                Modifier.fillMaxSize()
            }
        ) {
        OIBoardAmbientBackdrop {
            CompositionLocalProvider(LocalDockBottomPadding provides 96.dp) {
                // 带轻微方向位移的优雅切换
                AnimatedContent(
                    targetState = selectedTab,
                    transitionSpec = {
                        if (!animEnabled) {
                            fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                        } else {
                            val forward = (tabOrder[targetState] ?: 0) >= (tabOrder[initialState] ?: 0)
                            val shiftPx = with(density) { 18.dp.roundToPx() }
                            (slideInHorizontally(
                                animationSpec = tween(tabInDuration, easing = FastOutSlowInEasing),
                                initialOffsetX = { if (forward) shiftPx else -shiftPx }
                            ) + fadeIn(tween(tabInDuration))) togetherWith (slideOutHorizontally(
                                animationSpec = tween(tabOutDuration, easing = FastOutSlowInEasing),
                                targetOffsetX = { if (forward) -shiftPx / 2 else shiftPx / 2 }
                            ) + fadeOut(tween(tabOutDuration)))
                        }
                    },
                    label = "TabContentTransition"
                ) { targetTab ->
                        when (targetTab) {
                            Screen.Overview.route -> {
                                if (userPreferencesRepository != null) {
                                    val overviewViewModel: OverviewViewModel = viewModel(
                                        factory = OverviewViewModel.provideFactory(statsRepository, context, userPreferencesRepository)
                                    )
                                    OverviewScreen(
                                        viewModel = overviewViewModel,
                                        onNavigateToContests = { selectedTab = Screen.Contests.route }
                                    )
                                }
                            }
                            Screen.Contests.route -> {
                                if (contestsRepository != null && userPreferencesRepository != null) {
                                    val contestsViewModel: ContestsViewModel = viewModel(
                                        factory = ContestsViewModel.provideFactory(contestsRepository, context, userPreferencesRepository)
                                    )
                                    ContestsScreen(viewModel = contestsViewModel)
                                } else {
                                    TabPlaceholderScreen("比赛日历", "近期赛事日程")
                                }
                            }
                            Screen.Submissions.route -> {
                                if (submissionsRepository != null && userPreferencesRepository != null) {
                                    val submissionsViewModel: SubmissionsViewModel = viewModel(
                                        factory = SubmissionsViewModel.provideFactory(submissionsRepository, context, userPreferencesRepository)
                                    )
                                    SubmissionsScreen(
                                        viewModel = submissionsViewModel,
                                        onOpenMistakeDetail = { detail ->
                                            activeMistakeDetail = detail
                                        }
                                    )
                                } else {
                                    TabPlaceholderScreen("提交记录", "跨平台提交流")
                                }
                            }
                            Screen.Mistakes.route -> {
                                if (mistakesViewModel != null) {
                                    MistakesScreen(
                                        viewModel = mistakesViewModel,
                                        onOpenMistakeDetail = { detail ->
                                            activeMistakeDetail = detail
                                        },
                                        onOpenMistakeEditor = { editing ->
                                            editingMistakeTarget = editing
                                            showMistakeEditor = true
                                        }
                                    )
                                } else {
                                    TabPlaceholderScreen("错题集", "复习状态管理")
                                }
                            }
                            Screen.Settings.route -> {
                                if (settingsRepository != null && userPreferencesRepository != null) {
                                    val settingsViewModel: SettingsViewModel = viewModel(
                                        factory = SettingsViewModel.provideFactory(settingsRepository, userPreferencesRepository)
                                    )
                                    SettingsScreen(
                                        viewModel = settingsViewModel,
                                        currentUser = currentUser,
                                        currentServerUrl = currentServerUrl,
                                        currentThemeMode = currentThemeMode,
                                        onThemeChange = onThemeChange,
                                        onSaveServerUrl = onSaveServerUrl,
                                        onLogout = onLogout
                                    )
                                } else {
                                    TabPlaceholderScreen("系统设置", "平台与偏好")
                                }
                            }
                        }
                    }
                }
        }

            // 悬浮玻璃胶囊底栏（内容可自由滑过底栏下方）
            MainBottomDock(
                mistakesViewModel = mistakesViewModel,
                selectedRoute = selectedTab,
                onSelect = { screen -> selectedTab = screen.route },
                modifier = Modifier.align(Alignment.BottomCenter)
            )

            if (hasOverlay) {
                val scrimAlpha = if (hasEditor && hasDetail) 0.30f else 0.24f * (1f - mainUnderlyingProgress)
                if (scrimAlpha > 0.005f) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(Color.Black.copy(alpha = scrimAlpha.coerceIn(0f, 0.35f)))
                    )
                }
            }
        }

        // 全屏从右侧滑入详情页（覆盖底栏，支持 X 风格预测性边缘剥离返回）
        AnimatedVisibility(
            visible = hasDetail,
            enter = slideInHorizontally(
                initialOffsetX = { fullWidth -> fullWidth },
                animationSpec = tween(durationMillis = detailAnimDuration, easing = FastOutSlowInEasing)
            ) + fadeIn(animationSpec = tween(detailAnimDuration)),
            exit = slideOutHorizontally(
                targetOffsetX = { fullWidth -> fullWidth },
                animationSpec = tween(durationMillis = detailAnimDuration, easing = FastOutSlowInEasing)
            ) + fadeOut(animationSpec = tween(detailAnimDuration))
        ) {
            activeMistakeDetail?.let { detail ->
                val editorPeek = editorBackProgress.value.coerceIn(0f, 1f)
                val detailPeek = detailBackProgress.value.coerceIn(0f, 1f)
                val detailModifier = when {
                    hasEditor -> Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            val scale = 0.94f + 0.06f * editorPeek
                            scaleX = scale
                            scaleY = scale
                        }
                    detailPeek > 0f -> {
                        val cornerRadius = (detailPeek * 32f).dp
                        val edgeSign = if (detailBackEdge == BackEventCompat.EDGE_RIGHT) -1f else 1f
                        Modifier
                            .fillMaxSize()
                            .clip(RoundedCornerShape(cornerRadius))
                            .graphicsLayer {
                                val scale = 1f - 0.11f * detailPeek
                                scaleX = scale
                                scaleY = scale
                                translationX = edgeSign * size.width * 0.28f * detailPeek
                            }
                    }
                    else -> Modifier.fillMaxSize()
                }
                Box(modifier = detailModifier) {
                    MistakeDetailScreen(
                        mistake = detail,
                        onBack = { activeMistakeDetail = null },
                        onEdit = { item ->
                            editingMistakeTarget = item
                            showMistakeEditor = true
                        },
                        onReview = { item ->
                            mistakesViewModel?.requestReview(item)
                        },
                        onToggleMaster = { item ->
                            mistakesViewModel?.requestToggleMaster(item)
                        },
                        onDelete = { item ->
                            activeMistakeDetail = null
                            mistakesViewModel?.requestDelete(item)
                        }
                    )
                    if (hasEditor) {
                        val detailScrim = 0.22f * (1f - editorPeek)
                        if (detailScrim > 0.005f) {
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .background(Color.Black.copy(alpha = detailScrim))
                            )
                        }
                    }
                }
            }
        }

        // 全屏层压玻璃 Markdown 错题编辑器子页面（替代弹窗，支持进入/退出动效及预测性返回）
        AnimatedVisibility(
            visible = hasEditor,
            enter = slideInVertically(
                initialOffsetY = { fullHeight -> (fullHeight * 0.14f).toInt() },
                animationSpec = tween(durationMillis = editorAnimDuration, easing = FastOutSlowInEasing)
            ) + scaleIn(
                initialScale = 0.96f,
                animationSpec = tween(durationMillis = editorAnimDuration, easing = FastOutSlowInEasing)
            ) + fadeIn(animationSpec = tween(durationMillis = editorAnimDuration)),
            exit = slideOutVertically(
                targetOffsetY = { fullHeight -> (fullHeight * 0.16f).toInt() },
                animationSpec = tween(durationMillis = editorAnimDuration, easing = FastOutSlowInEasing)
            ) + fadeOut(animationSpec = tween(durationMillis = (editorAnimDuration * 0.85f).toInt()))
        ) {
            val editorPeek = editorBackProgress.value.coerceIn(0f, 1f)
            val editorModifier = if (editorPeek > 0f) {
                val cornerRadius = (editorPeek * 32f).dp
                val edgeSign = if (editorBackEdge == BackEventCompat.EDGE_RIGHT) -1f else 1f
                Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(cornerRadius))
                    .graphicsLayer {
                        val scale = 1f - 0.11f * editorPeek
                        scaleX = scale
                        scaleY = scale
                        translationX = edgeSign * size.width * 0.26f * editorPeek
                        translationY = size.height * 0.05f * editorPeek
                    }
            } else {
                Modifier.fillMaxSize()
            }
            MistakeEditorScreen(
                initialMistake = editingMistakeTarget,
                onBack = {
                    showMistakeEditor = false
                    editingMistakeTarget = null
                },
                onConfirmAdd = { req ->
                    mistakesViewModel?.submitAdd(req)
                    showMistakeEditor = false
                    editingMistakeTarget = null
                    selectedTab = Screen.Mistakes.route
                },
                onConfirmEdit = { id, req ->
                    mistakesViewModel?.submitEdit(id, req)
                    activeMistakeDetail = activeMistakeDetail?.let { prev ->
                        if (prev.id == id) {
                            prev.copy(
                                key_point = req.key_point ?: prev.key_point,
                                notes = req.notes ?: prev.notes,
                                tags = req.tags ?: prev.tags,
                                problem_url = req.problem_url ?: prev.problem_url
                            )
                        } else prev
                    }
                    showMistakeEditor = false
                    editingMistakeTarget = null
                },
                modifier = editorModifier
            )
        }
    }
}

@Composable
private fun MainBottomDock(
    mistakesViewModel: MistakesViewModel?,
    selectedRoute: String,
    onSelect: (Screen) -> Unit,
    modifier: Modifier = Modifier
) {
    val dueCount = if (mistakesViewModel != null) {
        val dueFlow = remember(mistakesViewModel) {
            mistakesViewModel.uiState
                .map { it.counts.due }
                .distinctUntilChanged()
        }
        val count by dueFlow.collectAsStateWithLifecycle(initialValue = 0)
        count
    } else 0

    FloatingTactileDock(
        items = Screen.items,
        selectedRoute = selectedRoute,
        dueMistakesCount = dueCount,
        onSelect = onSelect,
        modifier = modifier
    )
}
