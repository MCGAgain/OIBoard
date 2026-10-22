# 多平台 OJ 提交采集与端云核实系统 — Agent 实施规范说明书 (Spec v1.0)

> **文档定位**：本文档为面向 AI Coding Agent（如 Antigravity / Cursor + Gemini 3.8 Flash）的**全量工程级需求与架构规范（Specification）**。
> **阅读指令（致 AI Agent）**：请严格按照本文档定义的目录结构、通信协议、沙箱穿透规范、各平台适配器状态机及防坑指南编写代码。**严禁自行删减边界保护逻辑（如 `response.clone()`、`unsafeWindow`、幂等去重等）**。

---

## 一、 场景与痛点（为什么采用这套架构）

### 1.1 多平台反爬壁垒与采集策略分级
在多 OJ 算法训练数据统计系统中，不同平台的接口开放程度与风控强度差异极大：

| 平台名称 | 域名匹配 | 开放 API 情况 | 反爬与风控机制 | 推荐采集与核实策略 | 方案把握度 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **力扣 (LeetCode CN)** | `leetcode.cn` | 无公开外部 API | 阿里云 WAF + GraphQL 签名 + 高频 403 | **油猴拦截为主**（`fetch` 劫持 `/submit/` 与 `/check/`），后端低频单点核实或乐观采信 | **98%** |
| **洛谷 (Luogu)** | `www.luogu.com.cn` | 无官方公开 API | `x-csrf-token` + WebSocket 推送 + 隐私保护 + 403 封 IP | **油猴拦截 + 端侧主动轮询 `_contentOnly=1`**，后端单点核实 `record/{rid}` | **95%** |
| **AcWing** | `www.acwing.com` | 无公开 API | Django CSRF + Session 强绑定 + WebSocket 判题推送 | **油猴拦截 XHR/WebSocket + DOM `MutationObserver` 双保险**，以端侧上报为准 | **92%** |
| **Codeforces** | `codeforces.com` | 官方 `user.status` API | Cloudflare 盾（针对网页爬虫，API 不受限） | **油猴监听状态页触发实时通知** + **后端直接调官方 API 权威同步** | **96%** |
| **AtCoder** | `atcoder.jp` | 社区 Kenkoooo API / 状态 JSON | 较温和，但高频拉取会被限流 | **油猴拦截 `/submissions/me/status/json`** + **后端单点核实** | **96%** |

### 1.2 核心架构反转：为什么必须是「油猴实时推送为主，爬虫单点核实为辅」
* **错误范式（爬虫为主、油猴回退）**：服务端定时轮询爬取用户提交列表，遇到封号或验证码时试图“回退”到油猴。**致命缺陷**：油猴脚本仅在用户打开浏览器做题的几分钟内存活，后端发现爬虫失效时，用户早已关闭标签页，无法回退。
* **正确范式（端侧事件驱动 + 云端乐观入库与异步对账）**：
  1. **Fast Path（实时通道）**：用户在浏览器点击提交并出判题结果瞬间，油猴脚本在本地内存截获明文 JSON 与提交源码，立即通过 `GM_xmlhttpRequest` 推送至后端。后端以 `OPTIMISTIC`（乐观采信）状态秒级落库并更新前端看板。
  2. **Verification Path（核实通道）**：后端收到包含精确 `submissionId` 的推送后，将其推入异步延迟队列。爬虫 Worker 仅需针对这 **1 个 `submissionId`** 发起单次点对点核实请求（请求量降低 99%）：
     * 核实通过 $\rightarrow$ 状态更新为 `VERIFIED`。
     * 爬虫遭遇 403 / 验证码 / 用户开启洛谷代码隐私保护 $\rightarrow$ **自动触发回退机制**，保留油猴上报的 `OPTIMISTIC` 数据作为有效记录，并将核实任务指数退避重试。

```
+-----------------------------------------------------------------------------------+
|                            用户浏览器 (Tampermonkey 端)                            |
|                                                                                   |
|  [宿主网页: 力扣 / 洛谷 / AcWing / CF / AtCoder]                                   |
|         |                                     ^                                   |
|         | 1. 发起提交 / 轮询判题               | 4. 原样返回响应 (零破坏)           |
|         v                                     |                                   |
|  +-----------------------------------------------------------------------------+  |
|  | 核心钩子层 (Network & DOM Hooks - 运行于 document-start & unsafeWindow)     |  |
|  |  - Fetch Hook (必须 response.clone())                                       |  |
|  |  - XHR Prototype Hook (拦截 open / send)                                    |  |
|  |  - WebSocket Hook & Active Poller (针对洛谷 rid / AcWing)                   |  |
|  |  - DOM MutationObserver (针对 AcWing / CF / AtCoder 状态表)                 |  |
|  +-----------------------------------------------------------------------------+  |
|                                       |                                           |
|                                       | 2. 路由分发至当前域名适配器               |
|                                       v                                           |
|  +-----------------------------------------------------------------------------+  |
|  | 平台适配器层 (Platform Adapters) + 本地幂等去重缓存 (LRUCache / GM_setValue)|  |
|  |  - 组装标准报文 UnifiedSubmissionPayload (含源码、耗时、内存、状态)         |  |
|  +-----------------------------------------------------------------------------+  |
|                                       |                                           |
|                                       | 3. GM_xmlhttpRequest (绕过 CORS 与 CSP)   |
+---------------------------------------|-------------------------------------------+
                                        |
                                        v
+-----------------------------------------------------------------------------------+
|                                服务端 (Backend Server)                            |
|                                                                                   |
|  [POST /api/v1/submissions/push]                                                  |
|         |                                                                         |
|         +---> 1. 校验 User Token & 唯一键 (platform, submission_id) 幂等落库      |
|         |        初始状态: verify_status = 'OPTIMISTIC' (前端立即可见)            |
|         |                                                                         |
|         +---> 2. 投递异步核实队列 (Verification Queue)                            |
|                     |                                                             |
|                     +--> [CF / AtCoder] ---> 调官方/公开 API ---> 'VERIFIED'      |
|                     |                                                             |
|                     +--> [洛谷 / 力扣 / AcWing] ---> 单点请求详情页               |
|                             |-- 成功且匹配 -------------> 更新为 'VERIFIED'       |
|                             |-- 爬虫 403/风控失败 ------> 保持 'OPTIMISTIC' (回退)|
|                             +-- 明确查无此单/状态不符 --> 标记为 'REJECTED'       |
+-----------------------------------------------------------------------------------+
```

