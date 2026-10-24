#!/bin/bash
# 双击停止 OIBoard Agent (卸载 launchd 保活守护进程并释放端口)
cd "$(dirname "$0")"

UID_NUM=$(id -u)
PLIST_PATH="$HOME/Library/LaunchAgents/com.oiboard.agent.plist"

# 从 launchd 卸载服务，防止 KeepAlive 自动拉起
launchctl bootout "gui/$UID_NUM/com.oiboard.agent" 2>/dev/null || true
launchctl bootout "gui/$UID_NUM" "$PLIST_PATH" 2>/dev/null || true
launchctl unload "$PLIST_PATH" 2>/dev/null || true

# 确保无残留手动进程
pkill -f "oiboard-agent" 2>/dev/null || true

echo "OIBoard Agent 服务已安全停止，后台守护已解除，端口已释放。"
sleep 1
osascript -e 'tell application "Terminal" to close (every window whose name contains "stop.command")' 2>/dev/null &
exit 0
