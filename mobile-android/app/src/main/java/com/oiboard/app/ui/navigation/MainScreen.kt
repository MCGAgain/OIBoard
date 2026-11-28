package com.oiboard.app.ui.navigation

import android.os.Build
import android.view.RoundedCorner
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
import androidx.compose.animation.scaleOut
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
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
    var renderedMistakeDetail by remember { mutableStateOf<MistakeItemDto?>(null) }
    var isDetailDismissing by remember { mutableStateOf(false) }
    var detailGeneration by remember { mutableIntStateOf(0) }
    var detailAnimJob by remember { mutableStateOf<Job?>(null) }

    var showMistakeEditor by remember { mutableStateOf(false) }
    var editingMistakeTarget by remember { mutableStateOf<MistakeItemDto?>(null) }
    var renderedEditorTarget by remember { mutableStateOf<MistakeItemDto?>(null) }
    var isEditorDismissing by remember { mutableStateOf(false) }
    var editorGeneration by remember { mutableIntStateOf(0) }
    var editorAnimJob by remember { mutableStateOf<Job?>(null) }

    val detailBackProgress = remember { Animatable(0f) }
    var detailBackEdge by remember { mutableIntStateOf(BackEventCompat.EDGE_LEFT) }
    val detailBackAlpha = remember { Animatable(1f) }
    var wasDetailDismissedByBack by remember { mutableStateOf(false) }

    val editorBackProgress = remember { Animatable(0f) }
    var editorBackEdge by remember { mutableIntStateOf(BackEventCompat.EDGE_LEFT) }
    val editorBackAlpha = remember { Animatable(1f) }
    var wasEditorDismissedByBack by remember { mutableStateOf(false) }

    val uiScope = rememberCoroutineScope()

    val mistakesViewModel: MistakesViewModel? = if (mistakesRepository != null && userPreferencesRepository != null) {
        viewModel(factory = MistakesViewModel.provideFactory(mistakesRepository, context, userPreferencesRepository))
    } else null

    val refreshedDetail = if (mistakesViewModel != null) {
        val flow = remember(mistakesViewModel) {
            mistakesViewModel.uiState
                .map { it.selectedMistakeForDetail }
                .distinctUntilChanged()
        }
        flow.collectAsStateWithLifecycle(initialValue = null).value
    } else null

    LaunchedEffect(refreshedDetail) {
        val fresh = refreshedDetail ?: return@LaunchedEffect
        if (!isDetailDismissing && activeMistakeDetail?.id == fresh.id) {
            renderedMistakeDetail = fresh
            activeMistakeDetail = fresh
        }
        mistakesViewModel?.consumeRefreshedDetail()
    }

    fun openMistakeDetail(detail: MistakeItemDto) {
        val gen = ++detailGeneration
        isDetailDismissing = false
        detailAnimJob?.cancel()
        wasDetailDismissedByBack = false
        renderedMistakeDetail = detail
        activeMistakeDetail = detail
        mistakesViewModel?.refreshDetail(detail)
        detailAnimJob = uiScope.launch {
            if (detailGeneration != gen) return@launch
            detailBackProgress.snapTo(0f)
            detailBackAlpha.snapTo(1f)
        }
    }

    fun closeMistakeDetailByButton() {
        if (isDetailDismissing) return
        ++detailGeneration
        detailAnimJob?.cancel()
        mistakesViewModel?.cancelDetailRefresh()
        isDetailDismissing = false
        wasDetailDismissedByBack = false
        activeMistakeDetail = null
    }

    fun dismissDetailByPredictiveBack() {
        if (isDetailDismissing || activeMistakeDetail == null) return
        val gen = ++detailGeneration
        isDetailDismissing = true
        mistakesViewModel?.cancelDetailRefresh()
        detailAnimJob?.cancel()
        detailAnimJob = uiScope.launch {
            try {
                coroutineScope {
                    launch {
                        detailBackProgress.animateTo(
                            targetValue = 1.15f,
                            animationSpec = tween(durationMillis = 185, easing = FastOutSlowInEasing)
                        )
                    }
                    launch {
                        detailBackAlpha.animateTo(
                            targetValue = 0f,
                            animationSpec = tween(durationMillis = 170, easing = FastOutSlowInEasing)
                        )
                    }
                }
            } finally {
                if (detailGeneration == gen) {
                    wasDetailDismissedByBack = true
                    activeMistakeDetail = null
                    isDetailDismissing = false
                }
            }
        }
    }

    fun openMistakeEditor(editing: MistakeItemDto?) {
        val gen = ++editorGeneration
        isEditorDismissing = false
        editorAnimJob?.cancel()
        wasEditorDismissedByBack = false
        renderedEditorTarget = editing
        editingMistakeTarget = editing
        showMistakeEditor = true
        editorAnimJob = uiScope.launch {
            if (editorGeneration != gen) return@launch
            editorBackProgress.snapTo(0f)
            editorBackAlpha.snapTo(1f)
        }
    }

    fun closeMistakeEditorByButton() {
        if (isEditorDismissing) return
        ++editorGeneration
        editorAnimJob?.cancel()
        isEditorDismissing = false
        wasEditorDismissedByBack = false
        showMistakeEditor = false
        editingMistakeTarget = null
    }

    fun dismissEditorByPredictiveBack() {
        if (isEditorDismissing || !showMistakeEditor) return
        val gen = ++editorGeneration
        isEditorDismissing = true
        editorAnimJob?.cancel()
        editorAnimJob = uiScope.launch {
            try {
                coroutineScope {
                    launch {
                        editorBackProgress.animateTo(
                            targetValue = 1.15f,
                            animationSpec = tween(durationMillis = 185, easing = FastOutSlowInEasing)
                        )
                    }
                    launch {
                        editorBackAlpha.animateTo(
                            targetValue = 0f,
                            animationSpec = tween(durationMillis = 170, easing = FastOutSlowInEasing)
                        )
                    }
                }
            } finally {
                if (editorGeneration == gen) {
                    wasEditorDismissedByBack = true
                    showMistakeEditor = false
                    editingMistakeTarget = null
                    isEditorDismissing = false
                }
            }
        }
    }

    val hasDetail = activeMistakeDetail != null
    val hasEditor = showMistakeEditor
    val hasOverlay = hasDetail || hasEditor
    val deviceCornerShape = rememberDeviceCornerShape(hasOverlay)

    // X (Twitter) 风格预测性返回手势：仅在 try/catch 内采集手势流；松手确认后独立调度退出动画，彻底避免协程竞态回弹
    PredictiveBackHandler(enabled = hasDetail && !isDetailDismissing && !hasEditor) { progress: Flow<BackEventCompat> ->
        detailAnimJob?.cancel()
        val committed = try {
            progress.collect { backEvent ->
                detailBackEdge = backEvent.swipeEdge
                detailBackProgress.snapTo(backEvent.progress)
            }
            true
        } catch (_: CancellationException) {
            if (!isDetailDismissing && activeMistakeDetail != null) {
                val gen = detailGeneration
                detailAnimJob = uiScope.launch {
                    if (detailGeneration != gen || isDetailDismissing) return@launch
                    coroutineScope {
                        launch {
                            detailBackProgress.animateTo(
                                targetValue = 0f,
                                animationSpec = spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMediumLow)
                            )
                        }
                        launch {
                            detailBackAlpha.animateTo(
                                targetValue = 1f,
                                animationSpec = tween(durationMillis = 120)
                            )
                        }
                    }
                }
            }
            false
        }
        if (committed) {
            dismissDetailByPredictiveBack()
        }
    }

    PredictiveBackHandler(enabled = hasEditor && !isEditorDismissing) { progress: Flow<BackEventCompat> ->
        editorAnimJob?.cancel()
        val committed = try {
            progress.collect { backEvent ->
                editorBackEdge = backEvent.swipeEdge
                editorBackProgress.snapTo(backEvent.progress)
            }
            true
        } catch (_: CancellationException) {
            if (!isEditorDismissing && showMistakeEditor) {
                val gen = editorGeneration
                editorAnimJob = uiScope.launch {
                    if (editorGeneration != gen || isEditorDismissing) return@launch
                    coroutineScope {
                        launch {
                            editorBackProgress.animateTo(
                                targetValue = 0f,
                                animationSpec = spring(dampingRatio = 0.85f, stiffness = Spring.StiffnessMediumLow)
                            )
                        }
                        launch {
                            editorBackAlpha.animateTo(
                                targetValue = 1f,
                                animationSpec = tween(durationMillis = 120)
                            )
                        }
                    }
                }
            }
            false
        }
        if (committed) {
            dismissEditorByPredictiveBack()
        }
    }

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
                                            openMistakeDetail(detail)
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
                                            openMistakeDetail(detail)
                                        },
                                        onOpenMistakeEditor = { editing ->
                                            openMistakeEditor(editing)
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

        // 全屏从右侧滑入详情页（覆盖底栏，支持 X 风格硬件圆角预测性边缘剥离返回 + 淡出动画）
        AnimatedVisibility(
            visible = hasDetail,
            enter = slideInHorizontally(
                initialOffsetX = { fullWidth -> fullWidth },
                animationSpec = tween(durationMillis = detailAnimDuration, easing = FastOutSlowInEasing)
            ) + fadeIn(animationSpec = tween(detailAnimDuration)),
            exit = if (wasDetailDismissedByBack) {
                fadeOut(tween(0))
            } else {
                slideOutHorizontally(
                    targetOffsetX = { fullWidth -> fullWidth },
                    animationSpec = tween(durationMillis = detailAnimDuration, easing = FastOutSlowInEasing)
                ) + fadeOut(animationSpec = tween(detailAnimDuration))
            }
        ) {
            renderedMistakeDetail?.let { detail ->
                val editorPeek = editorBackProgress.value.coerceIn(0f, 1f)
                val detailPeek = detailBackProgress.value.coerceIn(0f, 1.15f)
                val detailAlpha = detailBackAlpha.value.coerceIn(0f, 1f)
                val detailModifier = when {
                    hasEditor -> Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            val scale = 0.94f + 0.06f * editorPeek
                            scaleX = scale
                            scaleY = scale
                        }
                    detailPeek > 0f || detailAlpha < 1f -> {
                        val edgeSign = if (detailBackEdge == BackEventCompat.EDGE_RIGHT) -1f else 1f
                        Modifier
                            .fillMaxSize()
                            .graphicsLayer {
                                val clampedPeek = detailPeek
                                val scale = 1f - 0.13f * clampedPeek
                                scaleX = scale
                                scaleY = scale
                                translationX = edgeSign * size.width * 0.25f * clampedPeek
                                alpha = (detailAlpha * (1f - 0.12f * clampedPeek.coerceAtMost(1f))).coerceIn(0f, 1f)
                                shape = deviceCornerShape
                                clip = true
                                shadowElevation = with(density) { (20.dp * clampedPeek.coerceAtMost(1f)).toPx() }
                            }
                    }
                    else -> Modifier.fillMaxSize()
                }
                Box(modifier = detailModifier) {
                    MistakeDetailScreen(
                        mistake = detail,
                        onBack = { if (!isDetailDismissing) closeMistakeDetailByButton() },
                        onEdit = { item ->
                            if (!isDetailDismissing) openMistakeEditor(item)
                        },
                        onReview = { item ->
                            if (!isDetailDismissing) mistakesViewModel?.requestReview(item)
                        },
                        onToggleMaster = { item ->
                            if (!isDetailDismissing) mistakesViewModel?.requestToggleMaster(item)
                        },
                        onDelete = { item ->
                            if (!isDetailDismissing) {
                                closeMistakeDetailByButton()
                                mistakesViewModel?.requestDelete(item)
                            }
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

        // 全屏层压玻璃 Markdown 错题编辑器子页面（替代弹窗，支持进入/退出缩放淡出及 X 风格硬件圆角预测性返回）
        AnimatedVisibility(
            visible = hasEditor,
            enter = slideInVertically(
                initialOffsetY = { fullHeight -> (fullHeight * 0.14f).toInt() },
                animationSpec = tween(durationMillis = editorAnimDuration, easing = FastOutSlowInEasing)
            ) + scaleIn(
                initialScale = 0.96f,
                animationSpec = tween(durationMillis = editorAnimDuration, easing = FastOutSlowInEasing)
            ) + fadeIn(animationSpec = tween(durationMillis = editorAnimDuration)),
            exit = if (wasEditorDismissedByBack) {
                fadeOut(tween(0))
            } else {
                slideOutVertically(
                    targetOffsetY = { fullHeight -> (fullHeight * 0.16f).toInt() },
                    animationSpec = tween(durationMillis = editorAnimDuration, easing = FastOutSlowInEasing)
                ) + scaleOut(
                    targetScale = 0.94f,
                    animationSpec = tween(durationMillis = editorAnimDuration, easing = FastOutSlowInEasing)
                ) + fadeOut(animationSpec = tween(durationMillis = (editorAnimDuration * 0.85f).toInt()))
            }
        ) {
            val editorPeek = editorBackProgress.value.coerceIn(0f, 1.15f)
            val editorAlpha = editorBackAlpha.value.coerceIn(0f, 1f)
            val editorModifier = if (editorPeek > 0f || editorAlpha < 1f) {
                val edgeSign = if (editorBackEdge == BackEventCompat.EDGE_RIGHT) -1f else 1f
                Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        val clampedPeek = editorPeek
                        val scale = 1f - 0.13f * clampedPeek
                        scaleX = scale
                        scaleY = scale
                        translationX = edgeSign * size.width * 0.25f * clampedPeek
                        translationY = size.height * 0.04f * clampedPeek
                        alpha = (editorAlpha * (1f - 0.12f * clampedPeek.coerceAtMost(1f))).coerceIn(0f, 1f)
                        shape = deviceCornerShape
                        clip = true
                        shadowElevation = with(density) { (20.dp * clampedPeek.coerceAtMost(1f)).toPx() }
                    }
            } else {
                Modifier.fillMaxSize()
            }
            Box(modifier = editorModifier) {
                MistakeEditorScreen(
                    initialMistake = renderedEditorTarget,
                    onBack = { if (!isEditorDismissing) closeMistakeEditorByButton() },
                    onConfirmAdd = { req ->
                        if (!isEditorDismissing) {
                            mistakesViewModel?.submitAdd(req)
                            closeMistakeEditorByButton()
                            selectedTab = Screen.Mistakes.route
                        }
                    },
                    onConfirmEdit = { id, req ->
                        if (!isEditorDismissing) {
                            mistakesViewModel?.submitEdit(id, req)
                            val updated = activeMistakeDetail?.let { prev ->
                                if (prev.id == id) {
                                    prev.copy(
                                        key_point = req.key_point ?: prev.key_point,
                                        notes = req.notes ?: prev.notes,
                                        tags = req.tags ?: prev.tags,
                                        problem_url = req.problem_url ?: prev.problem_url
                                    )
                                } else prev
                            }
                            activeMistakeDetail = updated
                            if (updated != null) {
                                renderedMistakeDetail = updated
                            }
                            closeMistakeEditorByButton()
                        }
                    },
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
    }
}

/**
 * 读取当前设备的物理屏幕四角圆角半径（Android 12+ RoundedCorner API，小米 14 约为 44.67dp），
 * 使预测性返回拖拽剥离卡片的圆角精确贴合真实物理屏幕边框。
 */
@Composable
private fun rememberDeviceCornerShape(refreshKey: Any): RoundedCornerShape {
    val view = LocalView.current
    val density = LocalDensity.current
    return remember(view, density, refreshKey) {
        val defaultRadius = 38.dp
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val insets = view.rootWindowInsets
            fun cornerDp(position: Int): Dp {
                val radiusPx = insets?.getRoundedCorner(position)?.radius ?: 0
                return if (radiusPx > 0) with(density) { radiusPx.toDp() } else defaultRadius
            }
            RoundedCornerShape(
                topStart = cornerDp(RoundedCorner.POSITION_TOP_LEFT),
                topEnd = cornerDp(RoundedCorner.POSITION_TOP_RIGHT),
                bottomEnd = cornerDp(RoundedCorner.POSITION_BOTTOM_RIGHT),
                bottomStart = cornerDp(RoundedCorner.POSITION_BOTTOM_LEFT)
            )
        } else {
            RoundedCornerShape(defaultRadius)
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