---

## 二、 AI Agent 极易踩坑的 8 大禁区（Agent 编码前必读）

在使用 AI 模型生成油猴脚本与后端同步逻辑时，以下 **8 个坑位**是模型最容易写出 Bug 的地方，实施时必须逐条核对：

### 禁区 1：开启 `@grant` 后未用 `unsafeWindow` 导致拦截彻底失效
* **现象**：写了 `window.fetch = ...`，但网页的请求一个都拦不到。
* **原因**：只要油猴脚本声明了 `@grant GM_xmlhttpRequest`，Tampermonkey 就会把脚本放进独立的沙箱作用域（Sandbox `window`）。此时修改 `window.fetch` 改的只是沙箱内部的副本，宿主网页（React/Vue）调的是真实 DOM 的 `window.fetch`。
* **强制规范**：必须在头部声明 `// @grant unsafeWindow`，并在代码中定义：
  ```javascript
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  ```
  所有对 `fetch`、`XMLHttpRequest`、`WebSocket` 的劫持必须挂载在 `pageWindow` 上。

### 禁区 2：未设置 `@run-at document-start` 导致前端框架缓存原生引用
* **现象**：脚本偶尔能拦到，偶尔拦不到，或者在力扣/洛谷完全失效。
* **原因**：油猴默认在 `document-idle`（DOM 加载完毕后）才注入脚本。而现代前端打包工具（Webpack/Vite）在初始化模块时，有时会将 `window.fetch` 或 `window.XMLHttpRequest` 赋值给闭包内部变量。如果脚本注入太晚，前端早已拿走了原生引用。
* **强制规范**：必须在元数据头部声明 `// @run-at document-start`，确保在任何网页 `<script>` 执行前完成猴子补丁（Monkey Patching）。同时，任何需要操作 DOM 的逻辑（如挂载配置面板 UI、启动 `MutationObserver`）必须包裹在 `DOMContentLoaded` 事件之后。

### 禁区 3：直接读取 `fetch` 的 `response.json()` 导致原网页崩溃
* **现象**：油猴拿到了数据，但力扣页面一直卡在“判题中”转圈，控制台报错 `TypeError: Body is unusable: Body has already been read`。
* **原因**：Fetch API 的 `Response.body` 是单向可读流（`ReadableStream`），只能被消费一次。
* **强制规范**：在 `fetch` 拦截器内部，**绝对禁止**直接调用 `response.json()` 或 `response.text()`。必须先调用 `const cloned = response.clone();`，对 `cloned` 进行异步解析，并立即把原始 `response` 返回给宿主网页。

### 禁区 4：忽略提交请求体（Request Body），导致拿不到用户 AC 源代码
* **现象**：轮询接口 `/check/` 返回了 `Accepted`，但返回的 JSON 里只有耗时和内存，没有用户提交的代码（`code`）和语言（`lang`）。
* **原因**：力扣和洛谷在点击“提交”发起 `POST` 请求时携带了源代码，而后续轮询判题状态的 `GET` 接口为了节省带宽，往往不再回传代码全文。
* **强制规范**：必须在拦截 `POST` 提交请求时，解析请求体（Request Body），将 `{ problemId, code, language }` 暂存到内存 `pendingSubmissions` 字典中；当后续轮询接口返回最终判题结果时，将其与暂存的源码合并后再上报后端。

### 禁区 5：洛谷依赖被动拦截 XHR，漏掉 WebSocket 推送及新架构响应
* **现象**：用户在洛谷交完题跳转到 `/record/{rid}`，评测出结果后油猴毫无反应。
* **原因**：洛谷评测等待页通过 WebSocket 实时推送判题进度并直接修改前端 Vue 状态，评测结束时**不会再次发起 `/record/{rid}` 的 XHR 请求**！而且洛谷新架构已逐步用 `<script id="lentille-context">` 替代旧版 `window._feInjection`。
* **强制规范**：在洛谷适配器中，采用**“端侧主动轻量轮询（Client-Side Active Polling）”**。一旦检测到进入 `/record/{rid}` 页面或拦截到提交请求返回 `rid`，由油猴脚本主动调用原生的 `pageWindow.fetch('/record/' + rid + '?_contentOnly=1', { headers: { 'x-lentille-request': 'content-only', 'X-Requested-With': 'XMLHttpRequest' } })`（同时兼容解析 JSON 与 HTML 中的 `lentille-context`），每 2 秒查一次（最多 15 次），直到 `status >= 2`（非 Waiting/Judging）。因为跑在用户浏览器里且只查当前这 1 条记录，绝对安全且 100% 稳定。

