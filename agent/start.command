#!/bin/bash
# 双击启动 OIBoard Agent 并自动打开 Web 管理后台
cd "$(dirname "$0")"

# 优先使用 launchd 托管，若未配置则用 nohup 兜底
if [ -f ~/Library/LaunchAgents/com.oiboard.agent.plist ]; then
    launchctl unload ~/Library/LaunchAgents/com.oiboard.agent.plist 2>/dev/null
    launchctl load -w ~/Library/LaunchAgents/com.oiboard.agent.plist
else
    pkill -f "oiboard-agent" 2>/dev/null
    nohup ./oiboard-agent > /tmp/oiboard-agent.log 2>&1 &
fi

sleep 1
echo "=============================================="
echo "  OIBoard Agent 已在后台静默运行！"
echo "  无需保持此控制台窗口打开，现在为您打开后台管理界面..."
echo "=============================================="

# 打开默认浏览器访问 Web 管理页面
open "http://127.0.0.1:2054"

# 自动关闭当前弹出的终端窗口
osascript -e 'tell application "Terminal" to close (every window whose name contains "start.command")' 2>/dev/null &
exit 0
