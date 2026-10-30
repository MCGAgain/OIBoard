package com.oiboard.app.ui.navigation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.oiboard.app.data.local.AppThemeMode
import com.oiboard.app.data.local.UserPreferencesRepository
import com.oiboard.app.data.model.MistakeItemDto
import com.oiboard.app.data.model.UserDto
import com.oiboard.app.data.repository.ContestsRepository
import com.oiboard.app.data.repository.MistakesRepository
import com.oiboard.app.data.repository.SettingsRepository
import com.oiboard.app.data.repository.StatsRepository
import com.oiboard.app.data.repository.SubmissionsRepository
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

    // 全屏错题详情页状态（错题页与提交页共用）
    var activeMistakeDetail by remember { mutableStateOf<MistakeItemDto?>(null) }

    val mistakesViewModel: MistakesViewModel? = mistakesRepository?.let {
        viewModel(factory = MistakesViewModel.provideFactory(it))
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            containerColor = MaterialTheme.colorScheme.background,
            bottomBar = {
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp
                ) {
                    Screen.items.forEach { screen ->
                        val isSelected = selectedTab == screen.route
                        NavigationBarItem(
                            selected = isSelected,
                            onClick = { selectedTab = screen.route },
                            icon = {
                                Icon(
                                    imageVector = screen.icon,
                                    contentDescription = screen.title
                                )
                            },
                            label = {
                                Text(
                                    text = screen.title,
                                    fontSize = 10.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    maxLines = 1
                                )
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                selectedTextColor = MaterialTheme.colorScheme.primary,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                indicatorColor = MaterialTheme.colorScheme.primaryContainer
                            )
                        )
                    }
                }
            }
        ) { innerPadding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPadding)
            ) {
                when (selectedTab) {
                    Screen.Overview.route -> {
                        val overviewViewModel: OverviewViewModel = viewModel(
                            factory = OverviewViewModel.provideFactory(statsRepository)
                        )
                        OverviewScreen(
                            viewModel = overviewViewModel,
                            onNavigateToContests = { selectedTab = Screen.Contests.route }
                        )
                    }
                    Screen.Contests.route -> {
                        if (contestsRepository != null) {
                            val contestsViewModel: ContestsViewModel = viewModel(
                                factory = ContestsViewModel.provideFactory(contestsRepository)
                            )
                            ContestsScreen(viewModel = contestsViewModel)
                        } else {
                            TabPlaceholderScreen("比赛日历", "近期赛事日程")
                        }
                    }
                    Screen.Submissions.route -> {
                        if (submissionsRepository != null) {
                            val submissionsViewModel: SubmissionsViewModel = viewModel(
                                factory = SubmissionsViewModel.provideFactory(submissionsRepository)
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

        // 全屏从右侧滑入详情页（水平转场时长 180ms <= 200ms，全屏覆盖底栏，支持系统返回键与手势）
        AnimatedVisibility(
            visible = activeMistakeDetail != null,
            enter = slideInHorizontally(
                initialOffsetX = { fullWidth -> fullWidth },
                animationSpec = tween(durationMillis = 180, easing = FastOutSlowInEasing)
            ) + fadeIn(animationSpec = tween(180)),
            exit = slideOutHorizontally(
                targetOffsetX = { fullWidth -> fullWidth },
                animationSpec = tween(durationMillis = 180, easing = FastOutSlowInEasing)
            ) + fadeOut(animationSpec = tween(180))
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