### 禁区 6：SPA 单页应用路由切换未监听，导致切题后脚本失效
* **现象**：在力扣做完第一题跳到第二题，脚本没有感知到题目 URL 变化。
* **原因**：力扣、洛谷均为 SPA（单页应用），切换题目使用的是 `history.pushState` 或 `replaceState`，不会触发整页刷新。
* **强制规范**：必须劫持 `pageWindow.history.pushState` 和 `replaceState`，并监听 `popstate` 事件，在 URL 变化时通知当前平台适配器更新上下文。

### 禁区 7：缺乏本地与服务端双重幂等去重，导致单次提交重复上报十几次
* **现象**：一次 AC 产生了多条重复推送。
* **原因**：轮询接口在评测结束后可能还会被前端多调 1~2 次，或者用户刷新了提交记录详情页。
* **强制规范**：
  1. **端侧去重**：使用 `GM_getValue('reported_ids', [])` 维护一个容量为 500 的环形队列（FIFO），已成功推送的 `${platform}:${submissionId}` 绝不二次发送。
  2. **云端幂等**：数据库表必须建立 `UNIQUE KEY uk_platform_sub (platform, platform_submission_id)`，使用 `INSERT ... ON DUPLICATE KEY UPDATE`（MySQL）或 `ON CONFLICT DO UPDATE`（PostgreSQL）。

### 禁区 8：使用普通 `fetch` 向自己的后端上报，触发 CORS 或 CSP 报错
* **现象**：控制台报错 `Refused to connect to 'https://your-backend.com' because it violates the document's Content Security Policy`。
* **原因**：各大 OJ 均配置了严格的 CSP 响应头，禁止页面内的脚本向未授权的第三方域名发起 `fetch`/`XHR` 请求。
* **强制规范**：向自己的后端发送数据时，**必须且只能使用 `GM_xmlhttpRequest`**，并在脚本头部配置 `// @connect *` 或具体的后端域名。

---

## 三、 模块化项目工程结构设计

虽然油猴脚本最终发布时是一个单文件（`.user.js`），但在使用 Agent 开发时，推荐采用 **TypeScript / ES Module 模块化组织 + Vite (`vite-plugin-monkey`) 打包**（或者清晰的单文件分层命名空间结构，方便直接粘贴进 Tampermonkey）。以下为完整的工程目录规范：

```text
oj-submission-tracker/
├── package.json
├── tsconfig.json
├── vite.config.ts                  # 配置 vite-plugin-monkey 自动生成 UserScript Header
├── src/
│   ├── main.ts                     # 入口：初始化 Hook、识别当前域名、挂载对应 Adapter 与 UI
│   ├── types/
│   │   └── payload.ts              # 统一上报报文接口定义 (UnifiedSubmissionPayload)
│   ├── core/
│   │   ├── sandbox.ts              # 封装 pageWindow (unsafeWindow) 与安全日志
│   │   ├── network-hook.ts         # 统一 Fetch / XHR / WebSocket 拦截总线 (EventEmitter 模式)
│   │   ├── router-hook.ts          # SPA 路由变化监听 (pushState / replaceState / popstate)
│   │   ├── storage.ts              # 基于 GM_getValue / GM_setValue 的配置管理与 LRU 幂等集合
│   │   └── transport.ts            # 基于 GM_xmlhttpRequest 的跨域上报器（含失败重试队列）
│   ├── adapters/
│   │   ├── base-adapter.ts         # 抽象基类 BaseAdapter
│   │   ├── leetcode-adapter.ts     # 力扣中国 (leetcode.cn) 适配器
│   │   ├── luogu-adapter.ts        # 洛谷 (luogu.com.cn) 适配器（含主动轮询器）
│   │   ├── acwing-adapter.ts       # AcWing (acwing.com) 适配器（WebSocket + DOM 双保险）
│   │   ├── codeforces-adapter.ts   # Codeforces 适配器
│   │   └── atcoder-adapter.ts      # AtCoder 适配器
│   └── ui/
│       └── status-badge.ts         # 页面右下角悬浮状态胶囊（配置后端地址、Token、显示同步状态）
└── backend-spec/                   # 后端接收与异步核实参考实现
    ├── schema.sql                  # 数据库表结构设计（含幂等索引与核实状态机）
    └── verification-worker.md      # 爬虫单点核实与回退状态机逻辑说明
```

---

## 四、 核心公共层与统一数据协议设计

### 4.1 统一上报数据契约 (`UnifiedSubmissionPayload`)
无论来自哪个 OJ 平台，适配器解析完成后必须转化为以下标准 JSON 格式再推送至后端：

