#!/bin/bash
set -e

echo "=========================================="
echo "🚀 开始在 VPS 部署 OIBoard (运行在 2053 端口)"
echo "=========================================="

mkdir -p /opt/oiboard
cd /opt/oiboard

# 1. 检查 Python3 与 venv
if ! command -v python3 &> /dev/null; then
    echo "正在安装 Python3..."
    if command -v apt-get &> /dev/null; then
        apt-get update -y && apt-get install -y python3 python3-venv python3-pip
    elif command -v yum &> /dev/null; then
        yum install -y python3 python3-pip
    fi
fi

# 2. 创建虚拟环境
if [ ! -d ".venv" ]; then
    echo "创建 Python 独立虚拟环境..."
    python3 -m venv .venv || python3 -m venv --without-pip .venv
fi

# 3. 安装依赖 (极轻量)
echo "安装运行依赖包 (FastAPI, Uvicorn, HTTPX, BeautifulSoup4)..."
.venv/bin/pip install --upgrade pip -i https://pypi.tuna.tsinghua.edu.cn/simple --extra-index-url https://pypi.org/simple
.venv/bin/pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple --extra-index-url https://pypi.org/simple

# 4. 配置 Systemd 自启动服务
echo "配置系统服务开机自启守护进程..."
cp oiboard.service /etc/systemd/system/oiboard.service
systemctl daemon-reload
systemctl enable oiboard
systemctl restart oiboard

echo "=========================================="
echo "✅ OIBoard 部署成功！"
echo "► 运行端口: 2053"
echo "► 公网访问: http://198.44.63.140:2053"
echo "=========================================="
systemctl status oiboard --no-pager
