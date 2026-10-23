import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { InterceptedHttpEvent, NetworkHookBus } from '../core/network-hook';
import { pageWindow, Logger } from '../core/sandbox';
import { Storage } from '../core/storage';
import { Transport } from '../core/transport';

declare function GM_xmlhttpRequest(details: any): void;

interface AcWingPendingSubmission {
  problemId: string;
  problemTitle: string;
  rawPid: string;
  code: string;
  language: string;
  userHandle?: string;
  timestamp: number;
  submissionId?: string;
}

/**
 * 通用跨域/沙箱安全文本拉取工具
 * 优先使用 GM_xmlhttpRequest，绕过页面 CSP 与 fetch 跨上下文 Illegal invocation 限制
 */
function fetchUrlText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: 'GET',
        url: fullUrl,
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        timeout: 10000,
        onload: (res: any) => {
          if (res.status >= 200 && res.status < 400) {
            resolve(res.responseText || '');
          } else {
            reject(new Error(`HTTP ${res.status}`));
          }
        },
        onerror: (err: any) => reject(err),
        ontimeout: () => reject(new Error('Timeout')),
      });
    } else {
      fetch(fullUrl, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then((r) => r.text())
        .then(resolve)
        .catch(reject);
    }
  });
}

export class AcWingAdapter extends BaseAdapter {
  public readonly platform: PlatformType = 'acwing';
  private pendingSubmission: AcWingPendingSubmission | null = null;
  private observerInitialized = false;
  private preExistingSubmissionIds: Set<string> = new Set();
  private pollTimers: any[] = [];

  public matchDomain(hostname: string): boolean {
    return hostname === 'www.acwing.com' || hostname === 'acwing.com';
  }

