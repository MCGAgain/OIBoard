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
}

/**
 * 健壮的同源提交记录 HTML 抓取工具
 * 优先使用当前标签页的原生 XMLHttpRequest，100% 携带 AcWing 登录 Cookie
 */
function fetchSameOriginText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : window.location.origin + url;

    const tryXhr = () => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.withCredentials = true;
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.timeout = 8000;
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 400 && xhr.responseText && xhr.responseText.includes('<table')) {
            resolve(xhr.responseText);
          } else {
            tryFetch();
          }
        };
        xhr.onerror = () => tryFetch();
        xhr.ontimeout = () => tryFetch();
        xhr.send();
      } catch (_) {
        tryFetch();
      }
    };

    const tryFetch = () => {
      fetch(url, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
        .then((r) => r.text())
        .then((txt) => {
          if (txt && txt.includes('<table')) {
            resolve(txt);
          } else {
            tryGm();
          }
        })
        .catch(() => tryGm());
    };

    const tryGm = () => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: fullUrl,
          headers: { 'X-Requested-With': 'XMLHttpRequest', Cookie: document.cookie },
          timeout: 8000,
          onload: (res: any) => resolve(res.responseText || ''),
          onerror: (err: any) => reject(err),
          ontimeout: () => reject(new Error('Timeout')),
        });
      } else {
        reject(new Error('All fetch methods failed'));
      }
    };

    tryXhr();
  });
}

export class AcWingAdapter extends BaseAdapter {
  public readonly platform: PlatformType = 'acwing';
  private pendingSubmission: AcWingPendingSubmission | null = null;
  private observerInitialized = false;
  private pollTimers: any[] = [];
  private lastReportedSid: string | null = null;

  public matchDomain(hostname: string): boolean {
    return hostname === 'www.acwing.com' || hostname === 'acwing.com';
  }