```typescript
export type PlatformType = 'leetcode_cn' | 'luogu' | 'acwing' | 'codeforces' | 'atcoder';

export type VerdictType =
  | 'AC'   // Accepted (通过)
  | 'WA'   // Wrong Answer
  | 'TLE'  // Time Limit Exceeded
  | 'MLE'  // Memory Limit Exceeded
  | 'RE'   // Runtime Error
  | 'CE'   // Compilation Error
  | 'PE'   // Presentation Error
  | 'PA'   // Partial Accepted (OI 赛制部分分，如洛谷 Unaccepted 但 score > 0)
  | 'OTHER';

export interface UnifiedSubmissionPayload {
  /** 平台标识 */
  platform: PlatformType;
  /** 平台原始提交记录唯一 ID (如洛谷 rid、力扣 submission_id) */
  platformSubmissionId: string;
  /** 平台题目唯一标识 (如力扣 titleSlug "two-sum"、洛谷 "P1001"、CF "1920A") */
  problemId: string;
  /** 题目标题（可选，端侧能拿到则传） */
  problemTitle?: string;
  /** 题目完整 URL */
  problemUrl: string;
  /** 用户在该平台的账号标识/昵称（可选，用于校验是否本人提交） */
  platformUserHandle?: string;
  /** 标准化判题结果 */
  verdict: VerdictType;
  /** 平台原始状态码或状态文本 (如 "10", "Accepted", "12") */
  rawStatus: string;
  /** OI 赛制得分（如洛谷 0~100 分，ACM 赛制 AC 默认 100） */
  score?: number;
  /** 编程语言 (如 "cpp", "python3", "java") */
  language: string;
  /** 用户提交的完整源代码（解决洛谷/AcWing/力扣隐私保护无法爬取源码的痛点） */
  sourceCode?: string;
  /** 运行耗时（单位：ms） */
  executionTimeMs?: number;
  /** 运行内存（单位：KB） */
  memoryUsedKb?: number;
  /** 提交时间戳（毫秒级 Unix Timestamp） */
  submittedAt: number;
  /** 客户端脚本版本号 */
  clientVersion: string;
}
```

### 4.2 底层网络拦截总线 (`src/core/network-hook.ts`)
**设计原则**：所有的平台适配器**绝不能各自去覆盖 `pageWindow.fetch` 或 `XMLHttpRequest`**（否则多个适配器或网页自身逻辑会互相覆盖污染）。必须由 `NetworkHookBus` 统一劫持一次，将请求与响应封装为标准事件分发给注册的监听器。

```typescript
// 核心实现逻辑参考（供 Agent 直接采用）
export interface InterceptedHttpEvent {
  type: 'fetch' | 'xhr';
  method: string;
  url: string;
  requestBody: string | null;
  status: number;
  responseText: string;
}

type HttpListener = (event: InterceptedHttpEvent) => void;
type WsMessageListener = (url: string, data: string) => void;

export class NetworkHookBus {
  private static httpListeners: HttpListener[] = [];
  private static wsListeners: WsMessageListener[] = [];
  private static initialized = false;
  public static rawFetch: typeof fetch;

  public static init(pageWindow: Window & typeof globalThis) {
    if (this.initialized) return;
    this.initialized = true;

    // 1. 保存原生 fetch 供主动轮询器使用，避免死循环拦截
    const originalFetch = pageWindow.fetch.bind(pageWindow);
    this.rawFetch = originalFetch;

    // 2. 劫持 Fetch
    pageWindow.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
      let url = '';
      let method = 'GET';
      let requestBody: string | null = null;

      if (typeof args[0] === 'string' || args[0] instanceof URL) {
        url = String(args[0]);
      } else if (args[0] instanceof Request) {
        url = args[0].url;
        method = args[0].method || 'GET';
      }

      if (args[1]) {
        method = args[1].method || method;
        if (typeof args[1].body === 'string') {
          requestBody = args[1].body;
        }
      }

      const response = await originalFetch(...args);

      // 关键防坑：克隆响应流，异步读取文本，绝不阻塞原网页
      try {
        const cloned = response.clone();
        cloned.text().then((text) => {
          NetworkHookBus.emitHttp({
            type: 'fetch',
            method: method.toUpperCase(),
            url,
            requestBody,
            status: response.status,
            responseText: text,
          });
        }).catch(() => {});
      } catch (_) {}

      return response;
    };

    // 3. 劫持 XMLHttpRequest
    const OriginalXHR = pageWindow.XMLHttpRequest;
    const originalOpen = OriginalXHR.prototype.open;
    const originalSend = OriginalXHR.prototype.send;

    OriginalXHR.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
      (this as any)._tmMethod = (method || 'GET').toUpperCase();
      (this as any)._tmUrl = String(url);
      return originalOpen.apply(this, [method, url, ...rest] as any);
    };

    OriginalXHR.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const reqBody = typeof body === 'string' ? body : null;
      this.addEventListener('load', function () {
        try {
          if (this.responseType === '' || this.responseType === 'text') {
            NetworkHookBus.emitHttp({
              type: 'xhr',
              method: (this as any)._tmMethod || 'GET',
              url: (this as any)._tmUrl || '',
              requestBody: reqBody,
              status: this.status,
              responseText: this.responseText || '',
            });
          } else if (this.responseType === 'json' && this.response) {
            NetworkHookBus.emitHttp({
              type: 'xhr',
              method: (this as any)._tmMethod || 'GET',
              url: (this as any)._tmUrl || '',
              requestBody: reqBody,
              status: this.status,
              responseText: JSON.stringify(this.response),
            });
          }
        } catch (_) {}
      });
      return originalSend.call(this, body);
    };

    // 4. 劫持 WebSocket（针对 AcWing 和洛谷实时判题推送）
    const OriginalWS = pageWindow.WebSocket;
    pageWindow.WebSocket = function (url: string | URL, protocols?: string | string[]) {
      const wsInstance = protocols ? new OriginalWS(url, protocols) : new OriginalWS(url);
      wsInstance.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          NetworkHookBus.emitWs(String(url), event.data);
        }
      });
      return wsInstance;
    } as any;
    pageWindow.WebSocket.prototype = OriginalWS.prototype;
    Object.assign(pageWindow.WebSocket, OriginalWS);
  }

  public static onHttp(listener: HttpListener) {
    this.httpListeners.push(listener);
  }

  public static onWs(listener: WsMessageListener) {
    this.wsListeners.push(listener);
  }

  private static emitHttp(event: InterceptedHttpEvent) {
    for (const fn of this.httpListeners) {
      try { fn(event); } catch (e) { console.error('[TM-Hook] HTTP listener error:', e); }
    }
  }

  private static emitWs(url: string, data: string) {
    for (const fn of this.wsListeners) {
      try { fn(url, data); } catch (e) { console.error('[TM-Hook] WS listener error:', e); }
    }
  }
}
```

