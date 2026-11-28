package com.oiboard.app.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockReset
import androidx.compose.material.icons.outlined.NetworkCheck
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.oiboard.app.data.local.AppThemeMode
import com.oiboard.app.data.model.AccountItemDto
import com.oiboard.app.data.model.UserDto
import com.oiboard.app.ui.auth.ServerUrlDialog
import com.oiboard.app.ui.components.TactileGlassCard
import com.oiboard.app.ui.components.TactileIconBadge
import com.oiboard.app.ui.components.TactilePlatformBadge
import com.oiboard.app.ui.components.TactileRecessedWell
import com.oiboard.app.ui.theme.LocalIsDarkTheme

@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    currentUser: UserDto?,
    currentServerUrl: String,
    currentThemeMode: AppThemeMode,
    onThemeChange: (AppThemeMode) -> Unit,
    onSaveServerUrl: (String) -> Unit,
    onLogout: (clearPassword: Boolean) -> Unit
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    var showServerDialog by remember { mutableStateOf(false) }
    var showLogoutConfirm by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.loadData()
    }

    LaunchedEffect(uiState.actionMessage) {
        uiState.actionMessage?.let { msg ->
            snackbarHostState.showSnackbar(msg)
            viewModel.clearActionMessage()
        }
    }

    // 1. 服务地址配置弹窗
    if (showServerDialog) {
        ServerUrlDialog(
            currentUrl = currentServerUrl,
            onDismiss = { showServerDialog = false },
            onConfirm = { newUrl ->
                showServerDialog = false
                onSaveServerUrl(newUrl)
            }
        )
    }

    // 2. 退出登录二次确认弹窗（默认保留已记住的密码，亦可选择清除）
    if (showLogoutConfirm) {
        AlertDialog(
            onDismissRequest = { showLogoutConfirm = false },
            title = { Text("退出登录", fontSize = 17.sp, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("确定退出当前登录状态吗？", fontSize = 13.sp)
                    Text(
                        "默认保留记住的密码，下次登录仅需输入验证码；也可选择清除已保存的密码。",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutConfirm = false
                    onLogout(false)
                }) {
                    Text("保留密码并退出", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = {
                        showLogoutConfirm = false
                        onLogout(true)
                    }) {
                        Text("清除密码并退出", color = MaterialTheme.colorScheme.error)
                    }
                    TextButton(onClick = { showLogoutConfirm = false }) {
                        Text("取消")
                    }
                }
            }
        )
    }

    // 3. 删除账号二次确认
    uiState.pendingDeleteAccount?.let { acc ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissDeleteAccount() },
            title = { Text("移除平台账号", fontSize = 17.sp, fontWeight = FontWeight.Bold) },
            text = { Text("确定移除【${acc.platform.uppercase()} · ${acc.handle}】吗？历史题目数据将安全保留。", fontSize = 13.sp) },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmDeleteAccount() }) {
                    Text("移除", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissDeleteAccount() }) { Text("取消") }
            }
        )
    }

    // 4. 设为主账号二次确认
    uiState.pendingSetPrimary?.let { acc ->
        AlertDialog(
            onDismissRequest = { viewModel.dismissSetPrimary() },
            title = { Text("设为主账号", fontSize = 17.sp, fontWeight = FontWeight.Bold) },
            text = { Text("确定将【${acc.handle}】设为该平台的默认主账号吗？", fontSize = 13.sp) },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmSetPrimary() }) {
                    Text("确定", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissSetPrimary() }) { Text("取消") }
            }
        )
    }

    // 5. 账号添加/编辑表单弹窗
    if (uiState.showAccountFormDialog) {
        AccountFormDialog(
            initialAccount = uiState.editingAccount,
            verifyResult = uiState.verifyResult,
            isVerifying = uiState.isVerifying,
            proxy = uiState.httpProxy,
            onDismiss = { viewModel.dismissAccountForm() },
            onVerify = { p, h, c -> viewModel.verifyAccount(p, h, c, uiState.httpProxy) },
            onSave = { p, h, c, a, prim -> viewModel.saveAccount(p, h, c, a, prim) }
        )
    }

    // 9. 修改密码弹窗
    if (uiState.showChangePasswordDialog) {
        ChangePasswordDialog(
            onDismiss = { viewModel.showChangePasswordDialog(false) },
            onConfirm = { oldP, newP -> viewModel.submitChangePassword(oldP, newP) }
        )
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text(
                text = "偏好与账号",
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(horizontal = 2.dp, vertical = 2.dp)
            )

            // 一、账户信息卡片
            TactileGlassCard(
                modifier = Modifier.fillMaxWidth(),
                cornerRadius = 20.dp
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        TactileIconBadge(
                            icon = Icons.Default.AccountCircle,
                            tint = MaterialTheme.colorScheme.primary,
                            size = 28.dp,
                            iconSize = 16.dp
                        )
                        Text(
                            text = "账户信息",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    Spacer(modifier = Modifier.height(14.dp))

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column {
                            Text(
                                text = currentUser?.username ?: "未知用户",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "已登录",
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // 服务连接入口
                    TactileRecessedWell(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { showServerDialog = true },
                        cornerRadius = 12.dp
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.CheckCircle,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(19.dp)
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                text = "服务连接",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Spacer(modifier = Modifier.weight(1f))
                            Text(
                                text = "已连接",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.primary,
                                fontWeight = FontWeight.SemiBold
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Icon(
                                imageVector = Icons.AutoMirrored.Outlined.ArrowForwardIos,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(12.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    OutlinedButton(
                        onClick = { showLogoutConfirm = true },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.35f)),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.Logout,
                            contentDescription = "注销",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("退出登录", fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            // 二、平台账号管理卡片
            TactileGlassCard(
                modifier = Modifier.fillMaxWidth(),
                cornerRadius = 20.dp
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            TactileIconBadge(
                                icon = Icons.Outlined.CloudSync,
                                tint = MaterialTheme.colorScheme.primary,
                                size = 28.dp,
                                iconSize = 15.dp
                            )
                            Text(
                                text = "平台账号",
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }

                        TextButton(onClick = { viewModel.openAccountForm(null) }) {
                            Icon(
                                imageVector = Icons.Outlined.Add,
                                contentDescription = "绑定",
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("绑定账号", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    if (uiState.accounts.isEmpty()) {
                        TactileRecessedWell(
                            modifier = Modifier.fillMaxWidth(),
                            cornerRadius = 12.dp
                        ) {
                            Text(
                                text = "暂无绑定的平台账号",
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 14.dp)
                            )
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            uiState.accounts.forEach { acc ->
                                AccountCardItem(
                                    account = acc,
                                    onSetPrimary = { viewModel.requestSetPrimary(acc) },
                                    onEdit = { viewModel.openAccountForm(acc) },
                                    onDelete = { viewModel.requestDeleteAccount(acc) }
                                )
                            }
                        }
                    }
                }
            }

            // 三、安全与密码卡片
            TactileGlassCard(
                modifier = Modifier.fillMaxWidth(),
                cornerRadius = 20.dp
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        TactileIconBadge(
                            icon = Icons.Outlined.Lock,
                            tint = Color(0xFF6366F1),
                            size = 28.dp,
                            iconSize = 15.dp
                        )
                        Text(
                            text = "安全设置",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    Spacer(modifier = Modifier.height(14.dp))

                    OutlinedButton(
                        onClick = { viewModel.showChangePasswordDialog(true) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Lock,
                            contentDescription = "修改密码",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("修改登录密码", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    OutlinedButton(
                        onClick = { viewModel.clearSavedPassword() },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.LockReset,
                            contentDescription = "清除已保存的密码",
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("清除已保存的密码", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            // 四、外观主题卡片
            TactileGlassCard(
                modifier = Modifier.fillMaxWidth(),
                cornerRadius = 20.dp
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        TactileIconBadge(
                            icon = Icons.Default.DarkMode,
                            tint = MaterialTheme.colorScheme.primary,
                            size = 28.dp,
                            iconSize = 15.dp
                        )
                        Text(
                            text = "界面主题",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    ThemeOptionRow(
                        title = "跟随系统",
                        selected = currentThemeMode == AppThemeMode.SYSTEM,
                        onClick = { onThemeChange(AppThemeMode.SYSTEM) }
                    )
                    ThemeOptionRow(
                        title = "极简浅色 (Porcelain)",
                        selected = currentThemeMode == AppThemeMode.LIGHT,
                        onClick = { onThemeChange(AppThemeMode.LIGHT) }
                    )
                    ThemeOptionRow(
                        title = "深色模式 (Obsidian OLED)",
                        selected = currentThemeMode == AppThemeMode.DARK,
                        onClick = { onThemeChange(AppThemeMode.DARK) }
                    )
                }
            }

            // 五、界面动效设置卡片
            TactileGlassCard(
                modifier = Modifier.fillMaxWidth(),
                cornerRadius = 20.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        TactileIconBadge(
                            icon = Icons.Outlined.AutoAwesome,
                            tint = Color(0xFF10B981),
                            size = 28.dp,
                            iconSize = 15.dp
                        )
                        Column {
                            Text(
                                text = "界面动效",
                                fontSize = 16.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = "导航滑动、数字滚动与按压弹性反馈",
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Switch(
                        checked = uiState.isAnimationEnabled,
                        onCheckedChange = { viewModel.toggleAnimation(it) }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 16.dp)
        )
    }
}

@Composable
private fun AccountCardItem(
    account: AccountItemDto,
    onSetPrimary: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    TactileRecessedWell(
        modifier = Modifier.fillMaxWidth(),
        cornerRadius = 14.dp
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            TactilePlatformBadge(platform = account.platform)

            Spacer(modifier = Modifier.width(10.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = account.handle,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (account.is_primary || !account.alias.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(3.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        if (account.is_primary) {
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = MaterialTheme.colorScheme.primaryContainer
                            ) {
                                Text(
                                    text = "主账号",
                                    fontSize = 9.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
                                    maxLines = 1,
                                    softWrap = false
                                )
                            }
                        }
                        if (!account.alias.isNullOrBlank()) {
                            Text(
                                text = account.alias,
                                fontSize = 11.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                if (!account.is_primary) {
                    IconButton(onClick = onSetPrimary, modifier = Modifier.size(28.dp)) {
                        Icon(
                            imageVector = Icons.Outlined.StarOutline,
                            contentDescription = "设为主账号",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                }
                IconButton(onClick = onEdit, modifier = Modifier.size(28.dp)) {
                    Icon(
                        imageVector = Icons.Outlined.Edit,
                        contentDescription = "编辑",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp)
                    )
                }
                IconButton(onClick = onDelete, modifier = Modifier.size(28.dp)) {
                    Icon(
                        imageVector = Icons.Outlined.DeleteOutline,
                        contentDescription = "移除",
                        tint = MaterialTheme.colorScheme.error.copy(alpha = 0.8f),
                        modifier = Modifier.size(16.dp)
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AccountFormDialog(
    initialAccount: AccountItemDto?,
    verifyResult: com.oiboard.app.data.model.VerifyAccountResponse?,
    isVerifying: Boolean,
    proxy: String,
    onDismiss: () -> Unit,
    onVerify: (String, String, String) -> Unit,
    onSave: (String, String, String, String, Boolean) -> Unit
) {
    val isEdit = initialAccount != null
    var platform by remember { mutableStateOf(initialAccount?.platform ?: "codeforces") }
    var handle by remember { mutableStateOf(initialAccount?.handle ?: "") }
    var cookie by remember { mutableStateOf(initialAccount?.cookie ?: "") }
    var alias by remember { mutableStateOf(initialAccount?.alias ?: "") }
    var isPrimary by remember { mutableStateOf(initialAccount?.is_primary ?: false) }

    var expandedPlatform by remember { mutableStateOf(false) }
    val platforms = listOf("codeforces", "atcoder", "luogu", "acwing", "leetcode")

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = if (isEdit) "编辑平台账号" else "绑定平台账号",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (!isEdit) {
                    ExposedDropdownMenuBox(
                        expanded = expandedPlatform,
                        onExpandedChange = { expandedPlatform = !expandedPlatform }
                    ) {
                        OutlinedTextField(
                            value = platform.uppercase(),
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("平台选择") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expandedPlatform) },
                            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
                            shape = RoundedCornerShape(10.dp)
                        )
                        ExposedDropdownMenu(
                            expanded = expandedPlatform,
                            onDismissRequest = { expandedPlatform = false }
                        ) {
                            platforms.forEach { p ->
                                DropdownMenuItem(
                                    text = { Text(p.uppercase()) },
                                    onClick = {
                                        platform = p
                                        expandedPlatform = false
                                    }
                                )
                            }
                        }
                    }
                }

                OutlinedTextField(
                    value = handle,
                    onValueChange = { handle = it },
                    label = { Text("用户名 / Handle") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = cookie,
                    onValueChange = { cookie = it },
                    label = { Text("Cookie 凭据 (洛谷/AcWing 可填)") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                OutlinedTextField(
                    value = alias,
                    onValueChange = { alias = it },
                    label = { Text("别名备注 (可选)") },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("设为默认主账号", fontSize = 13.sp)
                    Switch(checked = isPrimary, onCheckedChange = { isPrimary = it })
                }

                // 连通性测试按钮
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(
                        onClick = { onVerify(platform, handle, cookie) },
                        enabled = handle.isNotBlank() && !isVerifying,
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        if (isVerifying) {
                            CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Outlined.NetworkCheck, contentDescription = null, modifier = Modifier.size(14.dp))
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("测试连通性", fontSize = 12.sp)
                    }
                }

                if (verifyResult != null) {
                    Text(
                        text = if (verifyResult.valid) "✓ 账号有效: ${verifyResult.message}" else "✗ 验证失败: ${verifyResult.message}",
                        color = if (verifyResult.valid) Color(0xFF2E7D32) else MaterialTheme.colorScheme.error,
                        fontSize = 11.sp
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(platform, handle, cookie, alias, isPrimary) },
                enabled = handle.isNotBlank()
            ) {
                Text("保存", fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}

@Composable
private fun ChangePasswordDialog(
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit
) {
    var oldPass by remember { mutableStateOf("") }
    var newPass by remember { mutableStateOf("") }
    var confirmPass by remember { mutableStateOf("") }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var showConfirmDialog by remember { mutableStateOf(false) }

    if (showConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showConfirmDialog = false },
            title = { Text("确认修改密码", fontSize = 17.sp, fontWeight = FontWeight.Bold) },
            text = { Text("确定要修改当前账户的登录密码吗？", fontSize = 13.sp) },
            confirmButton = {
                TextButton(onClick = {
                    showConfirmDialog = false
                    onConfirm(oldPass, newPass)
                }) {
                    Text("确定修改", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmDialog = false }) { Text("取消") }
            }
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("修改登录密码", fontSize = 18.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding(),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedTextField(
                    value = oldPass,
                    onValueChange = { oldPass = it },
                    label = { Text("原密码") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = newPass,
                    onValueChange = { newPass = it },
                    label = { Text("新密码 (至少 6 位)") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = confirmPass,
                    onValueChange = { confirmPass = it },
                    label = { Text("确认新密码") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                if (errorMsg != null) {
                    Text(text = errorMsg ?: "", color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (newPass.length < 6) {
                        errorMsg = "新密码长度至少需要 6 位"
                    } else if (newPass != confirmPass) {
                        errorMsg = "两次输入的新密码不一致"
                    } else if (oldPass.isBlank()) {
                        errorMsg = "原密码不能为空"
                    } else {
                        errorMsg = null
                        showConfirmDialog = true
                    }
                }
            ) {
                Text("保存", fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}

@Composable
private fun ThemeOptionRow(
    title: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        RadioButton(
            selected = selected,
            onClick = onClick
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = title,
            fontSize = 14.sp,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}
