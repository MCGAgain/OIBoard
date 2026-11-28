package com.oiboard.app.ui.navigation

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
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

    // 全屏错题详情页状态（错题页与提交页共用）
    var activeMistakeDetail by remember { mutableStateOf<MistakeItemDto?>(null) }

    val mistakesViewModel: MistakesViewModel? = if (mistakesRepository != null && userPreferencesRepository != null) {
        viewModel(factory = MistakesViewModel.provideFactory(mistakesRepository, context, userPreferencesRepository))
    } else null

    val animEnabled = LocalAnimationsEnabled.current
    val tabInDuration = if (animEnabled) 130 else 0
    val tabOutDuration = if (animEnabled) 90 else 0
    val detailAnimDuration = if (animEnabled) 180 else 0

    Box(modifier = Modifier.fillMaxSize()) {
        OIBoardAmbientBackdrop {
            CompositionLocalProvider(LocalDockBottomPadding provides 96.dp) {
                // 0% 掉帧的轻量淡入淡出切换
                AnimatedContent(
                    targetState = selectedTab,
                    transitionSpec = {
                        fadeIn(tween(tabInDuration)) togetherWith fadeOut(tween(tabOutDuration))
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

        // 全屏从右侧滑入详情页（覆盖底栏）
        AnimatedVisibility(
            visible = activeMistakeDetail != null,
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
                MistakeDetailScreen(
                    mistake = detail,
                    onBack = { activeMistakeDetail = null },
                    onEdit = { item ->
                        activeMistakeDetail = null
                        selectedTab = Screen.Mistakes.route
                        mistakesViewModel?.showEditForm(item)
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
            }
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
