# OIBoard 本地代码统计守护服务 (macOS Agent)

极致轻量、高性能、低资源占用的本地代码监控服务，采用 Go 1.24 原生编写，编译后为单个独立静态二进制文件（零外部依赖，空闲内存仅 ~8MB，CPU 0%）。

---

## 核心特性

- **极致轻量 & 零依赖**: 单二进制文件（约 6MB），内置嵌入式 Web 资源（HTML/CSS/JS），无需安装 Node.js、Python 或任何环境。
- **高性能增量扫描**:
  - 借鉴 `scc` 与 `ripgrep` 的 SIMD 级字节分块行数统计（32KB 内存缓冲区与 `bytes.Count`），扫描数十万行代码耗时仅数毫秒。
  - 状态缓存索引（记录文件大小与纳秒级修改时间 `mtime`），初次扫描全量索引，后续仅对修改/新增文件进行增量计数。
- **专属语言支持**: 自动识别统计 `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.java` 源码文件。
- **今日与累计统计**: 智能记录当日（本地时间 00:00 至今）修改过的代码行数以及全部累计行数。
- **本地后台管理界面**: 内置运行于 `http://127.0.0.1:2054`，提供文件夹导入、排除管理、手动扫描、测试连接与实时数据查看。
- **自动同步到 OIBoard**: 定时或在扫描到变更时将统计数据静默同步到远程 OIBoard 服务器，并在数据看板首页以 Bento 卡片展示。

---

## 快速使用

### 1. 编译
在 `agent/` 目录下执行构建脚本：
```bash
cd agent
./build.sh
```

### 2. 启动服务
```bash
# 直接运行（默认管理后台为 http://127.0.0.1:2054）
./oiboard-agent

# 或者后台静默运行
nohup ./oiboard-agent > /dev/null 2>&1 &
```

### 3. 配置与导入文件夹
1. 打开浏览器访问 `http://127.0.0.1:2054`。
2. 在「服务与同步设置」中填入：
   - **OIBoard 服务器地址**: 如 `http://198.44.63.140:2053`
   - **同步 Token**: 在 OIBoard 网页端「系统设置」卡片点击「复制 Token」后粘贴至此（或点击「快捷登录获取」直接通过账号密码获取）。
3. 在「代码文件夹监控」中填入本地项目的绝对路径（如 `/Users/yourname/Documents/Code`）并添加。
4. 点击「立即扫描」即可完成首次代码统计并自动同步至服务器。

---

## 开机自启守护进程 (macOS launchd)

如需在 Mac 开机或登录时自动在后台静默运行：
```bash
# 复制 plist 模板至用户 LaunchAgents 目录
mkdir -p ~/Library/LaunchAgents
sed "s|__BINARY_PATH__|$(pwd)/oiboard-agent|g" com.oiboard.agent.plist > ~/Library/LaunchAgents/com.oiboard.agent.plist

# 启动服务
launchctl load ~/Library/LaunchAgents/com.oiboard.agent.plist

# 如需停止或卸载
launchctl unload ~/Library/LaunchAgents/com.oiboard.agent.plist
```
日志将自动输出至 `/tmp/oiboard-agent.log`。