---

## 五、 五大平台适配器（Adapters）精准实现细节

以下是每个平台真实的网络接口路径、请求体结构、响应体关键字段以及状态码映射规则。Agent 必须严格按此实现各适配器：

---

### 5.1 力扣中国适配器 (`leetcode.cn`)

#### 1) 核心链路拆解
1. **阶段一：拦截提交请求（缓存源码与语言）**
   * **匹配路径**：`method === 'POST'` 且 `url` 匹配 `/problems/([^/]+)/submit/`。
   * **请求体 JSON (`event.requestBody`)**：
     ```json
     {
       "lang": "cpp",
       "question_id": "1",
       "typed_code": "class Solution { ... };"
     }
     ```
   * **响应体 JSON (`event.responseText`)**：
     ```json
     {
       "submission_id": 543210987
     }
     ```
   * **处理动作**：从 URL 正则提取 `titleSlug`（如 `two-sum`），将 `String(submission_id)` 作为 Key，把 `{ titleSlug, questionId: req.question_id, lang: req.lang, code: req.typed_code }` 存入内存字典 `pendingMap`。

2. **阶段二：拦截判题轮询结果（合并并上报）**
   * **匹配路径 A（REST 轮询，最常见）**：`method === 'GET'` 且 `url` 匹配 `/submissions/detail/(\d+)/check/`。
   * **响应体 JSON (`event.responseText`)**：
     ```json
     {
       "state": "SUCCESS",
       "status_code": 10,
       "status_msg": "Accepted",
       "status_runtime": "4 ms",
       "runtime_percentile": 95.12,
       "status_memory": "41.2 MB",
       "question_id": "1",
       "lang": "cpp",
       "submission_id": "543210987"
     }
     ```
   * **匹配路径 B（GraphQL 查询，新版灵动布局补充）**：`method === 'POST'` 且 `url.includes('/graphql')`，请求体包含 `"submissionDetails"`。
   * **判题结束条件**：`data.state === 'SUCCESS'`。
   * **状态码映射 (`data.status_code`)**：
     * `10` $\rightarrow$ `'AC'`
     * `11` $\rightarrow$ `'WA'`
     * `12` $\rightarrow$ `'MLE'`
     * `13` $\rightarrow$ `'OTHER'` (Output Limit Exceeded)
     * `14` $\rightarrow$ `'TLE'`
     * `15` $\rightarrow$ `'RE'`
     * `20` $\rightarrow$ `'CE'`
   * **单位清洗**：
     * `status_runtime` 如 `"4 ms"` $\rightarrow$ `parseInt("4 ms", 10)` 得到 `4` (ms)。若为 `"N/A"` 则设为 `0`。
     * `status_memory` 如 `"41.2 MB"` $\rightarrow$ `Math.round(parseFloat("41.2") * 1024)` 得到 `42189` (KB)。

---

### 5.2 洛谷适配器 (`www.luogu.com.cn`)

#### 1) 核心链路拆解（解决 WebSocket 与新旧架构兼容问题）
1. **阶段一：拦截提交请求（记录源码与 `rid`）**
   * **匹配路径**：`method === 'POST'` 且 `url` 匹配 `/fe/api/problem/submit/(P\d+|CF\w+|AT_\w+|SP\d+|UVA\d+|B\d+|T\d+|U\d+)`。
   * **请求体 JSON**：`{ "code": "...", "lang": 28, "enableO2": 1 }`。
   * **响应体 JSON**：`{ "status": 200, "data": { "rid": 168923412 } }`。
   * **处理动作**：拿到 `rid` 后，将 `{ problemId, code, lang }` 存入 `pendingMap.set(String(rid), ...)`，并**立即调用 `startActivePolling(String(rid))`**。

2. **阶段二：路由监听兜底**
   * 当 URL 变化匹配 `/record/(\d+)` 时，提取 `rid`，若该 `rid` 未上报且不在轮询中，同样启动 `startActivePolling(rid)`。

3. **阶段三：端侧主动轻量轮询器 (`startActivePolling(rid)`)**
   * **为什么必须主动轮询**：洛谷跳转到 `/record/{rid}` 后，判题过程由 WebSocket 推送，评测完成时不会触发新的 XHR 请求。
   * **轮询实现逻辑**：
     每隔 `2000ms` 使用 `NetworkHookBus.rawFetch`（绕过拦截总线防止死循环）请求：
     `https://www.luogu.com.cn/record/${rid}?_contentOnly=1`
     携带 Header：`{ 'X-Requested-With': 'XMLHttpRequest', 'x-lentille-request': 'content-only' }`。
   * **双格式兼容解析（极其关键）**：
     * **格式 1（传统 `_contentOnly=1` JSON）**：响应直接是 JSON，读取 `json.currentData.record`。
     * **格式 2（洛谷新版 Lentille 架构 JSON/HTML）**：如果返回的是 JSON 且含 `data.record`，则读取 `json.data.record`；如果返回的是 HTML 文本，用正则或 `DOMParser` 提取 `<script id="lentille-context" type="application/json">` 标签内的 JSON，读取 `context.data.record`。
   * **洛谷评测状态码 (`record.status`) 判定**：
     * `0` (Waiting) 或 `1` (Judging)：**继续下一轮轮询**（最多轮询 20 次，超次停止）。
     * `>= 2`（评测已结束，停止轮询并上报）：
       * `12` $\rightarrow$ `'AC'` (Accepted)
       * `14` $\rightarrow$ 若 `record.score > 0` 则为 `'PA'` (Partial Accepted)，否则为 `'WA'` (Unaccepted)
       * `7` $\rightarrow$ `'CE'` (Compile Error)
       * `2` $\rightarrow$ `'TLE'`
       * `3` $\rightarrow$ `'MLE'`
       * `4` $\rightarrow$ `'RE'`
   * **字段提取**：
     * `problemId`: `record.problem.pid` (如 `"P1001"`)
     * `problemTitle`: `record.problem.title`
     * `executionTimeMs`: `record.time` (洛谷原生单位即为 ms)
     * `memoryUsedKb`: `record.memory` (洛谷原生单位即为 KB)
     * `sourceCode`: `record.sourceCode` || 从 `pendingMap` 缓存中获取

