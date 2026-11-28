# OIBoard 移动端 (Android 原生客户端)

OIBoard 移动端是专为算法竞赛选手打造的高性能跨平台看板应用，基于现代 Android 原生技术栈（Kotlin 2.0 + Jetpack Compose + Material 3）构建，连接 OIBoard 后端服务器，提供数据总览、近期赛事日历、跨平台提交流、错题本复习管理及多平台账号绑定等核心功能。

---

## 1. 环境要求与构建指南

### 运行与构建环境
- **JDK**：OpenJDK 17
- **Android SDK**：API 35 (Android 15), 最低兼容 API 26 (Android 8.0)
- **Gradle**：8.7 (配合 Gradle Wrapper `./gradlew`)

### 构建命令
在 `mobile-android/` 目录下执行：

```bash
# 1. 构建 Debug 测试包（带 LeakCanary 与 StrictMode 调试监控）
./gradlew assembleDebug

# 2. 构建最终生产 Release 包（R8 全量混淆 + 资源缩减 + Baseline Profile）
./gradlew assembleRelease

# 3. 运行静态代码检查 Lint
./gradlew lint

# 4. 构建完成后停止后台守护进程
./gradlew --stop
```

产物路径：
- Debug APK: `mobile-android/app/build/outputs/apk/debug/app-debug.apk`
- Release APK: `mobile-android/app/build/outputs/apk/release/app-release.apk`
- 分发归档: `mobile-android/dist/OIBoard-release.apk`

---

## 2. 安装与部署

使用 ADB 工具直接安装至连接的真机或模拟器：

```bash
# 覆盖安装 Release 包（保留当前登录状态与本地缓存配置）
adb install -r mobile-android/dist/OIBoard-release.apk

# 若从头全新安装
adb install mobile-android/dist/OIBoard-release.apk
```

---

## 3. 服务器地址配置

1. **首次启动配置**：首次打开应用时，系统会弹出“配置服务器地址”弹窗，用户可输入部署的 OIBoard 后端地址（例如 `https://your-server-domain`，模拟器默认预填 `http://10.0.2.2:8888`）。
2. **日常修改地址**：进入应用底部「设置」页面，点击顶部的「服务连接状态」卡片，即可随时编辑服务器 Base URL 并即时保存生效。切换服务器地址时系统将自动清空原有服务器相关的本地离线缓存。

---

## 4. Debug 与 Release 构建差异

| 特性对比 | Debug 构建 (`assembleDebug`) | Release 构建 (`assembleRelease`) |
| :--- | :--- | :--- |
| **代码优化 (R8)** | 关闭（保留完整行号与未优化字节码） | **开启全量 R8 压缩、内联与无用代码剔除** |
| **资源压缩** | 关闭 | **开启 (isShrinkResources = true)** |
| **安装包体积** | 约 **19 MB** | **约 1.7 MB (体积骤降 91%)** |
| **冷启动耗时 (中位数)** | 约 188 ms | **约 139 ms (提速 26%)** |
| **热启动耗时 (中位数)** | 约 68 ms | **约 50 ms (提速 26%)** |
| **内存与泄漏监控** | 内嵌 LeakCanary 自动检测、开启 StrictMode | **彻底剔除 LeakCanary，关闭调试日志输出** |
| **网络明文策略** | 仅放行 `10.0.2.2` 本机模拟器调试明文 | **全局完全禁用明文 HTTP，强制要求 HTTPS** |

---

## 5. 鉴权机制与安全说明

1. **Token 鉴权生命周期**：
   - 登录/注册成功后，服务端下发 43 位安全随机 Token，移动端将其保存在 Jetpack DataStore 中；
   - 所有数据请求均通过 HTTP `Authorization: Bearer <token>` 头部传递；
   - **有效期机制**：服务端 Session 具备 **7 天有效期**。若超过 7 天未操作或服务端注销该会话，网络层拦截器将统一捕获 `401 Unauthorized` 响应，自动清空本地会话并平滑返回登录页，提示用户重新登录。
2. **凭据安全防护**：
   - 应用私有存储绝不以明文形式落盘密码；
   - “记住密码”采用 Android Keystore 硬件级 AES-GCM 动态加密存储；
   - 页面与网络请求日志全面经过脱敏过滤器，日志输出杜绝包含任何 Token、Cookie、明文密码及服务器地址。
