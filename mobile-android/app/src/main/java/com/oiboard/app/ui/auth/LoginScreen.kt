package com.oiboard.app.ui.auth

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.autofill.AutofillNode
import androidx.compose.ui.autofill.AutofillType
import androidx.compose.ui.composed
import androidx.compose.ui.draw.scale
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalAutofill
import androidx.compose.ui.platform.LocalAutofillTree
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

import com.oiboard.app.data.local.AppThemeMode

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun LoginScreen(
    viewModel: AuthViewModel,
    currentThemeMode: AppThemeMode = AppThemeMode.SYSTEM,
    onThemeToggle: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val scrollState = rememberScrollState()

    val captchaBitmap = remember(uiState.captchaImageBase64) {
        try {
            if (uiState.captchaImageBase64.isNotBlank()) {
                val cleanBase64 = uiState.captchaImageBase64.substringAfter("base64,")
                val bytes = Base64.decode(cleanBase64, Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } else null
        } catch (_: Exception) {
            null
        }
    }

    if (uiState.isServerUrlDialogOpen) {
        ServerUrlDialog(
            currentUrl = uiState.serverUrl,
            onDismiss = { viewModel.showServerUrlDialog(false) },
            onConfirm = { newUrl -> viewModel.saveServerUrl(newUrl) }
        )
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .imePadding()
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 24.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // 顶部工具栏（主题切换 + 服务器配置）
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                ) {
                    IconButton(
                        onClick = onThemeToggle,
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = if (currentThemeMode == AppThemeMode.DARK) Icons.Default.LightMode else Icons.Default.DarkMode,
                            contentDescription = "切换主题",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }

                Spacer(modifier = Modifier.width(10.dp))

                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f)
                ) {
                    IconButton(
                        onClick = { viewModel.showServerUrlDialog(true) },
                        modifier = Modifier.size(40.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Dns,
                            contentDescription = "服务器地址",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            // App 标志与现代排版
            Text(
                text = "OIBoard",
                fontSize = 34.sp,
                fontWeight = FontWeight.Black,
                color = MaterialTheme.colorScheme.primary,
                letterSpacing = (-0.5).sp
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "算法竞赛与刷题看板",
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            // 现代胶囊式 登录 / 注册 切片
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                val isLogin = !uiState.isRegisterMode
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (isLogin) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant)
                        .clickable { if (!isLogin) viewModel.toggleMode() }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "登录",
                        fontSize = 13.sp,
                        fontWeight = if (isLogin) FontWeight.Bold else FontWeight.Normal,
                        color = if (isLogin) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (!isLogin) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceVariant)
                        .clickable { if (isLogin) viewModel.toggleMode() }
                        .padding(vertical = 10.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "注册",
                        fontSize = 13.sp,
                        fontWeight = if (!isLogin) FontWeight.Bold else FontWeight.Normal,
                        color = if (!isLogin) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(20.dp))

            // 错误提示条
            if (uiState.errorMessage != null) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Default.Warning,
                            contentDescription = "提示",
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = uiState.errorMessage ?: "",
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            fontSize = 13.sp
                        )
                    }
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            // 用户名
            OutlinedTextField(
                value = uiState.username,
                onValueChange = viewModel::onUsernameChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .autofill(listOf(AutofillType.Username), viewModel::onUsernameChange),
                label = { Text("用户名", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Person,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant
                )
            )

            Spacer(modifier = Modifier.height(14.dp))

            // 密码
            OutlinedTextField(
                value = uiState.password,
                onValueChange = viewModel::onPasswordChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .autofill(listOf(AutofillType.Password), viewModel::onPasswordChange),
                label = { Text("密码", fontSize = 13.sp) },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Default.Lock,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = if (uiState.isRegisterMode) ImeAction.Next else ImeAction.Done
                ),
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant
                )
            )

            if (uiState.isRegisterMode) {
                Spacer(modifier = Modifier.height(14.dp))
                OutlinedTextField(
                    value = uiState.confirmPassword,
                    onValueChange = viewModel::onConfirmPasswordChange,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("确认密码", fontSize = 13.sp) },
                    leadingIcon = {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp)
                        )
                    },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done
                    ),
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surface,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant
                    )
                )
            } else {
                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable { viewModel.setRememberPassword(!uiState.rememberPassword) }
                        .padding(horizontal = 4.dp, vertical = 2.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Default.Lock,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "记住密码",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    }
                    Switch(
                        checked = uiState.rememberPassword,
                        onCheckedChange = { viewModel.setRememberPassword(it) },
                        modifier = Modifier.scale(0.85f)
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            // 验证码
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = uiState.captchaCode,
                    onValueChange = viewModel::onCaptchaCodeChange,
                    modifier = Modifier.weight(1f),
                    label = { Text("验证码", fontSize = 13.sp) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { viewModel.submit() }),
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surface,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant
                    )
                )

                Box(
                    modifier = Modifier
                        .height(56.dp)
                        .width(132.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clickable { viewModel.refreshCaptcha() },
                    contentAlignment = Alignment.Center
                ) {
                    if (uiState.isCaptchaLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.primary
                        )
                    } else if (captchaBitmap != null) {
                        Image(
                            bitmap = captchaBitmap.asImageBitmap(),
                            contentDescription = "点击刷新验证码",
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "刷新",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("点击重试", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(28.dp))

            // 提交按钮
            Button(
                onClick = viewModel::submit,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
                shape = RoundedCornerShape(14.dp),
                enabled = !uiState.isLoading,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary
                )
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else {
                    Text(
                        text = if (uiState.isRegisterMode) "立即注册并登录" else "登 录",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(modifier = Modifier.height(18.dp))

            Text(
                text = "服务器: ${uiState.serverUrl}",
                fontSize = 11.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            )
        }
    }
}

private fun sanitizeServerUrl(rawInput: String): String {
    var trimmed = rawInput.trim()
    while (trimmed.endsWith("/")) {
        trimmed = trimmed.substring(0, trimmed.length - 1).trim()
    }
    if (trimmed.isEmpty()) return ""

    if (!trimmed.startsWith("http://", ignoreCase = true) &&
        !trimmed.startsWith("https://", ignoreCase = true)) {
        trimmed = if (trimmed.startsWith("10.0.2.2", ignoreCase = true) ||
            trimmed.startsWith("127.0.0.1", ignoreCase = true) ||
            trimmed.startsWith("localhost", ignoreCase = true)) {
            "http://$trimmed"
        } else {
            "https://$trimmed"
        }
    }
    return trimmed
}

private fun isNonLocalCleartext(url: String): Boolean {
    val trimmed = url.trim().lowercase()
    if (!trimmed.startsWith("http://")) return false
    val hostPart = trimmed.removePrefix("http://").substringBefore("/").substringBefore(":")
    return hostPart !in listOf("10.0.2.2", "127.0.0.1", "localhost")
}

private fun isValidServerUrl(url: String): Boolean {
    val sanitized = sanitizeServerUrl(url)
    if (sanitized.isBlank()) return false
    val httpUrl = sanitized.toHttpUrlOrNull() ?: return false
    return httpUrl.host.isNotBlank()
}

@Composable
fun ServerUrlDialog(
    currentUrl: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit
) {
    var text by remember { mutableStateOf(currentUrl) }
    var validationError by remember { mutableStateOf<String?>(null) }
    val isCleartextRisk = remember(text) { isNonLocalCleartext(text) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("配置后端地址", fontSize = 18.sp, fontWeight = FontWeight.Bold) },
        text = {
            Column(modifier = Modifier.imePadding()) {
                Text(
                    text = "支持输入域名（自动补 https://）或完整地址；末尾斜杠会自动剔除。",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = text,
                    onValueChange = {
                        text = it
                        validationError = null
                    },
                    singleLine = true,
                    label = { Text("后端 Base URL / 域名") },
                    isError = validationError != null,
                    supportingText = {
                        if (validationError != null) {
                            Text(
                                text = validationError ?: "",
                                color = MaterialTheme.colorScheme.error,
                                fontSize = 11.sp
                            )
                        } else if (isCleartextRisk) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.LockOpen,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.error,
                                    modifier = Modifier.size(13.dp)
                                )
                                Text(
                                    text = "非加密传输",
                                    color = MaterialTheme.colorScheme.error,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }
                    },
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val sanitized = sanitizeServerUrl(text)
                    if (isValidServerUrl(sanitized)) {
                        onConfirm(sanitized)
                    } else {
                        validationError = "请输入有效的域名或服务器地址"
                    }
                },
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("保存")
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = onDismiss,
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("取消")
            }
        }
    )
}

@OptIn(ExperimentalComposeUiApi::class)
private fun Modifier.autofill(
    autofillTypes: List<AutofillType>,
    onFill: (String) -> Unit
): Modifier = composed {
    val autofill = LocalAutofill.current
    val autofillTree = LocalAutofillTree.current
    val autofillNode = remember {
        AutofillNode(
            autofillTypes = autofillTypes,
            onFill = onFill
        )
    }
    LaunchedEffect(autofillNode) {
        autofillTree += autofillNode
    }
    this
        .onGloballyPositioned {
            autofillNode.boundingBox = it.boundsInWindow()
        }
        .onFocusChanged { focusState ->
            if (focusState.isFocused) {
                autofill?.requestAutofillForNode(autofillNode)
            } else {
                autofill?.cancelAutofillForNode(autofillNode)
            }
        }
}