---

### 5.3 AcWing 适配器 (`www.acwing.com`)

#### 1) 核心痛点与双保险机制
AcWing 的题库提交采用 **WebSocket (`wss://www.acwing.com/wss/...`)** 或 **jQuery AJAX** 通信，且前端直接将结果渲染进 DOM。不同题库（普通题库、打卡题、竞赛）的 WebSocket 消息结构可能微调，因此采用 **“WebSocket / XHR 拦截 + DOM `MutationObserver` 状态监听”** 双保险。

#### 2) 链路实现细节
1. **源码与题目信息提取**：
   * 在 `/problem/content/(\d+)/` 页面，提交代码时：
     * 监听 `NetworkHookBus.onWs` 或提交按钮点击事件，从页面 Ace Editor / Monaco Editor 实例或表单字段提取当前代码与语言（`#code_editor` 或页面 `<select id="code_language">`）。
     * 题目 ID 从 URL `/problem/content/(\d+)/` 提取（如 `"acwing_785"`），题目标题从 `.problem-content-title` 提取。
2. **通道 A：拦截 WebSocket 判题推送 / XHR 响应**：
   * 当 WebSocket 收到消息 JSON 包含 `"status"` 且值为终态（如 `"Accepted"`、`"Wrong Answer"`、`"Time Limit Exceeded"` 等，排除 `"Uploading"`、`"Running"`、`"Compiling"`、`"Pending"`）：
     * 提取 `submission_id`（若有）或结合当前页面提交时间戳生成唯一键，解析 `status`、`time`、`memory` 上报。
3. **通道 B：DOM `MutationObserver` 兜底监听（极其稳定）**：
   * 监听页面判题结果容器（如 `#submission-status-block` 或 `.submission-status-text`）以及提交记录列表页 `/problem/content/submission/(\d+)/`。
   * 当检测到状态文本从 `"Running..."` / `"Pending..."` 变为 `"Accepted"`（或 `Wrong Answer` 等终态）时：
     * 从该 DOM 块旁边的详情链接提取真实的 `submission_id`（如 `/problem/content/submission/code_detail/(\d+)/`）。
     *若拿到了 `code_detail/{id}`，也可顺带请求一次该详情页或读取已缓存的源码，组装 `UnifiedSubmissionPayload` 上报。

---

### 5.4 Codeforces 适配器 (`codeforces.com` / `mirror.codeforces.com`)

#### 1) 核心链路拆解
Codeforces 为传统多页应用（MPA），提交后会重定向到 `/contest/{cid}/my` 或 `/problemset/status?my=on`。
1. **DOM 状态表格扫描与监听**：
   * 在状态页查找 `<table class="status-frame-datatable">`，只关注属于当前登录用户的行（可通过页面右上角 `.lang-chooser a[href^="/profile/"]` 获取当前用户的 `handle`）。
   * 遍历前 5 行 `<tr data-submission-id="...">`：
     * 找到判题单元格 `<td class="status-cell status-verdict-cell" submissionId="..." waiting="...">`。
     * 如果 `waiting="true"`（正在排队或 Running on test X），对该 `<td>` 挂载 `MutationObserver`（监听 `attributes` 中的 `waiting` 属性变化以及 `childList`/`subtree` 变化）。
     * 一旦 `waiting` 变为 `"false"`（或者初始加载时就已经是 `"false"`）：
       * 提取 `submissionId`（`tr.getAttribute('data-submission-id')`）。
       * 提取 `problemId`（从 `<td data-problemId="...">` 内的 `<a href="/contest/1920/problem/A">` 提取 `"1920A"`）。
       * 判断是否包含 `<span class="verdict-accepted">` $\rightarrow$ `'AC'`；包含 `.verdict-rejected` $\rightarrow$ 根据文本判断 `'WA'` / `'TLE'` / `'MLE'` / `'RE'`；否則 `'CE'`。
       * 提取耗时 `<td class="time-consumed-cell">`（如 `"46 ms"` $\rightarrow$ `46`）与内存 `<td class="memory-consumed-cell">`（如 `"2048 KB"` $\rightarrow$ `2048`）。
       * 触发上报（经本地 `reported_ids` 去重，确保历史旧记录只会在首次扫描时同步一次，不会每次刷新都重复发）。

---

### 5.5 AtCoder 适配器 (`atcoder.jp`)

