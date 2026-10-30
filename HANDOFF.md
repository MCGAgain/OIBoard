# OIBoard 移动端（Android）项目交接与验证记录 (HANDOFF.md)

本文档记录 OIBoard 移动端原生 Android（Jetpack Compose）的五项关键修复与增强功能的实现细节、技术验证结论及操作指南。

---

## 一、五项功能实现与验证记录

### 1. 禁止横屏（锁定竖屏）
- **实现方式**：
  在 `AndroidManifest.xml` 的 `MainActivity` 节点中显式配置 `android:screenOrientation="portrait"`，并在 `configChanges` 中补充 `orientation|screenSize|screenLayout` 避免生命周期异常重建。
- **真机验证**：
  使用 `adb -s <device-serial> shell dumpsys window` 读取显示方向，确认无论物理旋转或系统方向改变，窗口始终保持 `mDisplayRotation=ROTATION_0` 与 `orientation=1 (PORTRAIT)`。

### 2. 错题笔记与代码：全屏详情页与弹窗审查
- **滑动受阻根因**：
  原错题详情弹窗使用 Material 3 `AlertDialog`，其内部 `text` 槽位放置的 `Column` 未挂载 `.verticalScroll(rememberScrollState())`，且 `AlertDialog` 底层未提供滚动视口，导致内容超出一屏时被底层硬裁切，无法响应垂直滑动手势。
- **全屏详情页实现**：
  - 新建 `MistakeDetailScreen.kt`，整页由单个统一的 `LazyColumn` 承载，不存在多层垂直滚动嵌套或固定高度容器。
  - 转场动效：在 `MainScreen.kt` 中使用 `AnimatedVisibility`，采用右侧水平滑入转场（`slideInHorizontally(tween(180ms)) + fadeIn(180ms)`，小于 200ms 要求）。
  - 支持系统返回手势（预测性返回手势）、物理返回键与左上角导航返回图标退出。
  - 错题页卡片与提交页“已入错题 · 笔记”完全共用同一个 `MistakeDetailScreen` 实例与导航通道。
- **全量弹窗审查与键盘防遮挡清单**：
  1. `MistakeDetailDialog`：已彻底废弃并移除，重构为全屏页。
  2. `MistakeFormDialog`（录入/编辑错题）：内容超过一屏，已增加 `.verticalScroll(rememberScrollState()).imePadding()`。
  3. `AccountFormDialog`（平台账号绑定）：包含多字段与凭据输入，已增加 `.verticalScroll(rememberScrollState()).imePadding()`。
  4. `ChangePasswordDialog`（修改密码）：已增加 `.verticalScroll(rememberScrollState()).imePadding()`。
  5. `CustomDateDialog`（自定义提交筛选日期）：已配置 `.imePadding()`。
  6. `ServerUrlDialog`（服务器地址配置）：已配置 `.imePadding()`。
  7. 退出登录二次确认、删除平台账号等简短确认弹窗：保留标准轻量 `AlertDialog`。

### 3. 轻量原生 Compose Markdown 渲染器
- **实现架构**：
  新建 `MarkdownRenderer.kt`，不使用 WebView，不引入第三方庞大 Markdown 库。
