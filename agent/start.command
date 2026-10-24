#!/bin/bash
# 双击启动 OIBoard Agent Web 管理后台 (带 launchd 自动保活)
cd "$(dirname "$0")"
DIR="$(pwd)"

INSTALL_DIR="$HOME/Library/Application Support/OIBoard"
PLIST_PATH="$HOME/Library/LaunchAgents/com.oiboard.agent.plist"
mkdir -p "$INSTALL_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

# 将二进制安装至安全的 Application Support 目录，避免 Documents 目录受 macOS TCC 权限拦截
cp -f "$DIR/oiboard-agent" "$INSTALL_DIR/oiboard-agent"
chmod +x "$INSTALL_DIR/oiboard-agent"

# 生成/更新 LaunchAgent 配置文件
sed -e "s|__BINARY_PATH__|$INSTALL_DIR/oiboard-agent|g" -e "s|__HOME__|$HOME|g" com.oiboard.agent.plist > "$PLIST_PATH"

UID_NUM=$(id -u)
if lsof -nP -iTCP:2054 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "OIBoard Agent 正在运行中 (http://127.0.0.1:2054)"
else
    echo "正在启动 OIBoard Agent 并注册后台保活守护服务..."
    pkill -f "oiboard-agent" 2>/dev/null || true
    launchctl bootout "gui/$UID_NUM/com.oiboard.agent" 2>/dev/null || true
    launchctl bootstrap "gui/$UID_NUM" "$PLIST_PATH"
    for i in {1..10}; do
        if lsof -nP -iTCP:2054 -sTCP:LISTEN >/dev/null 2>&1; then
            break
        fi
        sleep 0.5
    done
fi

open "http://127.0.0.1:2054"
osascript -e 'tell application "Terminal" to close (every window whose name contains "start.command")' 2>/dev/null &
exit 0