#### 1) 核心链路拆解
AtCoder 提交后固定重定向至 `https://atcoder.jp/contests/{contestId}/submissions/me`。
1. **方式一：拦截前端自动轮询 JSON**：
   * 当列表中有处于 `WJ`（Waiting for Judge）或评测进度（如 `3/15`）的记录时，AtCoder 前端会定时发起 XHR `GET` 请求：
     `/contests/{contestId}/submissions/me/status/json?reload=true&sids[]={sid}`
   * 响应 JSON 格式示例：
     ```json
     {
       "Result": {
         "51234567": {
           "Html": "<td id=\"judge-status-51234567\" ...><span class=\"label label-success\" ...>AC</span></td><td class=\"text-right submission-score\" ...>300</td><td class=\"text-right\">12 ms</td><td class=\"text-right\">3584 KB</td>",
           "Interval": null
         }
       }
     }
     ```
   * **判题结束标志**：当某个 `sid` 对应的 `Interval === null` 时，说明评测已彻底结束！
   * 解析 `Html` 字符串中的状态标签（`>AC<` $\rightarrow$ `'AC'`）、耗时（`(\d+)\s*ms`）与内存（`(\d+)\s*KB`），并从页面 `<tr data-id="{sid}">`（或对应行）提取题目链接 `/contests/{cid}/tasks/{problemId}`，组装上报。
2. **方式二：秒判题的首屏静态表格兜底**：
   * 有些简单题在页面重定向完成瞬间就已经评测完毕（初始 HTML 里已经是 `AC`，不再发轮询请求）。
   * 因此在 `DOMContentLoaded` 时，扫描 `/submissions/me` 表格的第一行 `tbody tr:first-child`：如果其状态不是 `WJ` 且不在 `reported_ids` 缓存中，直接提取该行的 `submissionId`（来自 `/submissions/(\d+)` 链接）、`problemId`、`verdict`、`time`、`memory` 上报。

---

## 六、 后端接收接口与爬虫异步核实（回退状态机）设计

### 6.1 数据库表结构设计 (`backend-spec/schema.sql`)
后端必须通过联合唯一索引保证幂等性，并通过 `verify_status` 字段实现**“乐观采信 + 爬虫异步核实 + 爬虫失效自动回退”**：

```sql
CREATE TABLE oj_submissions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL COMMENT '系统内部用户ID',
    platform VARCHAR(32) NOT NULL COMMENT 'leetcode_cn | luogu | acwing | codeforces | atcoder',
    platform_submission_id VARCHAR(64) NOT NULL COMMENT 'OJ平台原始提交ID (rid / submission_id)',
    problem_id VARCHAR(64) NOT NULL COMMENT '平台题目编号 (如 P1001, two-sum, 1920A)',
    problem_title VARCHAR(255) DEFAULT NULL COMMENT '题目标题',
    problem_url VARCHAR(512) NOT NULL COMMENT '题目链接',
    verdict VARCHAR(16) NOT NULL COMMENT 'AC | WA | TLE | MLE | RE | CE | PA | OTHER',
    raw_status VARCHAR(64) DEFAULT NULL COMMENT '原始状态描述',
    score INT DEFAULT 100 COMMENT '得分',
    language VARCHAR(32) NOT NULL COMMENT '编程语言',
    source_code MEDIUMTEXT DEFAULT NULL COMMENT '油猴端截获的源代码',
    execution_time_ms INT DEFAULT NULL COMMENT '运行耗时(ms)',
    memory_used_kb INT DEFAULT NULL COMMENT '运行内存(KB)',
    
    -- 核心：核实状态机字段
    verify_status VARCHAR(24) NOT NULL DEFAULT 'OPTIMISTIC' 
        COMMENT 'OPTIMISTIC(油猴上报乐观采信) | VERIFIED(爬虫核实通过) | FALLBACK_TRUSTED(爬虫风控失效回退采信) | REJECTED(核实发现伪造)',
    verify_retry_count INT NOT NULL DEFAULT 0 COMMENT '爬虫核实重试次数',
    verify_error_msg VARCHAR(512) DEFAULT NULL COMMENT '最近一次爬虫核实失败原因(如 403/Captcha)',
    
    submitted_at DATETIME NOT NULL COMMENT '提交时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 核心幂等索引：同一个平台的同一个提交ID全局唯一
    UNIQUE KEY uk_platform_submission (platform, platform_submission_id),
    KEY idx_user_verdict (user_id, verdict, submitted_at),
    KEY idx_verify_status (verify_status, verify_retry_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='OJ提交记录与端云核实表';
```

### 6.2 爬虫异步单点核实与回退状态机逻辑

```
                   [收到油猴 POST /api/v1/submissions/push]
                                      |
                                      v
                  幂等写入 DB: verify_status = 'OPTIMISTIC'
                  (此时前端排行榜/统计面板已将该记录计入有效 AC！)
                                      |
                                      v
                        投递异步延迟核实任务 (延迟 5~10 秒)
                                      |
         +----------------------------+----------------------------+
         |                            |                            |
         v (结果一致)                 v (遇到 403/WAF/验证码/超时)  v (明确返回 404 或状态为 WA/他人的记录)
+--------------------+     +-----------------------------+     +--------------------+
|     'VERIFIED'     |     |   触发回退 (Fallback)       |     |    'REJECTED'      |
|  权威核实通过，结束 |     | retry_count < 3 ?           |     | 判定为伪造，从统计 |
+--------------------+     |  - 是: 指数退避重试 (15m/1h)|     | 看板中剔除该条记录 |
                           |  - 否: 转为                 |     +--------------------+
                           |    'FALLBACK_TRUSTED'       |
                           |    永久采信油猴端上报数据    |
                           +-----------------------------+
```

* **前端查询有效 AC 的 SQL 条件**：
  `WHERE verdict = 'AC' AND verify_status IN ('OPTIMISTIC', 'VERIFIED', 'FALLBACK_TRUSTED')`
