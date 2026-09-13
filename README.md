# OIBoard

<div align="center">

![OIBoard Favicon](static/favicon.svg)

**跨平台算法训练与数据看板 · 多租户数据隔离 · 3X-UI 极简暗黑设计**

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
        UI[3X-UI 极简看板]
        Nav[左侧悬浮伸缩侧边栏]
        HMap[年度贡献热力图]
        Charts[算法标签画像 & 平台占比]
        Stream[全量提交流 & 错题集]
        ContestUI[跨平台比赛日历 & 实时倒计时]
    end

    subgraph API_Layer [API 鉴权与业务层 (FastAPI)]
        Auth[Auth 模块 (PBKDF2-HMAC-SHA256)]
        Dep[Depends 身份拦截器]
        Router[统计 / 比赛 / 设置 / 认证路由]
    end

    subgraph Scheduler_Engine [异步调度与同步引擎]
        Loop[后台自动轮询 (日常自定义 / 冲刺 5m)]
        CF[Codeforces Fetcher]
        AT[AtCoder Fetcher (Kenkoooo API)]
        LG[Luogu Fetcher (异步分页 / 练习库)]
        AW[AcWing Fetcher (HTML5 解析)]
        Contests[Contest Fetcher (CF / AT / 洛谷赛程)]
    end

    subgraph Storage [持久化存储 (SQLite WAL)]
        Users[(users 用户表)]
        Sessions[(sessions 会话表)]
        Submissions[(submissions 提交记录 - user_id 隔离)]
        ContestsDB[(contests 比赛表)]
        Configs[(user_configs 配置 - user_id 隔离)]
        Status[(platform_status 状态 - user_id 隔离)]
    end

    UI -->|Bearer Token API| Dep
    Dep --> Auth
    Dep --> Router
    Router --> Storage
    Scheduler_Engine -->|异步并发拉取| Storage
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
| **样式体系** | **Tailwind CSS** | 3X-UI 极简暗黑排版，轻量低 GPU 开销 |
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
  首次登录后，请进入系统设置页面的修改密码区域将初始密码修改为自定义强密码。系统支持多用户注册，新注册用户数据完全独立隔离。

---

## 目录结构

```text
OIBoard/
├── auth.py              # PBKDF2 安全密码加盐哈希与会话令牌模块
├── db.py                # SQLite WAL 多租户数据隔离模型与查询接口
├── main.py              # FastAPI 核心路由与 Depends 鉴权拦截器
├── scheduler.py         # 异步定时轮询调度引擎
├── run.py               # 启动入口与端口参数管理
├── deploy.sh            # 一键 VPS 部署与 Systemd 配置脚本
├── oiboard.service      # Systemd 守护进程单元文件
├── requirements.txt     # Python 依赖清单
├── fetchers/            # 各 OJ 平台爬取与同步解析器
│   ├── base.py          # 基础抽象类与统一数据结构
│   ├── cf.py            # Codeforces API 数据源
│   ├── atcoder.py       # AtCoder 官方与 Kenkoooo 数据源
│   ├── luogu.py         # 洛谷 API 与练习题库数据源
│   ├── acwing.py        # AcWing 题库与提交数据源
│   └── contests.py      # 跨平台比赛日历抓取与倒计时
├── static/              # 前端单页面应用资源
│   ├── index.html       # 3X-UI 风格单页应用模版
│   ├── app.js           # Vue 3 响应式业务与 ECharts 渲染逻辑
│   ├── style.css        # 自定义极简暗黑主题样式
│   └── favicon.svg      # 3X-UI 柱状图标
└── data/                # SQLite 数据持久化目录 (自动生成)
    └── oiboard.db
```

---

## 开源许可证

本项目采用 [MIT License](LICENSE) 开源协议。
