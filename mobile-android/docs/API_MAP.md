# OIBoard 后端 API 接口全量交叉映射文档 (API_MAP)

本文档由后端实现代码 (`main.py`, `backend-spec/api_router.py`, `db.py`) 与前端实际调用代码 (`static/app.js`) 严格交叉核对生成。
**原则**：遵循只读原则，移动端直接复用现有接口，不修改、不新增后端。

---

## 1. 鉴权体系与通信规范

### 1.1 鉴权方式
- **认证机制**：基于 Bearer Token 的无状态 HTTP 头鉴权。
- **请求头格式**：
  ```http
  Authorization: Bearer <token>
  ```
- **Token 产生**：通过 `POST /api/auth/login` 或 `POST /api/auth/register` 获取，Token 长度为 43 位 URL-safe 随机字符串。
- **后端持久化**：存储在 SQLite 的 `sessions` 表中 (`token`, `user_id`, `created_at`, `expires_at`)，有效期默认为 30 天。
- **过期与拦截**：
  - 若未携带 Header 或 Token 在数据库中不存在/已过期，统一返回 HTTP 401：
    ```json
    { "detail": "未授权，请先登录" } 或 { "detail": "登录会话已过期，请重新登录" }
    ```
  - 移动端应全局拦截 HTTP 401 响应，清空本地存储的 Token 并平滑跳转至登录界面。
- **密码哈希算法**：PBKDF2-HMAC-SHA256（260,000 次加盐迭代），密码防撞库与彩虹表攻击。

### 1.2 通信特征
- **实时通信方式**：无 WebSocket、无 Server-Sent Events (SSE)。
- **数据更新模式**：纯 HTTP RESTful 请求 + 前端按需轮询 / 手动触发。
  - 前端轮询频率：常规状态 20~30 秒低频刷新 `/api/auth/me` 与 `/api/stats/overview`；离开页面或退到后台时停止。
- **长时任务超时**：比赛抓取及全量 OJ 抓取由后端异步调度，前端对于 `POST /api/contests/sync` 和 `POST /api/sync` 设置了 120 秒超时。
- **文件上传与下载**：无文件上传和下载接口；图形验证码以 Base64 Data URL 字符串直接内联返回。
- **缓存防抖控制**：
  - 后端中间件为所有 `/api/` 路由强制附加 `Cache-Control: no-cache, no-store, must-revalidate`。
  - 前端发起 GET 请求时附加时间戳参数 `_t=<timestamp>` 防浏览器缓存。

---

## 2. 接口详细清单 (按模块划分)

### 2.1 认证模块 (Auth)

#### 2.1.1 获取图形验证码
- **路径**：`GET /api/auth/captcha`
- **使用状态**：【前端使用中】
- **鉴权**：无（公开）
- **请求参数**：`t` (Query, 可选, 毫秒时间戳防止缓存)
- **响应格式 (200 OK)**：
  ```json
  {
    "captcha_id": "7bf3b3a3d2404e...",
    "captcha_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI..."
  }
  ```
- **说明**：验证码有效时间为 5 分钟，字符长度 4 位大写字母与数字组合（排除 0, O, 1, I, l 等易混淆字符）。

#### 2.1.2 用户注册
- **路径**：`POST /api/auth/register`
- **使用状态**：【前端使用中】
- **鉴权**：无
- **请求体**：
  ```json
  {
    "username": "string (3-32位)",
    "password": "string (>=6位)",
    "captcha_id": "string",
    "captcha_code": "string (4位)"
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "message": "注册成功",
    "token": "43位随机Bearer字符串",
    "user": {
      "id": 1,
      "username": "admin",
      "is_admin": 1,
      "created_at": "2026-08-23 06:17:54"
    }
  }
  ```
- **错误格式 (400 Bad Request)**：
  ```json
  { "detail": "验证码不正确或已过期" }
  { "detail": "用户名已存在" }
  ```