* **各平台单点核实（Point-to-Point Verification）的最简方式**：
  1. **Codeforces**：调 `https://codeforces.com/api/user.status?handle={handle}&from=1&count=15`，查找是否存在 `id == platform_submission_id` 且 `verdict == 'OK'`。
  2. **AtCoder**：请求公开页面 `https://atcoder.jp/contests/{contest}/submissions/{sid}`，解析 HTML 表格中的 `Status` 是否为 `AC` 且 `User` 匹配。
  3. **洛谷**：带轻量 Cookie 请求 `https://www.luogu.com.cn/record/{rid}?_contentOnly=1`，核对 `record.user.uid`、`record.problem.pid` 与 `record.status === 12`。若遇到 403 则自动进入 `FALLBACK_TRUSTED`。
  4. **力扣 / AcWing**：由于单条记录详情页大多需要本人登录态 Cookie，若后端未托管用户 Cookie，可直接配置策略将该两平台的油猴上报标记为 `FALLBACK_TRUSTED`，或抽样检查用户的公开个人主页近期通过题目列表（如力扣 GraphQL `recentACSubmissions` 接口无需登录即可查某用户最近 15 道公开 AC 题！）。

---

## 七、 直接发给 AI Agent 的实施指令（Prompt 模板）

> **使用方法**：在 Antigravity 或 Cursor 中，将本文档挂载到上下文（Context）中，然后直接复制下方代码块中的 Prompt 发送给 Agent 即可开始自动化编码。

```markdown
请阅读当前工作区中的《多平台 OJ 提交采集与端云核实系统 — Agent 实施规范说明书》，并严格按照文档规范为我实现完整的油猴插件与后端接收核实模块。

### 执行要求与分步实施计划：

1. **第一步：实现油猴插件核心骨架（支持直接导入 Tampermonkey 的单文件模块化版本 `dist/oj-tracker.user.js` 以及源码工程）**
   - 严格配置 UserScript Header：必须包含 `@run-at document-start`、`@grant unsafeWindow`、`@grant GM_xmlhttpRequest`、`@grant GM_getValue`、`@grant GM_setValue`、`@grant GM_registerMenuCommand`、`@connect *`。
   - 实现 `NetworkHookBus`：挂载在 `unsafeWindow` 上，拦截 `fetch`（务必使用 `response.clone()`，严禁消费原始流）、`XMLHttpRequest.prototype.open/send` 以及 `WebSocket`。同时保存 `rawFetch` 供内部主动轮询使用。
   - 实现 `Storage & Deduplicator`：基于 `GM_getValue` / `GM_setValue` 实现容量为 500 的幂等去重队列（Key 格式为 `${platform}:${submissionId}`），并提供后端 API 地址与个人 Token 的持久化配置。
   - 实现 `Transport`：基于 `GM_xmlhttpRequest` 发送 `UnifiedSubmissionPayload`，包含 3 次指数退避重试及离线失败暂存队列。

2. **第二步：实现五大 OJ 平台适配器（Adapters）**
   - `LeetCodeAdapter` (`leetcode.cn`)：拦截 `/submit/` 缓存源码与语言，拦截 `/submissions/detail/{id}/check/` 及 `/graphql/` 获取最终判题结果，清洗耗时(ms)与内存(KB)。
   - `LuoguAdapter` (`www.luogu.com.cn`)：拦截 `/fe/api/problem/submit/` 及监听 `/record/{rid}` 路由，使用 `rawFetch` 实现端侧主动轮询 `/record/{rid}?_contentOnly=1`（同时兼容解析旧版 `currentData.record` 与新版 `lentille-context`），直到 `status >= 2`。
   - `AcWingAdapter` (`www.acwing.com`)：结合 WebSocket 消息拦截与判题结果区域 DOM `MutationObserver` 双保险提取 AC 状态与源码。
   - `CodeforcesAdapter` (`codeforces.com`)：在 `/my` 与 `/status` 页面利用 `MutationObserver` 监听 `waiting="false"` 变化，提取 `.verdict-accepted`、耗时、内存与 `submissionId`。
   - `AtCoderAdapter` (`atcoder.jp`)：在 `/submissions/me` 页面拦截 `/status/json` 轮询响应（判断 `Interval === null`）并兼顾首屏静态已评测行扫描。

3. **第三步：实现轻量悬浮状态胶囊 UI (`StatusBadge`)**
   - 在 `DOMContentLoaded` 后，使用 `Shadow DOM`（防止与原网页 CSS 样式冲突）在页面右下角渲染一个可折叠的迷你状态指示器：
     - 平时显示当前平台已就绪状态；
     - 捕获到提交判题中显示脉冲动画 `Judging...`；
     - 同步后端成功显示绿色 `Synced ✓`；
     - 点击可展开配置弹窗，方便填写 Backend URL 与 User Token。

4. **第四步：实现后端接收与异步核实状态机接口**
   - 提供数据库建表语句 `schema.sql`。
   - 实现接收接口 `POST /api/v1/submissions/push`（含幂等写入 `OPTIMISTIC` 状态）。
   - 实现后台异步核实 Worker（包含 Codeforces 官方 API 核实、洛谷 `_contentOnly=1` 单点核实、力扣公开 `recentACSubmissions` GraphQL 核实，以及遇到 403/风控时自动流转至 `FALLBACK_TRUSTED` 的回退逻辑）。

请先输出完整的油猴脚本代码（确保没有任何 `TODO` 占位符，所有正则和解析逻辑完整可用），然后再输出后端接收与核实模块代码。
```
