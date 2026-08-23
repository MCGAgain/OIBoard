# 🚀 OIBoard (OI 算法刷题聚合看板)

<div align="center">

![OIBoard Favicon](static/favicon.svg)

**跨平台算法训练与数据看板 · 多租户数据隔离 · 3X-UI 极简暗黑科技美学**

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688.svg)](https://fastapi.tiangolo.com/)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57.svg)](https://www.sqlite.org/)
[![Vue 3](https://img.shields.io/badge/Vue.js-3.x-4FC08D.svg)](https://vuejs.org/)
[![ECharts 5](https://img.shields.io/badge/ECharts-5.5-AA344D.svg)](https://echarts.apache.org/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-3.x-38B2AC.svg)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 🌟 项目亮点 (Highlights)

OIBoard 是专为算法竞赛选手（OI / ACM / 考研机试 / LeetCode 进阶）打造的**跨平台刷题聚合与能力分析看板**。告别在多个 OJ 平台反复切换与手动统计的繁琐，实现全平台做题数据的自动流转与直观可视化。

- 🏢 **三大主流平台无缝聚合**：支持 **Codeforces**、**洛谷 (Luogu)**、**AcWing** 的做题记录自动拉取与状态同步。
- 📊 **全量数据流与多维筛选**：支持 2000+ 提交记录全量检索，提供日期区间（今天 / 7天 / 30天 / 今年 / 自定义）、平台、AC/WA 状态、算法标签、搜索关键词与分页控制。
- 🟩 **GitHub 风格年度贡献热力图**：全年度 365 天刷题足迹分段式离散方块展示，每日提交量阶梯式高亮，连续打卡（Streak）天数实时统计。
- 🏷️ **经典算法掌握度画像**：内置动态算法分类器，精准识别 动态规划 (DP)、图论、搜索 (DFS/BFS)、贪心、数论数学、数据结构、基础算法 等多维知识图谱。
- ⚠️ **待攻克错题本 (Mistake Book)**：智能汇聚历史曾有 WA/TLE/MLE 且至今尚未 AC 的题目清单，标记失败次数与最近尝试时间，助力精准查漏补缺。
- 🔒 **多租户安全数据隔离体系**：
  - 密码采用标准 **PBKDF2-HMAC-SHA256**（260,000 次高强度迭代 + 32 字节 CSPRNG 独立随机 Salt）；
  - 256 位高熵 Session 令牌，接口统一接入 `FastAPI Depends` 身份鉴权拦截；
  - 各注册用户拥有独立的账号配置、做题记录与热力图，用户之间数据 100% 物理隔离。
- ⚡ **超轻量资源占用**：原生无重型依赖，常驻内存仅 **38MB**，完美契合 1核1G 内存的海外廉价 VPS。
- 🎨 **3X-UI 黑曜石科技美学**：左侧悬浮伸缩侧边栏、全屏独立配置中心、暗夜黑底色与青色呼吸灯状态设计。

---

## 🏗️ 系统架构 (Architecture)

```mermaid
flowchart TB
    subgraph Frontend [前端界面 (Vue 3 + ECharts + Tailwind)]
        UI[3X-UI 科技黑曜石看板]
        Nav[左侧悬浮伸缩侧边栏]
        HMap[年度贡献热力图]
        Charts[算法标签画像 & 平台占比]
        Stream[全量提交流 & 错题集]
    end

    subgraph API_Layer [API 鉴权与业务层 (FastAPI)]
        Auth[Auth 模块 (PBKDF2-HMAC-SHA256)]
        Dep[Depends 身份拦截器]
        Router[统计 & 设置 & 认证路由]
    end

    subgraph Scheduler_Engine [异步调度与同步引擎]
        Loop[后台自动轮询 (日常 30m / 冲刺 5m)]
        CF[Codeforces Fetcher]
        LG[Luogu Fetcher (CSRF/Cookie/分类器)]
        AW[AcWing Fetcher (HTML5 解析)]
    end

    subgraph Storage [持久化存储 (SQLite WAL)]
        Users[(users 用户表)]
        Sessions[(sessions 会话表)]
        Submissions[(submissions 提交记录 - user_id 隔离)]
        Configs[(user_configs 配置 - user_id 隔离)]
        Status[(platform_status 状态 - user_id 隔离)]
    end

    UI -->|Bearer Token API| Dep
    Dep --> Auth
    Dep --> Router
    Router --> Storage
    Scheduler_Engine -->|异步并发拉取| Storage
    Loop --> CF & LG & AW
```

---

## 🛠️ 技术栈 (Tech Stack)

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **后端框架** | **FastAPI** (Python 3.10+) | 高性能异步 ASGI 接口框架 |
| **数据存储** | **SQLite 3 (WAL Mode)** | 零配置轻量嵌入式数据库，外键完整约束 |
| **安全加密** | **PBKDF2-HMAC-SHA256** | 260,000 次加盐哈希，抗彩虹表攻击与时序攻击 |
| **爬虫/同步** | **HTTPX + BeautifulSoup4** | 异步非阻塞 HTTP 请求与 DOM 解析 |
| **前端框架** | **Vue 3 (Composition API)** | 响应式数据绑定与状态管理 |
| **数据可视化** | **Apache ECharts 5.5** | 热力图、横向柱状图、环形分布图 |
| **样式体系** | **Tailwind CSS + Glassmorphism** | 3X-UI 暗黑毛玻璃科技风排版 |
| **进程守护** | **Systemd Service** | 开机自启、崩溃重启、日志管理 |

---

## 🚀 快速开始 (Quick Start)

### 1. 本地运行 (Local Development)

```bash
# 1. 克隆代码仓库
git clone https://github.com/your-username/OIBoard.git
cd OIBoard

# 2. 创建 Python 虚拟环境并激活
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 3. 安装依赖包
pip install -r requirements.txt

# 4. 启动看板服务 (默认运行在 8888 端口)
python run.py
```

启动后在浏览器打开：👉 **`http://127.0.0.1:8888`**

---

### 2. 服务器部署 (VPS Deployment - 运行在 2053 端口)

#### 一键脚本部署：

```bash
# 进入项目目录执行部署脚本
chmod +x deploy.sh
./deploy.sh
```

#### Systemd 服务文件 (`/etc/systemd/system/oiboard.service`)：

```ini
[Unit]
Description=OIBoard Algorithm Dashboard (CF / Luogu / AcWing)
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

## 🌐 Nginx 反向代理配置 (支持 Cloudflare 免端口访问)

为实现纯域名（如 `http://oi.yourdomain.top`）免端口直接访问，可在 Nginx 中添加以下反向代理配置：

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

## 🔒 初始管理员与安全说明

- **默认主账户**：
  - **用户名**：`admin`
  - **初始密码**：`admin123`
- **安全建议**：
  首次登录后，请立即进入 **`CONFIG 设置`** 页面底部的 **`ACCOUNT PASSWORD SECURITY`** 区域将初始密码修改为自定义强密码。系统支持多用户注册，新注册用户数据完全独立隔离。

---

## 📁 目录结构 (Directory Structure)

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
│   ├── base.py
│   ├── codeforces.py
│   ├── luogu.py
│   └── acwing.py
├── static/              # 前端单页面应用资源
│   ├── index.html       # 3X-UI 风格单页应用模版
│   ├── app.js           # Vue 3 响应式业务与 ECharts 渲染逻辑
│   ├── style.css        # 自定义动画、毛玻璃与暗黑主题样式
│   └── favicon.svg      # 3X-UI 青色柱状图标
└── data/                # SQLite 数据持久化目录 (自动生成)
    └── oiboard.db
```

---

## 📄 开源许可证 (License)

本项目采用 [MIT License](LICENSE) 开源协议。欢迎提交 PR 与 Issue！
