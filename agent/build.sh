#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo "  构建 OIBoard macOS Agent (极致轻量原生二进制)"
echo "=========================================="

# 编译参数：去除符号表和调试信息 (-s -w)，将体积缩至极小
OUTPUT_BIN="oiboard-agent"
CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o "$OUTPUT_BIN" main.go

FILESIZE=$(ls -lh "$OUTPUT_BIN" | awk '{print $5}')
echo "构建成功: $DIR/$OUTPUT_BIN (体积仅 $FILESIZE)"
echo ""
echo "常用启动命令:"
echo "  1. 直接运行 (默认管理端口 2054):"
echo "     ./$OUTPUT_BIN"
echo ""
echo "  2. 指定端口与数据存储目录:"
echo "     ./$OUTPUT_BIN -port 2054 -data ~/.oiboard-agent"
echo ""
echo "  3. 立即单次扫描并退出:"
echo "     ./$OUTPUT_BIN -scan-now"
echo ""
echo "  4. 安装为 macOS 开机后台守护进程 (LaunchAgent):"
echo "     mkdir -p ~/Library/LaunchAgents"
echo "     sed \"s|__BINARY_PATH__|$DIR/$OUTPUT_BIN|g\" com.oiboard.agent.plist > ~/Library/LaunchAgents/com.oiboard.agent.plist"
echo "     launchctl unload ~/Library/LaunchAgents/com.oiboard.agent.plist 2>/dev/null || true"
echo "     launchctl load ~/Library/LaunchAgents/com.oiboard.agent.plist"
echo "=========================================="
