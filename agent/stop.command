#!/bin/bash
# 双击停止 OIBoard Agent 后台服务
cd "$(dirname "$0")"

if [ -f ~/Library/LaunchAgents/com.oiboard.agent.plist ]; then
    launchctl unload ~/Library/LaunchAgents/com.oiboard.agent.plist 2>/dev/null
fi
pkill -f "oiboard-agent" 2>/dev/null

echo "=============================================="
echo "  OIBoard Agent 后台服务已停止。"
echo "=============================================="
sleep 1

# 自动关闭当前弹出的终端窗口
osascript -e 'tell application "Terminal" to close (every window whose name contains "stop.command")' 2>/dev/null &
exit 0