#### 2.1.3 用户登录
- **路径**：`POST /api/auth/login`
- **使用状态**：【前端使用中】
- **鉴权**：无
- **请求体**：
  ```json
  {
    "username": "string",
    "password": "string",
    "captcha_id": "string",
    "captcha_code": "string"
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "message": "登录成功",
    "token": "43位随机Bearer字符串",
    "user": {
      "id": 1,
      "username": "admin",
      "is_admin": 1,
      "created_at": "2026-08-23 06:17:54"
    }
  }
  ```
- **错误格式 (400 Bad Request)**：
  ```json
  { "detail": "用户名或密码错误" }
  ```

#### 2.1.4 获取当前会话状态
- **路径**：`GET /api/auth/me`
- **使用状态**：【前端使用中】（用于鉴权校验与心跳保活）
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  {
    "user": {
      "id": 1,
      "username": "admin",
      "is_admin": 1,
      "created_at": "2026-08-23 06:17:54",
      "token": "<当前token>"
    }
  }
  ```
- **错误格式 (401 Unauthorized)**：
  ```json
  { "detail": "登录会话已过期，请重新登录" }
  ```

#### 2.1.5 注销登录
- **路径**：`POST /api/auth/logout`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "message": "已成功注销登录"
  }
  ```

#### 2.1.6 修改密码
- **路径**：`POST /api/auth/password`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**：
  ```json
  {
    "old_password": "string",
    "new_password": "string"
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  { "success": true, "message": "密码修改成功" }
  ```
- **错误格式 (400 Bad Request)**：
  ```json
  { "detail": "原密码不正确" }
  ```

---

### 2.2 统计分析与总览 (Stats)

#### 2.2.1 获取数据总览大盘
- **路径**：`GET /api/stats/overview`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  {
    "stats": {
      "total_ac": 352,
      "total_subs": 1420,
      "today_ac": 4,
      "today_subs": 9,
      "streak": 18,
      "platforms": {
        "codeforces": { "ac": 120, "total": 450 },
        "luogu": { "ac": 95, "total": 380 },
        "acwing": { "ac": 45, "total": 120 },
        "atcoder": { "ac": 62, "total": 290 },
        "leetcode": { "ac": 30, "total": 180 }
      }
    },
    "platforms_status": [
      {
        "id": 1,
        "platform": "codeforces",
        "status": "ok",
        "message": "同步成功",
        "rating": "1642",
        "last_sync_time": "2026-10-29 11:30:00",
        "updated_at": "2026-10-29 11:30:00"
      }
    ],
    "last_sync_time": "2026-10-29 11:30:00",
    "climbing_curve": [
      { "date": "2026-01-01", "daily_new_ac": 2, "cumulative_ac": 150 }
    ],
    "daily_effort": [
      { "date": "2026-10-28", "total_subs": 8, "unique_ac": 3 }
    ],
    "local_code": {
      "total_lines": 0,
      "today_lines": 0,
      "total_files": 0,
      "today_files": 0,
      "c_lines": 0,
      "cpp_lines": 0,
      "java_lines": 0,
      "has_data": false,
      "synced_at": ""
    }
  }
  ```

#### 2.2.2 年度打卡热力图
- **路径**：`GET /api/stats/heatmap`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **Query 参数**：
  - `platform`: `all` | `codeforces` | `atcoder` | `luogu` | `acwing` | `leetcode` (默认 `all`)
  - `year`: int (可选，默认北京时间当前年份)
- **响应格式 (200 OK)**：
  ```json
  {
    "heatmap": [
      { "date": "2026-01-01", "count": 5, "unique_ac": 2 }
    ],
    "year": 2026,
    "available_years": [2026, 2025]
  }
  ```

#### 2.2.3 算法标签画像统计
- **路径**：`GET /api/stats/tags`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  {
    "tags": [
      { "tag": "动态规划", "ac_count": 68, "total_count": 140 },
      { "tag": "greedy", "ac_count": 42, "total_count": 89 }
    ]
  }
  ```

#### 2.2.4 全量提交记录流
- **路径**：`GET /api/stats/submissions`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **Query 参数**：
  - `limit`: int (默认 2000)
  - `platform`: string (默认 `all`)