- **特性支持**：
  - 标题（`#` 至 `###`）、粗体、斜体、删除线、行内代码、引用块（`>`）、有序/无序列表、水平分割线、外部安全超链接（仅限 `http://` / `https://`，调用系统外部浏览器打开）。
  - **代码块（```）**：采用等宽字体（`FontFamily.Monospace`），块内水平滚动（`Modifier.horizontalScroll(rememberScrollState())`，不换行强制截断），右上角提供一键复制代码图标按钮。
  - **长代码行级切片与保护**：长代码按行切分放入 `LazyColumn` 懒渲染；超过单块内存保护上限自动安全截断并渲染黄色提示条（`已截断超长代码`）。
  - **色彩与语法渲染**：预计算分词着色（C++/Python 基础关键字、注释、字符串常量），参考 Atom One Dark 配色方案，浅色与深色主题分别优化背景色与边框对比度，在重组与绘制阶段不分配临时对象。

### 4. 登录状态长效保持（Token 安全持久化）
- **后端 Token 机制审计结论**：
  - 源码位置：`auth.py` 与 `db.py` 中的 `create_session(user_id, days=7)`。
  - Token 生成方式：`secrets.token_hex(32)`。
  - 有效期：数据库 `sessions` 表记录 `expires_at = datetime.now() + timedelta(days=7)`，**实际有效期严格为 7 天（小于 30 天）**。
  - 续期策略：后端**无滑动续期机制**。
  - 过期响应：7 天后请求携带该 Token 时，拦截器返回 HTTP 401 `{"detail": "登录会话已过期，请重新登录"}`。主动注销时后端硬删除 session 记录。
- **移动端解决方案**：
  - 硬件安全存储：新建 `CryptoManager.kt`，利用硬件支持的 Android KeyStore 生成不可导出的 `AES-256-GCM` 密钥（KeyStore alias `"oiboard_pref_key"`，带 12 字节安全 IV 与 128 位认证标签 Tag），将 Token 加密后存储在 Jetpack DataStore 中；解密异常或密钥失效时自动优雅回退为未登录，绝不发生崩溃。
  - 冷启动保护：通过 `getOrRestoreToken()` 异步挂起等待 DataStore 首次落盘读取，彻底根除因 Flow 初始空值导致的误退登。
  - 过期降级体验：由于后端登录必须验证验证码图片，无法完全静默后台续期；当 7 天 Token 过期被拦截器捕获 401 时，客户端跳转至登录页，此时已通过硬件加密保存并自动预填用户名与密码，用户仅需输入 4 位验证码即可一键秒登。

### 5. 记住密码与凭据管理
- **系统自动填充（Autofill）**：
  为用户名与密码输入框挂载 Compose 原生 Autofill 语义（`AutofillType.Username` 与 `AutofillType.Password`），系统密码管理器（Google 凭据提供程序、第三方密码管理器）可原生识别并提供自动填充与密码保存气泡。
- **本地安全加密保存**：
  登录页提供“记住密码”开关（默认开启）。开启状态下登录成功，自动使用 KeyStore AES-256-GCM 安全加密保存凭据；下次进入登录页自动解密预填。若关闭该开关，立即彻底抹除已保存的密码。
- **内存安全**：
  密码仅在认证流程与输入框渲染中流转，日志系统全面脱敏拦截密码，认证完成后在 ViewModel 状态中立即置空明文密码。
- **退出登录双重选择**：
  点击设置中的“退出登录”，弹出二次确认对话框：
  1. “保留密码并退出”（默认推荐）：清空 Token 会话，保留加密凭据；下次登录自动预填，仅需验证码。
  2. “清除密码并退出”：同时注销服务端会话并彻底清空本地加密密码。
- **设置页清除入口**：
  在“设置 -> 安全设置”中提供“清除已保存的密码”入口，点击可随时独立抹除本地保存的凭据。
- **备份规则验证**：
  `AndroidManifest.xml` 中配置 `android:allowBackup="false"`，且 `res/xml/backup_rules.xml` 与 `data_extraction_rules.xml` 均已排除 `root`、`sharedpref`、`database` 及 `datastore` 目录，防止云端备份或设备迁移泄露加密数据。

---

## 二、项目纯净度核查

1. **版本控制检查**：
   执行 `git status --ignored`，原项目根目录除独立新增的 `mobile-android/` 工程外，原有所有 Python 后端文件、前端静态资源、测试用例均保持 100% 原始状态，零修改。
2. **生产数据库完整性**：
   执行 `shasum -a 256 data/oiboard.db`，散列校验码为：
   `6610b4df16e20427217faab8dc82737cf45e2f77ae8141e00b3821b558b9b18b`
   与基准值严格一致，未发生任何非预期的写入或变更。
