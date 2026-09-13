# OIBoard

<div align="center">

![OIBoard Favicon](static/favicon.svg)

**算法刷题与比赛数据看板**

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg)](https://fastapi.tiangolo.com/)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57.svg)](https://www.sqlite.org/)
[![Vue 3](https://img.shields.io/badge/Vue.js-3.x-4FC08D.svg)](https://vuejs.org/)
[![ECharts 5](https://img.shields.io/badge/ECharts-5.5-AA344D.svg)](https://echarts.apache.org/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-3.x-38B2AC.svg)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 系统架构

```mermaid
flowchart TB
    subgraph Frontend [前端界面 (Vue 3 + ECharts + Tailwind)]
        UI[数据看板]
        Nav[侧边栏导航]
        HMap[年度贡献热力图]
        Charts[算法标签画像 & 平台占比]
        Stream[全量提交流 & 错题集]
        ContestUI[比赛日历 & 实时倒计时]
    end

    subgraph API_Layer [API 业务层 (FastAPI)]
        Auth[用户认证与鉴权]
        Dep[请求拦截器]
        Router[统计 / 比赛 / 设置 / 认证路由]
    end

    subgraph Scheduler_Engine [异步调度与同步引擎]
        Loop[后台自动轮询]
        CF[Codeforces Fetcher]
        AT[AtCoder Fetcher]
        LG[Luogu Fetcher]
        AW[AcWing Fetcher]
        Contests[Contest Fetcher]
    end

    subgraph Storage [持久化存储 (SQLite)]
        Users[(users 用户表)]
        Sessions[(sessions 会话表)]
        Submissions[(submissions 提交记录表)]
        ContestsDB[(contests 比赛表)]
        Configs[(user_configs 配置表)]
        Status[(platform_status 状态表)]
    end

    UI -->|API 请求| Dep
    Dep --> Auth
    Dep --> Router
    Router --> Storage
    Scheduler_Engine -->|数据同步| Storage
    Loop --> CF & AT & LG & AW & Contests
```

---

## 技术栈

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **后端框架** | **FastAPI** (Python 3.10+) | 高性能异步 ASGI 接口框架 |
| **数据存储** | **SQLite 3 (WAL Mode)** | 零配置轻量嵌入式数据库，高并发读写分离与外键完整约束 |
| **安全加密** | **PBKDF2-HMAC-SHA256** | 260,000 次加盐哈希，抗彩虹表攻击与时序攻击 |
| **爬虫/同步** | **HTTPX + BeautifulSoup4** | 异步非阻塞 HTTP 协程请求与 DOM 解析 |
| **前端框架** | **Vue 3 (Composition API)** | 响应式数据绑定与状态管理 |
| **数据可视化** | **Apache ECharts 5.5** | 热力图、横向柱状图、环形分布图 |
| **样式体系** | **Tailwind CSS** | 暗色主题与现代化界面排版 |
| **进程守护** | **Systemd Service** | 开机自启、崩溃重启、日志管理 |

---

## 快速开始

### 1. 本地运行

```bash
# 1. 克隆代码仓库
git clone https://github.com/MCGAgain/OIBoard.git
cd OIBoard

# 2. 创建 Python 虚拟环境并激活
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 3. 安装依赖包
pip install -r requirements.txt

# 4. 启动看板服务 (默认运行在 8888 端口)
python run.py
```

启动后在浏览器打开：`http://127.0.0.1:8888`

---

### 2. 服务器部署 (VPS - 运行在 2053 端口)

#### 一键脚本部署：

```bash
chmod +x deploy.sh
./deploy.sh
```

#### Systemd 服务文件 (`/etc/systemd/system/oiboard.service`)：

```ini
[Unit]
Description=OIBoard Algorithm Dashboard (CF / AtCoder / Luogu / AcWing)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/oiboard
ExecStart=/opt/oiboard/.venv/bin/python /opt/oiboard/run.py 2053
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable oiboard
systemctl start oiboard
```

---

## Nginx 反向代理配置

为实现域名免端口直接访问，可在 Nginx 中添加以下反向代理配置：

```nginx
server {
    listen 80;
    server_name oi.yourdomain.top;

    location / {
        proxy_pass http://127.0.0.1:2053;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 初始管理员与安全说明

- **默认主账户**：
  - **用户名**：`admin`
  - **初始密码**：`admin123`
- **安全建议**：
  首次登录后，请进入系统设置修改密码。系统支持多用户注册，各用户数据相互独立。

---

## 目录结构

```text
OIBoard/
├── auth.py              # 用户认证与密码哈希模块
├── db.py                # SQLite 数据库模型与数据接口
├── main.py              # FastAPI 路由与鉴权中间件
├── scheduler.py         # 异步定时轮询调度引擎
├── run.py               # 服务启动入口
├── deploy.sh            # VPS 一键部署脚本
├── oiboard.service      # Systemd 服务配置文件
├── requirements.txt     # Python 依赖清单
├── fetchers/            # 各 OJ 平台数据同步模块
│   ├── base.py          # 基础抽象类与统一数据结构
│   ├── cf.py            # Codeforces 数据源
│   ├── atcoder.py       # AtCoder 与 Kenkoooo 数据源
│   ├── luogu.py         # 洛谷数据源
│   ├── acwing.py        # AcWing 数据源
│   └── contests.py      # 比赛日历与倒计时抓取
├── static/              # 前端静态资源
│   ├── index.html       # 前端页面模版
│   ├── app.js           # Vue 3 业务逻辑与图表渲染
│   ├── style.css        # 主题样式
│   └── favicon.svg      # 网站图标
└── data/                # SQLite 数据目录 (自动生成)
    └── oiboard.db
```

---

## 开源许可证

本项目采用 [MIT License](LICENSE) 开源协议。