- **响应格式 (200 OK)**：
  ```json
  {
    "submissions": [
      {
        "id": "codeforces_12345678",
        "user_id": 1,
        "platform": "codeforces",
        "raw_id": "12345678",
        "problem_id": "1800E2",
        "problem_title": "Unforgivable Curse (hard version)",
        "verdict": "AC",
        "tags": ["greedy", "dsu", "strings"],
        "difficulty": "1400",
        "difficulty_score": 1400,
        "submitted_at": "2026-10-28 21:15:02",
        "date": "2026-10-28",
        "submission_url": "https://codeforces.com/contest/1800/submission/12345678",
        "code_language": "GNU C++20",
        "extra_data": "",
        "created_at": "2026-10-28 21:16:00"
      }
    ]
  }
  ```
- **说明**：前端通过一次拉取至多 2000 条，在内存中进行日期范围预设、状态、标签与搜索筛选及内存分页。移动端建议分页或采用固定上限列表，保障低内存开销。

---

### 2.3 错题集模块 (Mistakes)

#### 2.3.1 获取错题列表 (带多维过滤与到期聚合)
- **路径**：`GET /api/mistakes`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **Query 参数**：
  - `status`: `all` | `due` (到期待复习) | `pending_review` (训练中) | `mastered` (已掌握)，默认 `all`
  - `search`: string (模糊匹配题号、标题、考点、笔记)
  - `tag`: string (标签包含过滤)
  - `platform`: string (平台代码过滤，如 `codeforces`、`luogu` 等)
  - `sort_by`: `last_submitted_at` | `next_review_at` | `review_count` (默认 `last_submitted_at`)
  - `page`: int (默认 1)
  - `page_size`: int (默认 50)
- **响应格式 (200 OK)**：
  ```json
  {
    "items": [
      {
        "id": 12,
        "user_id": 1,
        "platform": "codeforces",
        "problem_id": "1800E2",
        "problem_title": "Unforgivable Curse",
        "difficulty": "1400",
        "tags": ["greedy", "dsu"],
        "key_point": "字符连通分量判断",
        "notes": "利用 k 与 k+1 的跳跃自由度构建并查集...",
        "problem_url": "https://codeforces.com/problemset/problem/1800/E2",
        "last_submitted_at": "2026-10-28 21:15:02",
        "last_submission_id": "12345678",
        "status": "pending_review",
        "review_count": 1,
        "last_reviewed_at": "2026-10-28",
        "next_review_at": "2026-11-04",
        "is_due": false,
        "days_left": 6,
        "created_at": "2026-10-28 21:30:00",
        "updated_at": "2026-10-28 21:30:00"
      }
    ],
    "total": 35,
    "counts": {
      "total": 35,
      "due": 4,
      "in_progress": 22,
      "mastered": 9
    }
  }
  ```

#### 2.3.2 获取已录入错题的题目键索引
- **路径**：`GET /api/mistakes/keys`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  {
    "keys": ["codeforces:1800E2", "luogu:P1001", "atcoder:abc320_c"]
  }
  ```
- **说明**：提交流中用于判断题目是否已被收录到错题集（以高亮“已入错题”徽标）。

#### 2.3.3 添加题目到错题集
- **路径**：`POST /api/mistakes`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**：
  ```json
  {
    "platform": "codeforces",
    "problem_id": "1800E2",
    "problem_title": "Unforgivable Curse",
    "difficulty": "1400",
    "tags": ["greedy", "dsu"],
    "key_point": "考点错因",
    "notes": "解题笔记",
    "problem_url": "https://...",
    "last_submitted_at": "2026-10-28 21:15:02",
    "last_submission_id": "12345678"
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "mistake": { "id": 13, ... }
  }
  ```

#### 2.3.4 修改错题信息
- **路径**：`PUT /api/mistakes/{mistake_id}`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**：
  ```json
  {
    "key_point": "新的考点",
    "notes": "更新后的笔记",
    "tags": ["dsu"],
    "problem_url": "https://...",
    "status": "pending_review"
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  { "success": true }
  ```

#### 2.3.5 删除错题
- **路径**：`DELETE /api/mistakes/{mistake_id}`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  { "success": true }
  ```

#### 2.3.6 记录一次复习打卡 (艾宾浩斯智能推进)
- **路径**：`POST /api/mistakes/{mistake_id}/review`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**（可选）：
  ```json
  { "review_time": "2026-10-29" }
  ```
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "mistake": { "id": 12, "review_count": 2, "next_review_at": "2026-11-12", ... }
  }
  ```
- **机制说明**：艾宾浩斯复习间隔周期为 `[7, 14, 21, 28, 42, 60]` 天。完成第 6 次复习后状态自动转为 `mastered`。

#### 2.3.7 切换已掌握/未掌握状态
- **路径**：`POST /api/mistakes/{mistake_id}/toggle-master`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**（可选）：
  ```json
  { "mastered": true }
  ```
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "mistake": { "id": 12, "status": "mastered", ... }
  }
  ```