  public init(): void {
    Logger.info('[AcWingAdapter] Initialized with 4-way redundant detection (Native Hook + WS + DOM + Active Poll).');

    // 0. 直接劫持 AcWing 全局状态分发函数 handle_problem_submit_code_status
    this.hookNativeAcWingHandler();

    // 1. 监听 HTTP / XHR 请求 (捕获 POST 请求及可能返回的 JSON)
    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });

    // 2. 监听 WebSocket 下行实时推送
    NetworkHookBus.onWs((url: string, data: string) => {
      this.handleWsMessage(url, data);
    });

    // 3. 监听 WebSocket 上行发送 (实时监控提交行为并捕获源码)
    NetworkHookBus.onWsSend((url: string, data: string) => {
      this.handleWsSend(url, data);
    });

    // 4. DOM MutationObserver 实时监听
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initDomObserver());
    } else {
      this.initDomObserver();
    }

    // 5. 监听代码提交按钮点击
    this.bindSubmitButtonListener();
  }

  /**
   * 劫持 AcWing 原生 handle_problem_submit_code_status 函数
   * AcWing 在 WebSocket 收到判题结果时会直接调用该全局函数
   */
  private hookNativeAcWingHandler(): void {
    const wrapHandler = (targetFunc: Function) => {
      const wrapped = (data: any) => {
        try {
          Logger.info('[AcWingAdapter] Intercepted native handle_problem_submit_code_status payload:', data);
          if (data && data.status) {
            this.onNativeStatusReceived(data.status, data);
          }
        } catch (e) {
          Logger.error('[AcWingAdapter] Error in hooked handle_problem_submit_code_status:', e);
        }
        return targetFunc.apply(pageWindow, [data]);
      };
      (wrapped as any).__oj_hooked = true;
      return wrapped;
    };

    // 1. 立即检查并挂载
    const current = (pageWindow as any).handle_problem_submit_code_status;
    if (typeof current === 'function' && !(current as any).__oj_hooked) {
      (pageWindow as any).handle_problem_submit_code_status = wrapHandler(current);
      Logger.info('[AcWingAdapter] Hooked existing handle_problem_submit_code_status.');
    }

    // 2. 利用 setter 拦截后续脚本 (如 debug_code.js) 的赋值覆盖
    try {
      let storedFunc = (pageWindow as any).handle_problem_submit_code_status;
      Object.defineProperty(pageWindow, 'handle_problem_submit_code_status', {
        configurable: true,
        enumerable: true,
        get: () => storedFunc,
        set: (newFunc) => {
          if (typeof newFunc === 'function' && !(newFunc as any).__oj_hooked) {
            Logger.info('[AcWingAdapter] Setter intercepted handle_problem_submit_code_status definition.');
            storedFunc = wrapHandler(newFunc);
          } else {
            storedFunc = newFunc;
          }
        },
      });
    } catch (_) {}
  }

  /**
   * 原生状态回调触发终态响应
   */
  private onNativeStatusReceived(status: string, data?: any): void {
    const upper = String(status).toUpperCase();
    if (upper === 'UPLOADING' || upper === 'PENDING' || upper === 'JUDGING' || upper === 'RUNNING') {
      Logger.info(`[AcWingAdapter] Native status update: ${status}`);
      return;
    }

    const verdict = this.mapStatusStringToVerdict(status);
    if (!verdict) return;

    Logger.info(`[AcWingAdapter] Native terminal status reached: ${status} -> ${verdict}`);
    Transport.notifyStatus('syncing', `AcWing 评测完成 (${status})，正在获取真实提交编号...`);

    const pending = this.getValidPendingSubmission();
    const rawPid = pending?.rawPid || this.extractProblemInfo().rawPid;
    if (rawPid) {
      this.pollSubmissionUntilDone(rawPid);
    }
  }

  /**
   * 严格过滤提交按钮：
   * 仅匹配 `#submit_code_btn`、`.btn-submit-code` 或文案为“提交代码”的按钮
   * 严禁匹配“运行代码”、“自测运行”或常规搜索/登录表单提交按钮
   */
  private bindSubmitButtonListener(): void {
    document.addEventListener(
      'click',
      (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const btn = target.closest('#submit_code_btn, .btn-submit-code, button, a.btn');
        if (btn) {
          const btnId = btn.id || '';
          const btnText = btn.textContent?.trim() || '';

          // 排除自测运行、重置等按钮
          if (btnId === 'run_code_btn' || btnText.includes('运行代码') || btnText.includes('自测') || btnText.includes('调试')) {
            return;
          }

          const isSubmitBtn =
            btnId === 'submit_code_btn' ||
            btn.classList.contains('btn-submit-code') ||
            (btnText.includes('提交') && (btnText.includes('代码') || btnText === '提交'));

          if (isSubmitBtn) {
            Logger.info('[AcWingAdapter] Submit button clicked. Capturing editor state and pre-existing IDs...');
            this.captureEditorState();
          }
        }
      },
      true
    );
  }

  /**
   * 鲁棒解析题目编号与标题，覆盖普通题库、打卡活动、分栏、讨论等各类 URL 结构
   * 严格保证 problemId 与后端数据库和爬虫格式 100% 保持一致 (AcWing-xxx)
   */
  private extractProblemInfo(): { problemId: string; problemTitle: string; rawPid: string } {
    let rawPid = '';

    // 0. 优先从全局变量 PROBLEM_ID 获取 (AcWing 题目页均挂载了此变量)
    const pageProblemId = (pageWindow as any).PROBLEM_ID;
    if (pageProblemId && /^\d+$/.test(String(pageProblemId))) {
      rawPid = String(pageProblemId);
    }

    // 规则 1: /problem/content/(?:xxx/)?(\d+) 或 /activity/problem/content/...
    if (!rawPid) {
      const path = window.location.pathname;
      const m1 = path.match(/(?:problem\/content|activity\/problem\/content)(?:.*?\/)?(\d+)/i);
      if (m1 && m1[1]) {
        rawPid = m1[1];
      }
    }

    // 规则 2: URL 末尾纯数字段
    if (!rawPid) {
      const path = window.location.pathname;
      const m2 = path.match(/\/(\d+)\/?(?:[?#]|$)/);
      if (m2 && m2[1]) {
        rawPid = m2[1];
      }
    }

    // 规则 3: 页面 DOM 属性
    if (!rawPid) {
      const pidElem = document.querySelector('[data-problem-id]');
      if (pidElem) {
        rawPid = pidElem.getAttribute('data-problem-id') || '';
      }
    }

    // 题目 ID 与爬虫标准保持 100% 一致：AcWing-{rawPid}
    const problemId = rawPid ? `AcWing-${rawPid}` : 'AcWing-unknown';

    // 提取标题：优先 .problem-content-title
    const titleElem = document.querySelector('.problem-content-title, #problem-title, h1.title, .fs-headline');
    let problemTitle = titleElem ? titleElem.textContent?.trim() || '' : '';
    if (!problemTitle) {
      problemTitle = rawPid ? `AcWing-${rawPid}` : problemId;
    }

    return { problemId, problemTitle, rawPid };
  }

  /**
   * 收集当前 DOM 中已存在的全部 submissionId
   */
  private getAllSubmissionIdsInDom(): string[] {
    const ids: string[] = [];
    try {
      const resultSpans = document.querySelectorAll('[id*="submission-result-"]');
      resultSpans.forEach((el) => {
        const m = el.id.match(/submission-result-(\d+)/);
        if (m && m[1]) ids.push(m[1]);
      });

      const links = document.querySelectorAll('a[href*="/code_detail/"]');
      links.forEach((a) => {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/code_detail\/(\d+)/);
        if (m && m[1]) ids.push(m[1]);
      });
    } catch (_) {}
    return ids;
  }

  /**
   * 获取有效的 pendingSubmission（未超时且存在）
   */
  private getValidPendingSubmission(): AcWingPendingSubmission | null {
    if (!this.pendingSubmission) return null;
    const EXPIRY_MS = 10 * 60 * 1000; // 10 分钟有效期
    if (Date.now() - this.pendingSubmission.timestamp > EXPIRY_MS) {
      this.pendingSubmission = null;
      return null;
    }
    return this.pendingSubmission;
  }

  /**
   * 捕获编辑器源码与语言，快照记录提交前状态，启动轮询看门狗
   */
  private captureEditorState(): void {
    try {
      this.clearPollTimers();

      let code = '';
      let language = 'unknown';

      // 1. 从 Ace Editor 获取源码
      const ace = (pageWindow as any).ace;
      if (ace && typeof ace.edit === 'function') {
        const editor = ace.edit('code_editor') || ace.edit(document.querySelector('#code_editor'));
        if (editor) {
          if (typeof editor.getValue === 'function') {
            code = editor.getValue();
          }
          if (editor.getSession) {
            const modeId = editor.getSession().getMode()?.$id || '';
            if (modeId.includes('c_cpp')) language = 'C++';
            else if (modeId.includes('python')) language = 'Python 3';
            else if (modeId.includes('java')) language = 'Java';
            else if (modeId.includes('golang')) language = 'Go';
            else if (modeId.includes('rust')) language = 'Rust';
            else if (modeId.includes('javascript')) language = 'JavaScript';
          }
        }
      }

      // 兜底从 textarea
      if (!code) {
        const textarea = document.querySelector('#code_editor textarea, textarea[name="code"]') as HTMLTextAreaElement | null;
        if (textarea && textarea.value) code = textarea.value;
      }

      // 从页面原生下拉选框获取精确语言
      if (!language || language === 'unknown') {
        language = this.extractLanguageFromDom();
      }

      const { problemId, problemTitle, rawPid } = this.extractProblemInfo();
      const userHandle = this.extractUserHandle();

      // 快照记录提交前 DOM 里的历史 ID
      this.preExistingSubmissionIds = new Set(this.getAllSubmissionIdsInDom());

      this.pendingSubmission = {
        problemId,
        problemTitle,
        rawPid,
        code,
        language,
        userHandle,
        timestamp: Date.now(),
      };

      Logger.info(`[AcWingAdapter] Captured editor state for ${problemId} (${problemTitle}), lang: ${language}, code len: ${code.length}`);
      Transport.notifyStatus('syncing', `AcWing 正在判题: ${problemTitle}...`);

      // 提交时同时尝试快照记录当前第一条提交 ID，以防后续轮询串号
      if (rawPid) {
        fetchUrlText(`/problem/content/submission/${rawPid}/`)
          .then((html) => {
            const m = html.match(/\/code_detail\/(\d+)\//) || html.match(/id=['"]submission-result-(\d+)['"]/);
            if (m && m[1]) {
              this.preExistingSubmissionIds.add(m[1]);
              Logger.info(`[AcWingAdapter] Snapshotted existing latest submission ID before submit: ${m[1]}`);
            }
          })
          .catch(() => {});

        // 启动兜底轮询
        this.scheduleActivePolling(rawPid);
      }
    } catch (e) {
      Logger.error('[AcWingAdapter] Error capturing editor state:', e);
    }
  }

  private clearPollTimers(): void {
    for (const t of this.pollTimers) {
      clearTimeout(t);
    }
    this.pollTimers = [];
  }

  /**
   * 启动保底轮询（在 2s、4s、7s、11s、16s 查询提交列表）
   */
  private scheduleActivePolling(rawPid: string): void {
    const delays = [2000, 4000, 7000, 11000, 16000];
    for (const d of delays) {
      const t = setTimeout(() => {
        if (this.pendingSubmission && this.pendingSubmission.rawPid === rawPid) {
          this.pollRecentProblemSubmission(rawPid);
        }
      }, d);
      this.pollTimers.push(t);
    }
  }

  /**
   * 判题终态后密集轮询提交记录直至获取成功
   */
  private pollSubmissionUntilDone(rawPid: string): void {
    this.clearPollTimers();
    const intervals = [300, 900, 1800, 3200, 5500, 8500];
    for (const delay of intervals) {
      const t = setTimeout(async () => {
        try {
          const html = await fetchUrlText(`/problem/content/submission/${rawPid}/`);
          const done = this.parseSubmissionListHtml(html, rawPid);
          if (done) {
            this.clearPollTimers();
          }
        } catch (_) {}
      }, delay);
      this.pollTimers.push(t);
    }
  }

  /**
   * 主动查询题目的提交历史列表 (/problem/content/submission/{pid}/)
   */
  private async pollRecentProblemSubmission(rawPid: string): Promise<void> {
    try {
      const html = await fetchUrlText(`/problem/content/submission/${rawPid}/`);
      if (html) {
        this.parseSubmissionListHtml(html, rawPid);
      }
    } catch (_) {}
  }

  /**
   * 解析提交列表 HTML，提取首行最新真实记录
   */
  private parseSubmissionListHtml(html: string, rawPid: string): boolean {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const rows = doc.querySelectorAll('table tbody tr, table tr');
      if (!rows || rows.length === 0) return false;

      const firstRow = rows[0];
      const tds = firstRow.querySelectorAll('td');
      if (tds.length < 4) return false;

      // 1. 提取真实 submission ID
      let sid = '';
      const codeLink = firstRow.querySelector("a[href*='code_detail'], a[href*='submission']");
      if (codeLink) {
        const m = codeLink.getAttribute('href')?.match(/code_detail\/(\d+)/);
        if (m) sid = m[1];
      }
      if (!sid) {
        const resSpan = firstRow.querySelector("[id*='submission-result-']");
        if (resSpan) {
          const m = resSpan.id.match(/submission-result-(\d+)/);
          if (m) sid = m[1];
        }
      }

      if (!sid || !/^\d+$/.test(sid)) return false;

      // 2. 提取判题结果状态 (优先从 span 获取，剔除 script 标签内容)
      let rawStatus = '';
      const resSpan = firstRow.querySelector("[id*='submission-result-']");
      if (resSpan) {
        rawStatus = resSpan.textContent?.trim() || '';
      }
      if (!rawStatus) {
        const tdClone = tds[1].cloneNode(true) as HTMLElement;
        tdClone.querySelectorAll('script').forEach((s) => s.remove());
        rawStatus = tdClone.textContent?.trim() || '';
      }

      // 若仍处于评测中状态，告知轮询继续
      const upperStatus = rawStatus.toUpperCase();
      if (upperStatus === 'UPLOADING' || upperStatus === 'PENDING' || upperStatus === 'JUDGING' || upperStatus === 'RUNNING') {
        Logger.info(`[AcWingAdapter] Submission ${sid} is still judging (${rawStatus}). Waiting...`);
        return false;
      }

      const verdict = this.mapStatusStringToVerdict(rawStatus);
      if (!verdict) return false;

      // 3. 避免将提交前已存在的旧记录错认
      if (this.preExistingSubmissionIds.has(sid) || Storage.isDuplicate(this.platform, sid)) {
        return false;
      }

      // 4. 提取耗时 (第 2 列: tds[2])
      let timeMs = 0;
      const timeStr = tds[2]?.textContent?.trim() || '';
      const tm = timeStr.match(/(\d+)\s*ms/i);
      if (tm) timeMs = parseInt(tm[1], 10);

      // 5. 提取语言 (第 3 列: tds[3])
      let langStr = tds[3]?.textContent?.trim() || '';
      if (!langStr || langStr === 'N/A') {
        langStr = this.pendingSubmission?.language || 'C++';
      }

      // 6. 提取官方精准北京时间 (第 0 列: tds[0] 的 span[title])
      let submittedAtTs: number | undefined;
      const timeSpan = tds[0].querySelector('span[title]');
      const titleTime = timeSpan?.getAttribute('title')?.trim();
      if (titleTime) {
        const d = new Date(titleTime.replace(/-/g, '/'));
        if (!isNaN(d.getTime())) {
          submittedAtTs = d.getTime();
        }
      }

      Logger.info(`[AcWingAdapter] Successfully extracted authentic submission: ${sid} (${verdict})`);
      this.clearPollTimers();
      this.emitUnifiedSubmission(sid, verdict, rawStatus, timeMs, 0, langStr, submittedAtTs);
      return true;
    } catch (e) {
      Logger.error('[AcWingAdapter] Error parsing submission list HTML:', e);
      return false;
    }
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    if (event.method === 'POST') {
      // 1. 从 POST 请求体中提取源码与语言
      if (event.requestBody && typeof event.requestBody === 'string') {
        try {
          let code: string | null = null;
          let lang: string | null = null;

          if (event.requestBody.startsWith('{') || event.requestBody.startsWith('[')) {
            const json = JSON.parse(event.requestBody);
            code = json.code || null;
            lang = json.language || json.lang || null;
          } else {
            const params = new URLSearchParams(event.requestBody);
            code = params.get('code');
            lang = params.get('language');
          }

          if (code || lang) {
            const prev = this.getValidPendingSubmission();
            const { problemId, problemTitle, rawPid } = this.extractProblemInfo();
            const userHandle = this.extractUserHandle();

            this.pendingSubmission = {
              problemId: prev?.problemId || problemId,
              problemTitle: prev?.problemTitle || problemTitle,
              rawPid: prev?.rawPid || rawPid,
              code: code || prev?.code || '',
              language: lang || prev?.language || 'C++',
              userHandle: prev?.userHandle || userHandle,
              timestamp: Date.now(),
              submissionId: prev?.submissionId,
            };
          }
        } catch (_) {}
      }

      // 2. 从 POST 响应体中检索可能返回的 submissionId
      if (event.responseText) {
        this.inspectTextForId(event.responseText);
      }
    }

    // 检查 XHR 响应中是否包含判题终态
    if (event.responseText && (event.url.includes('/submission') || event.url.includes('/wss/'))) {
      this.checkTerminalResultInText(event.responseText);
    }
  }

  private handleWsSend(url: string, data: string): void {
    if (!data) return;
    try {
      if (data.startsWith('{') || data.startsWith('[')) {
        const json = JSON.parse(data);
        if (json.activity === 'problem_submit_code' || json.code) {
          Logger.info('[AcWingAdapter] Captured code from outgoing WebSocket frame.');
          const prev = this.getValidPendingSubmission();
          const { problemId, problemTitle, rawPid } = this.extractProblemInfo();
          const userHandle = this.extractUserHandle();

          this.pendingSubmission = {
            problemId: prev?.problemId || problemId,
            problemTitle: prev?.problemTitle || problemTitle,
            rawPid: prev?.rawPid || rawPid,
            code: json.code || prev?.code || '',
            language: json.language || json.lang || prev?.language || 'C++',
            userHandle: prev?.userHandle || userHandle,
            timestamp: Date.now(),
            submissionId: prev?.submissionId,
          };
        }
      }
    } catch (_) {}
  }

  private handleWsMessage(url: string, data: string): void {
    if (!data) return;
    Logger.debug('[AcWingAdapter] Ingoing WS Message:', data.length > 200 ? data.slice(0, 200) + '...' : data);

    this.inspectTextForId(data);
    this.checkTerminalResultInText(data);
  }

  private inspectTextForId(text: string): void {
    try {
      if (text.startsWith('{') || text.startsWith('[')) {
        const json = JSON.parse(text);
        const sid = this.findIdInObject(json);
        if (sid && /^\d+$/.test(sid)) {
          if (this.pendingSubmission) {
            this.pendingSubmission.submissionId = sid;
          }
          Logger.info(`[AcWingAdapter] Captured real submissionId: ${sid}`);
        }
      } else {
        const m = text.match(/"(?:submission_id|record_id|sub_id|rid)":\s*(\d+)/i);
        if (m && m[1]) {
          if (this.pendingSubmission) {
            this.pendingSubmission.submissionId = m[1];
          }
        }
      }
    } catch (_) {}
  }

  private findIdInObject(obj: any): string | null {
    if (!obj || typeof obj !== 'object') return null;

    const candidateKeys = ['submission_id', 'submissionId', 'record_id', 'recordId', 'sub_id', 'subId', 'rid', 'id', 'sub_record_id'];
    for (const k of candidateKeys) {
      if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
        const val = String(obj[k]).trim();
        if (/^\d+$/.test(val)) return val;
      }
    }

    if (obj.data && typeof obj.data === 'object') {
      const sid = this.findIdInObject(obj.data);
      if (sid) return sid;
    }
    if (obj.result && typeof obj.result === 'object') {
      const sid = this.findIdInObject(obj.result);
      if (sid) return sid;
    }
    return null;
  }

  private checkTerminalResultInText(text: string): void {
    try {
      let statusStr = '';
      let submissionId = '';
      let timeMs = 0;
      let respLang = '';

      if (text.startsWith('{') || text.startsWith('[')) {
        const json = JSON.parse(text);
        statusStr = this.findStatusInObject(json);
        submissionId = this.findIdInObject(json) || '';
        respLang = json.language || json.lang || json.code_language || (json.data && json.data.language) || '';

        const rawTime = json.time ?? json.execution_time ?? (json.data && json.data.time);
        if (rawTime) timeMs = parseInt(String(rawTime), 10) || 0;
      } else {
        const match = text.match(/"(?:status|result|state)":\s*"([^"]+)"/i);
        if (match) statusStr = match[1];
      }

      if (!statusStr) return;

      const upper = statusStr.toUpperCase();
      if (upper === 'UPLOADING' || upper === 'PENDING' || upper === 'JUDGING' || upper === 'RUNNING') {
        return;
      }

      const verdict = this.mapStatusStringToVerdict(statusStr);
      if (!verdict) return;

      // 若未直接获得真实 submissionId，通过主动查询接口获取
      if (!submissionId || !/^\d+$/.test(submissionId)) {
        const pending = this.getValidPendingSubmission();
        const rawPid = pending?.rawPid || this.extractProblemInfo().rawPid;
        if (rawPid) {
          this.pollSubmissionUntilDone(rawPid);
        }
        return;
      }

      this.clearPollTimers();
      this.emitUnifiedSubmission(submissionId, verdict, statusStr, timeMs, 0, respLang);
    } catch (_) {}
  }

  private findStatusInObject(obj: any): string {
    if (!obj || typeof obj !== 'object') return '';
    if (typeof obj.status === 'string') return obj.status;
    if (typeof obj.result === 'string') return obj.result;
    if (typeof obj.state === 'string') return obj.state;
    if (typeof obj.verdict === 'string') return obj.verdict;

    if (obj.data && typeof obj.data === 'object') {
      return this.findStatusInObject(obj.data);
    }
    return '';
  }

  /**
   * 初始化 DOM MutationObserver
   */
  private initDomObserver(): void {
    if (this.observerInitialized) return;
    this.observerInitialized = true;

    const observer = new MutationObserver(() => {
      this.scanDomForStatus();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    Logger.info('[AcWingAdapter] DOM MutationObserver started.');
  }

  /**
   * 扫描页面 DOM 容器中的状态变动 (#submit-code-status-block)
   */
  private scanDomForStatus(): void {
    const statusValElem = document.querySelector('#submit-code-status-value-id');
    const loadingGif = document.querySelector('#submit-code-status-loading-gif-id') as HTMLElement | null;
    if (!statusValElem) return;

    // 若加载图标仍显示，说明判题未结束
    if (loadingGif && loadingGif.style.display !== 'none' && !loadingGif.hidden) {
      return;
    }

    const text = statusValElem.textContent?.trim() || '';
    if (!text) return;

    const upper = text.toUpperCase();
    if (upper === 'UPLOADING' || upper === 'PENDING' || upper === 'JUDGING' || upper === 'RUNNING') {
      return;
    }

    const verdict = this.mapStatusStringToVerdict(text);
    if (!verdict) return;

    const pending = this.getValidPendingSubmission();
    const rawPid = pending?.rawPid || this.extractProblemInfo().rawPid;
    if (rawPid) {
      this.pollSubmissionUntilDone(rawPid);
    }
  }

  private extractLanguageFromDom(): string {
    try {
      // 1. 真实下拉选框
      const langSelect = document.querySelector(
        '.code_editor_option_language select, select[name="language"], #code_language'
      ) as HTMLSelectElement | null;
      if (langSelect && langSelect.selectedIndex >= 0) {
        const opt = langSelect.options[langSelect.selectedIndex];
        const val = opt?.text?.trim() || opt?.value?.trim() || langSelect.value?.trim();
        if (val && val !== 'unknown') return val;
      }

      // 2. Ace editor session mode
      const ace = (pageWindow as any).ace;
      if (ace && typeof ace.edit === 'function') {
        const editor = ace.edit('code_editor') || ace.edit(document.querySelector('#code_editor'));
        if (editor && editor.getSession) {
          const modeId = editor.getSession().getMode()?.$id || '';
          if (modeId.includes('c_cpp')) return 'C++';
          if (modeId.includes('python')) return 'Python 3';
          if (modeId.includes('java')) return 'Java';
          if (modeId.includes('golang')) return 'Go';
          if (modeId.includes('rust')) return 'Rust';
          if (modeId.includes('javascript')) return 'JavaScript';
        }
      }
    } catch (_) {}
    return 'C++';
  }

  private emitUnifiedSubmission(
    submissionId: string,
    verdict: VerdictType,
    rawStatus: string,
    timeMs: number,
    memoryKb: number,
    respLang?: string,
    submittedAtTs?: number
  ): void {
    if (Storage.isDuplicate(this.platform, submissionId)) return;

    const pending = this.getValidPendingSubmission();
    const { problemId, problemTitle } = this.extractProblemInfo();

    const finalProblemId = pending?.problemId && pending.problemId !== 'AcWing-unknown' ? pending.problemId : problemId;
    const finalTitle = pending?.problemTitle && pending.problemTitle !== 'AcWing-unknown' ? pending.problemTitle : problemTitle;

    const language =
      respLang && respLang !== 'unknown' && respLang !== 'N/A'
        ? respLang
        : pending?.language && pending.language !== 'unknown'
        ? pending.language
        : 'C++';

    const userHandle = pending?.userHandle || this.extractUserHandle();

    const payload: UnifiedSubmissionPayload = {
      platform: 'acwing',
      platformSubmissionId: String(submissionId),
      problemId: finalProblemId,
      problemTitle: finalTitle,
      problemUrl: window.location.href,
      platformUserHandle: userHandle,
      verdict,
      rawStatus,
      score: verdict === 'AC' ? 100 : 0,
      language,
      sourceCode: pending?.code || '',
      executionTimeMs: timeMs,
      memoryUsedKb: memoryKb,
      submittedAt: submittedAtTs || pending?.timestamp || Date.now(),
      clientVersion: '1.0.0',
    };

    // 清理本次提交状态与定时器
    this.pendingSubmission = null;
    this.clearPollTimers();

    Logger.info(`[AcWingAdapter] Submitting verified record to transport: ${submissionId} (${verdict})`);
    this.submitPayload(payload);
  }

  /**
   * 健全规范化判题状态映射
   * 兼容 AcWing 原生大写下划线、带空格以及中文别名
   */
  private mapStatusStringToVerdict(status: string): VerdictType | null {
    if (!status) return null;
    const s = String(status).toUpperCase().replace(/\s+/g, '_').trim();

    if (s.includes('ACCEPTED') || s === 'AC' || s.includes('通过') || s === 'OK') return 'AC';
    if (s.includes('WRONG_ANSWER') || s === 'WA' || s.includes('答案错误')) return 'WA';
    if (s.includes('TIME_LIMIT') || s === 'TLE' || s.includes('超时') || s.includes('时间超限')) return 'TLE';
    if (s.includes('MEMORY_LIMIT') || s === 'MLE' || s.includes('内存超限')) return 'MLE';
    if (
      s.includes('RUNTIME_ERROR') ||
      s.includes('SEGMENTATION_FAULT') ||
      s.includes('FLOAT_POINT') ||
      s.includes('NON_ZERO') ||
      s === 'RE' ||
      s.includes('运行错误') ||
      s.includes('运行时错误')
    ) {
      return 'RE';
    }
    if (s.includes('COMPILE_ERROR') || s === 'CE' || s.includes('编译错误')) return 'CE';
    if (s.includes('OUTPUT_LIMIT') || s === 'OLE' || s.includes('输出超限')) return 'OLE';
    if (s.includes('PRESENTATION_ERROR') || s === 'PE' || s.includes('格式错误')) return 'PE';
    return null;
  }

  private extractUserHandle(): string | undefined {
    try {
      // 0. 优先从全局 user_state 获取 (AcWing 原生挂载)
      const ustate = (pageWindow as any).user_state;
      if (ustate && ustate.user_id) {
        return String(ustate.user_id);
      }

      // 1. 从导航栏用户个人空间链接提取 /user/myspace/index/{uid}/
      const userElem = document.querySelector(
        '#user-menu a[href*="/user/myspace/index/"], a[href*="/user/myspace/index/"], a.navbar-user-name, #navbar-user-name'
      );
      if (userElem) {
        const href = userElem.getAttribute('href') || '';
        const m = href.match(/\/user\/myspace\/index\/(\d+)/);
        if (m && m[1]) {
          return m[1]; // 返回 AcWing 数字 UID
        }
        const text = userElem.textContent?.trim();
        if (text && !text.includes('登录') && !text.includes('注册')) {
          return text;
        }
      }
    } catch (_) {}
    return undefined;
  }
}
