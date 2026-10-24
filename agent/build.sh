#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo "  构建 OIBoard macOS Agent (FSEvents 通用二进制)"
echo "=========================================="

if ! xcode-select -p >/dev/null 2>&1; then
    echo "错误: 未检测到 Xcode Command Line Tools，请先执行 xcode-select --install 安装"
    exit 1
fi

OUTPUT_BIN="oiboard-agent"
TMP_ARM64="oiboard-agent-arm64"
TMP_AMD64="oiboard-agent-amd64"

echo "正在编译 arm64 架构..."
CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 CC="clang -arch arm64" go build -ldflags="-s -w" -trimpath -o "$TMP_ARM64" .

echo "正在编译 x86_64 架构..."
CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 CC="clang -arch x86_64" go build -ldflags="-s -w" -trimpath -o "$TMP_AMD64" .

echo "正在合并 Universal 通用二进制 (arm64 + x86_64)..."
lipo -create -output "$OUTPUT_BIN" "$TMP_ARM64" "$TMP_AMD64"
rm -f "$TMP_ARM64" "$TMP_AMD64"

FILESIZE=$(ls -lh "$OUTPUT_BIN" | awk '{print $5}')
echo "构建成功: $DIR/$OUTPUT_BIN (通用架构体积: $FILESIZE)"
lipo -info "$OUTPUT_BIN"
echo ""

if [ -n "$OIBOARD_SIGN_ID" ]; then
    echo "检测到环境变量 OIBOARD_SIGN_ID=\"$OIBOARD_SIGN_ID\"，正在进行稳定证书代码签名..."
    codesign --force --sign "$OIBOARD_SIGN_ID" --identifier com.oiboard.agent "$OUTPUT_BIN"
    codesign -dvv "$OUTPUT_BIN" 2>&1 | grep -E "Identifier|Signature|Authority" || true
else
    echo "提示: 未检测到 OIBOARD_SIGN_ID 环境变量，使用 ad-hoc 默认签名。"
    echo "      说明: ad-hoc 签名的 designated requirement 基于 cdhash，重编译会导致 cdhash 变动，"
    echo "      从而使 macOS TCC 权限判定为新程序并重置授权。"
    echo "      若需长期固定授权，可通过 Keychain 建立本地代码签名证书并设置: export OIBOARD_SIGN_ID=\"<证书名>\""
fi
echo ""
echo "常用启动命令:"
echo "  1. 直接运行 (默认管理端口 2054):"
echo "     ./$OUTPUT_BIN"
echo ""
echo "  2. 安装并加载为 macOS 开机后台守护进程 (LaunchAgent):"
echo "     INSTALL_DIR=\"\$HOME/Library/Application Support/OIBoard\""
echo "     mkdir -p \"\$INSTALL_DIR\" ~/Library/LaunchAgents ~/Library/Logs"
echo "     cp -f \"$DIR/$OUTPUT_BIN\" \"\$INSTALL_DIR/$OUTPUT_BIN\""
echo "     chmod +x \"\$INSTALL_DIR/$OUTPUT_BIN\""
echo "     sed -e \"s|__BINARY_PATH__|\$INSTALL_DIR/$OUTPUT_BIN|g\" -e \"s|__HOME__|\$HOME|g\" com.oiboard.agent.plist > ~/Library/LaunchAgents/com.oiboard.agent.plist"
echo "     launchctl bootout gui/\$(id -u)/com.oiboard.agent 2>/dev/null || true"
echo "     launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.oiboard.agent.plist"
echo "=========================================="
