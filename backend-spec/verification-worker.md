# 后端接收与异步核实状态机规范说明书 (Backend Verification Spec)

本文档定义了 OJ 提交记录的**乐观采信入库**、**单点异步核实**以及**风控自动回退状态机**的完整流转逻辑。

---

## 1. 核心架构设计

传统爬虫采用“全量周期轮询”的方式，不仅容易触发各大 OJ（如力扣、洛谷）的 WAF 拦截与 403 封禁，且存在较大时间延迟。
本系统反转了这一范式：
1. **Fast Path（实时采集通道）**：
   - 用户做题出结果瞬间，由油猴插件截获原始 JSON/DOM 数据，通过 `POST /api/v1/submissions/push` 实时上报。
   - 后端校验后，以 `OPTIMISTIC`（乐观采信）状态秒级入库。
   - 前端统计与看板立即显示该 AC 记录，用户无需等待后端异步核实。
2. **Verification Path（权威核实通道）**：
   - 后端入库后投递延迟 5 秒的异步核实任务。
   - 爬虫 Worker **仅针对该特定 `submissionId` 发起单点点对点请求**（请求量降低 99%）。
   - 若核实一致，状态流转为 `VERIFIED`。
   - 若遇到 WAF、403、验证码、超时或用户开启洛谷隐私保护，**自动触发回退机制**，流转为 `FALLBACK_TRUSTED`，永久保留油猴上报数据，不影响有效 AC 统计。
   - 若明确返回 404 或查实为 WA 等不符状态，标记为 `REJECTED` 并剔除统计。

---

## 2. 状态机流转图 (State Machine)

```
                    [油猴插件 POST /api/v1/submissions/push]
                                       |
                                       v
                    初始状态: verify_status = 'OPTIMISTIC'
                    (前端立即可见有效打卡与 AC 统计)
                                       |
                                       v
                         投递异步延迟单点核实任务 (延迟 5s)
                                       |
         +-----------------------------+-----------------------------+
         |                             |                             |
         v (核实数据一致)               v (遭遇 403/WAF/验证码/超时)   v (明确 404 或状态不一致)
+--------------------+      +------------------------------+      +--------------------+
|    'VERIFIED'      |      |   触发回退 (Fallback 状态机)  |      |    'REJECTED'      |
|  权威对账通过完成  |      |   retry_count < 3 ?          |      |  判定伪造，剔除看板 |
+--------------------+      |   - 是: 指数退避 (15s/30s/45s)|      +--------------------+
                            |   - 否: 转为                 |
                            |     'FALLBACK_TRUSTED'       |
                            |     永久采信端侧上报数据     |
                            +------------------------------+
```

---

## 3. 各平台单点核实策略

| 平台 | 核实方式 | 成功判定条件 | 遭遇风控/失败时行为 |
| :--- | :--- | :--- | :--- |
| **Codeforces** | 官方 API `user.status?handle={handle}&count=25` | 列表中包含对应 `id` 且 `verdict == 'OK'` | 若 API 受限或网络超时，重试 3 次后转 `FALLBACK_TRUSTED` |
| **洛谷 (Luogu)** | 请求 `record/{rid}?_contentOnly=1` | 解析 `record.status == 12` 且题目匹配 | 遇 403/隐私保护，重试 3 次后转 `FALLBACK_TRUSTED`；遇 404 判定 `REJECTED` |
| **力扣 (LeetCode CN)** | 公开 GraphQL `recentACSubmissions(userSlug)` 免登查询 | 题目 Slug 在最近通过列表中 | 遇 GraphQL 签名拦截或不在前 15 条，自动转 `FALLBACK_TRUSTED` |
| **AtCoder** | 请求 `/contests/{cid}/submissions/{sid}` 单页 | 解析 HTML 状态徽标为 `AC` 且用户名匹配 | 遇 429 限流或 403，转 `FALLBACK_TRUSTED`；遇 404 转 `REJECTED` |
| **AcWing** | 依赖油猴端精准上报 | 服务端免登状态默认信任端侧上报 | 自动标记为 `FALLBACK_TRUSTED` |

---

## 4. 接口契约说明

### 4.1 接收上报接口
- **URL**: `POST /api/v1/submissions/push`
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>` (可选，若配置环境变量 `OJ_TRACKER_SECRET` 则强制校验)
  - `X-OJ-Tracker-Version: 1.0.0`
- **Request Body**:
```json
{
  "platform": "luogu",
  "platformSubmissionId": "168923412",
  "problemId": "P1001",
  "problemTitle": "A+B Problem",
  "problemUrl": "https://www.luogu.com.cn/problem/P1001",
  "platformUserHandle": "zhuanz",
  "verdict": "AC",
  "rawStatus": "12",
  "score": 100,
  "language": "cpp",
  "sourceCode": "#include <iostream>\\nint main() { ... }",
  "executionTimeMs": 15,
  "memoryUsedKb": 1024,
  "submittedAt": 1729562400000,
  "clientVersion": "1.0.0"
}
```
- **Response (200 OK)**:
```json
{
  "code": 200,
  "message": "Submission optimistically recorded and queued for verification",
  "data": {
    "recordId": 1,
    "platform": "luogu",
    "submissionId": "168923412",
    "action": "inserted",
    "verifyStatus": "OPTIMISTIC"
  }
}
```

### 4.2 看板查询有效提交的 SQL 建议
业务层查询用户有效 AC 记录时，必须将 `OPTIMISTIC`、`VERIFIED`、`FALLBACK_TRUSTED` 三种状态均视为有效通过：

```sql
SELECT * FROM oj_submissions
WHERE user_id = :user_id
  AND verdict = 'AC'
  AND verify_status IN ('OPTIMISTIC', 'VERIFIED', 'FALLBACK_TRUSTED')
ORDER BY submitted_at DESC;
```