  public init(): void {
    Logger.info('[AcWingAdapter] Initialized (Native DOM Watcher + Safe Polling pipeline).');

    // 1. 监听 DOM 状态变化（#submit-code-status-block 状态文本变动）
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initDomObserver());
    } else {
      this.initDomObserver();
    }

    // 2. 监听代码提交按钮点击
    this.bindSubmitButtonListener();

    // 3. 辅助：拦截 WebSocket 上行发送以捕获最新源码
    NetworkHookBus.onWsSend((url: string, data: string) => {
      this.handleWsSend(url, data);
    });

    // 4. 辅助：监听 HTTP 事件
    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });
  }

  /**
   * 严格过滤并委托监听代码提交按钮：
   * 覆盖 `#submit_code_btn`（AcWing 真实 ID: 提交答案）
   * 排除“自测运行”与“调试”等按钮
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

          // 严格排除自测运行
          if (btnId === 'run_code_btn' || btnText.includes('运行代码') || btnText.includes('自测') || btnText.includes('调试')) {
            return;
          }

          const isSubmitBtn =
            btnId === 'submit_code_btn' ||
            btn.classList.contains('btn-submit-code') ||
            btnText.includes('提交');

          if (isSubmitBtn) {
            Logger.info('[AcWingAdapter] Submit button clicked. Capturing editor state and starting polling pipeline...');
            this.captureEditorState();
          }
        }
      },
      true
    );
  }

  /**
   * 鲁棒解析题目编号与标题
   * 保证 problemId 与后端数据库和爬虫格式 100% 保持一致 (AcWing-xxx)
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
   * 获取有效的 pendingSubmission（未超时且存在）
   */
  private getValidPendingSubmission(): AcWingPendingSubmission | null {
    if (!this.pendingSubmission) return null;
    const EXPIRY_MS = 10 * 60 * 1000;
    if (Date.now() - this.pendingSubmission.timestamp > EXPIRY_MS) {
      this.pendingSubmission = null;
      return null;
    }
    return this.pendingSubmission;
  }

  /**
   * 捕获编辑器源码与语言，启动多阶段轮询管线
   */
  private captureEditorState(): void {
    try {
      this.clearPollTimers();

      let code = '';
      let language = 'C++';

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

      // 从原生下拉选框获取精确语言
      const domLang = this.extractLanguageFromDom();
      if (domLang && domLang !== 'unknown') {
        language = domLang;
      }

      const { problemId, problemTitle, rawPid } = this.extractProblemInfo();
      const userHandle = this.extractUserHandle();

      this.pendingSubmission = {
        problemId,
        problemTitle,
        rawPid,
        code,
        language,
        userHandle,
        timestamp: Date.now(),
      };

      Logger.info(`[AcWingAdapter] Captured state for ${problemId} (${problemTitle}), lang: ${language}, code len: ${code.length}`);
      Transport.notifyStatus('syncing', `AcWing 正在判题: ${problemTitle}...`);

      // 启动主动查询保底轮询（在 1.5s, 3s, 5s, 8s, 12s, 18s 查询提交列表）
      if (rawPid) {
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
   * 提交后的保底轮询
   */
  private scheduleActivePolling(rawPid: string): void {
    const delays = [1500, 3000, 5000, 8000, 12000, 18000];
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
   * 收到终态 DOM 变化后的密集轮询（迅速锁定刚生成的记录 ID）
   */
  private pollSubmissionUntilDone(rawPid: string): void {
    this.clearPollTimers();
    const intervals = [300, 800, 1500, 2800, 4800, 7500];
    for (const delay of intervals) {
      const t = setTimeout(async () => {
        try {
          const html = await fetchSameOriginText(`/problem/content/submission/${rawPid}/`);
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
      const html = await fetchSameOriginText(`/problem/content/submission/${rawPid}/`);
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

      // 3. 本地去重检查：若本条 ID 已在此会话或 Storage 中成功上报过，跳过
      if (this.lastReportedSid === sid || Storage.isDuplicate(this.platform, sid)) {
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

      Logger.info(`[AcWingAdapter] Successfully extracted authentic submission: ${sid} (${verdict}, ${rawStatus})`);
      this.lastReportedSid = sid;
      this.clearPollTimers();
      this.emitUnifiedSubmission(sid, verdict, rawStatus, timeMs, 0, langStr, submittedAtTs);
      return true;
    } catch (e) {
      Logger.error('[AcWingAdapter] Error parsing submission list HTML:', e);
      return false;
    }
  }

  /**
   * 初始化 DOM MutationObserver
   * 紧密监听 #submit-code-status-block 内容更新
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
    if (!statusValElem) return;

    const text = statusValElem.textContent?.trim() || '';
    if (!text) return;

    const upper = text.toUpperCase();
    if (upper === 'UPLOADING' || upper === 'PENDING' || upper === 'JUDGING' || upper === 'RUNNING') {
      return;
    }

    const verdict = this.mapStatusStringToVerdict(text);
    if (!verdict) return;

    // 当页面显示终态（如 Accepted, Wrong Answer 等）时，立刻启动轮询锁定真实提交 ID
    const pending = this.getValidPendingSubmission();
    const rawPid = pending?.rawPid || this.extractProblemInfo().rawPid;
    if (rawPid) {
      this.pollSubmissionUntilDone(rawPid);
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
          };
          Transport.notifyStatus('syncing', `AcWing 正在判题: ${problemTitle}...`);
          if (rawPid) {
            this.scheduleActivePolling(rawPid);
          }
        }
      }
    } catch (_) {}
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    if (event.method === 'POST') {
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
            };
          }
        } catch (_) {}
      }
    }
  }

  private extractLanguageFromDom(): string {
    try {
      const langSelect = document.querySelector(
        '.code_editor_option_language select, select[name="language"], #code_language'
      ) as HTMLSelectElement | null;
      if (langSelect && langSelect.selectedIndex >= 0) {
        const opt = langSelect.options[langSelect.selectedIndex];
        const val = opt?.text?.trim() || opt?.value?.trim() || langSelect.value?.trim();
        if (val && val !== 'unknown') return val;
      }

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
      clientVersion: '1.1.0',
    };

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
