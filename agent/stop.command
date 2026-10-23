#!/bin/bash
# 双击停止 OIBoard Agent (释放端口与后台进程)
cd "$(dirname "$0")"

pkill -f "oiboard-agent" 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.oiboard.agent.plist 2>/dev/null || true

echo "OIBoard Agent 服务已停止，端口已释放。"
sleep 1
osascript -e 'tell application "Terminal" to close (every window whose name contains "stop.command")' 2>/dev/null &
exit 0