---

### 2.4 比赛日历模块 (Contests)

#### 2.4.1 获取比赛列表
- **路径**：`GET /api/contests`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **Query 参数**：
  - `platform`: `all` | `codeforces` | `atcoder` | `luogu` (默认 `all`)
  - `limit`: int (默认 60)
- **响应格式 (200 OK)**：
  ```json
  {
    "contests": [
      {
        "id": "cf_1920",
        "platform": "codeforces",
        "contest_id": "1920",
        "name": "Codeforces Round 980 (Div. 2)",
        "start_time": "2026-10-30 22:35:00",
        "start_timestamp": 1793370900,
        "duration_seconds": 7200,
        "duration_text": "2小时",
        "url": "https://codeforces.com/contest/1920",
        "phase": "BEFORE",
        "countdown_seconds": 124500,
        "status_text": "未开始",
        "rule_type": "CF"
      }
    ]
  }
  ```

#### 2.4.2 触发重新抓取全网比赛
- **路径**：`POST /api/contests/sync`
- **使用状态**：【前端使用中】（超时需设为 120 秒）
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "count": 28,
    "message": "比赛日历同步完成，共获取 28 场未结束比赛"
  }
  ```

---

### 2.5 平台账号管理模块 (Multi-Account)

#### 2.5.1 获取已绑定平台账号列表
- **路径**：`GET /api/accounts`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **Query 参数**：`platform` (可选，如 `codeforces`)
- **响应格式 (200 OK)**：
  ```json
  {
    "accounts": [
      {
        "id": 1,
        "user_id": 1,
        "platform": "codeforces",
        "handle": "tourist",
        "cookie": "",
        "alias": "主账号",
        "is_primary": 1,
        "created_at": "2026-08-23 06:17:54",
        "updated_at": "2026-10-25 09:00:00"
      }
    ]
  }
  ```

#### 2.5.2 添加平台账号
- **路径**：`POST /api/accounts`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**：
  ```json
  {
    "platform": "codeforces",
    "handle": "tourist",
    "cookie": "",
    "alias": "大号",
    "is_primary": false
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "message": "账号添加成功",
    "account": { "id": 2, ... }
  }
  ```

#### 2.5.3 更新平台账号
- **路径**：`PUT /api/accounts/{account_id}`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**：
  ```json
  {
    "handle": "tourist_alt",
    "cookie": "client_id=...",
    "alias": "训练小号",
    "is_primary": true
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  { "success": true, "message": "账号更新成功" }
  ```

#### 2.5.4 删除平台账号
- **路径**：`DELETE /api/accounts/{account_id}`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  { "success": true, "message": "账号移除成功" }
  ```

#### 2.5.5 设为主账号
- **路径**：`POST /api/accounts/{account_id}/primary`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  { "success": true, "message": "已成功设为主账号" }
  ```

#### 2.5.6 立即同步单个账号
- **路径**：`POST /api/accounts/{account_id}/sync`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  {
    "success": true,
    "message": "账号 tourist 同步完成，新增 3 条提交",
    "count": 3
  }
  ```

#### 2.5.7 测试账号连通性 (Direct Verify)
- **路径**：`POST /api/accounts/verify`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**：
  ```json
  {
    "platform": "codeforces",
    "handle": "tourist",
    "cookie": "",
    "http_proxy": ""
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  {
    "valid": true,
    "message": "Codeforces 用户验证成功",
    "extra": { "rating": "3850", "rank": "legendary grandmaster" }
  }
  ```
- **失败响应格式 (200 OK)**：
  ```json
  {
    "valid": false,
    "message": "用户不存在或网络不可达",
    "extra": {}
  }
  ```

---

### 2.6 系统配置与全局同步 (Settings & Sync)

#### 2.6.1 获取全局配置与平台状态
- **路径**：`GET /api/settings`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **响应格式 (200 OK)**：
  ```json
  {
    "configs": {
      "cf_handle": "tourist",
      "luogu_uid": "1000",
      "luogu_cookie": "...",
      "acwing_user_id": "2000",
      "acwing_cookie": "...",
      "atcoder_handle": "chokudai",
      "poll_interval_minutes": "30",
      "sprint_mode": "false",
      "http_proxy": "http://127.0.0.1:7890",
      "last_sync_time": "2026-10-29 11:30:00"
    },
    "status": {
      "codeforces": { "platform": "codeforces", "status": "ok", "message": "正常" },
      "luogu": { "platform": "luogu", "status": "ok", "message": "Cookie有效" }
    }
  }
  ```

#### 2.6.2 更新全局配置
- **路径**：`POST /api/settings`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**：
  ```json
  {
    "cf_handle": "string",
    "luogu_uid": "string",
    "luogu_cookie": "string",
    "acwing_user_id": "string",
    "acwing_cookie": "string",
    "atcoder_handle": "string",
    "poll_interval_minutes": "30",
    "sprint_mode": "true",
    "http_proxy": "http://127.0.0.1:7890"
  }
  ```
- **响应格式 (200 OK)**：
  ```json
  { "success": true, "message": "配置更新成功" }
  ```

#### 2.6.3 触发全量/指定平台后台同步
- **路径**：`POST /api/sync`
- **使用状态**：【前端使用中】
- **鉴权**：`Authorization: Bearer <token>`
- **请求体**：
  ```json
  { "platform": "all" }  // 可选 "all", "codeforces", "luogu", "acwing", "atcoder", "contests"
  ```
- **响应格式 (200 OK)**：
  ```json
  { "success": true, "data": { ... } }
  ```

---

## 3. 闲置/排除接口标注

| 方法 | 路径 | 来源 | 说明与移动端处理策略 |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/stats/mistakes` | `main.py:404` | **没人用**。前端改用功能更全的 `/api/mistakes`（支持搜索、分页、到期聚合）。移动端同样忽略此接口。 |
| `POST` | `/api/verify` | `main.py:575` | **遗留单账号接口**。前端已由多账号专用接口 `/api/accounts/verify` 替代。移动端忽略。 |
| `POST` | `/api/stats/local-code` | `main.py:281` | **Agent 专属上报接口**。规则约束第 3 条明确忽略 Agent，移动端不调用。 |
| `GET` | `/api/stats/local-code` | `main.py:287` | **Agent 数据查询**。已内聚在 `/api/stats/overview` 的 `local_code` 字段中。移动端不调用独立接口。 |
| `GET` | `/api/v1/submissions/health` | `api_router.py:321` | **油猴端云核实健康检查**。供浏览器脚本探测，移动端不调用。 |
| `POST` | `/api/v1/submissions/push` | `api_router.py:330` | **油猴浏览器提交采集推送**。供 Tampermonkey 实时推送题目代码与评测结果，移动端作为纯查看/复习端不调用。 |
| `GET` | `/oj-tracker.user.js` | `main.py:633` | 静态分发油猴脚本代码，移动端不加载。 |
