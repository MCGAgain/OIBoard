#!/bin/bash
# 双击启动 OIBoard Agent Web 管理后台
cd "$(dirname "$0")"

if lsof -i :2054 >/dev/null 2>&1; then
    echo "Web 管理后台已在运行 (http://127.0.0.1:2054)"
else
    echo "正在启动 OIBoard Agent 管理后台..."
    pkill -f "oiboard-agent" 2>/dev/null
    nohup ./oiboard-agent > /tmp/oiboard-agent.log 2>&1 &
    sleep 1
fi

open "http://127.0.0.1:2054"
osascript -e 'tell application "Terminal" to close (every window whose name contains "start.command")' 2>/dev/null &
exit 0
