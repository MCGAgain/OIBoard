import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { InterceptedHttpEvent, NetworkHookBus } from '../core/network-hook';
import { pageWindow, Logger } from '../core/sandbox';
import { Storage } from '../core/storage';
import { Transport } from '../core/transport';

interface AcWingPendingSubmission {
  problemId: string;
  problemTitle: string;
  rawPid: string;
  code: string;
  language: string;
  timestamp: number;
  submissionId?: string;
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
    Logger.info('[AcWingAdapter] Initialized with dual WS/DOM + Active Polling pipeline.');

    // 1. 监听 HTTP / XHR 请求 (捕获 POST 请求及可能返回的 JSON)
    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });

    // 2. 监听 WebSocket 下行实时推送
    NetworkHookBus.onWs((url: string, data: string) => {
      this.handleWsMessage(url, data);
    });

    // 3. 监听 WebSocket 上行发送 (实时监控提交行为)
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
            Logger.info('[AcWingAdapter] Real submit button clicked. Capturing editor state...');
            this.captureEditorState();
          }
        }
      },
      true
    );
  }

  /**
   * 鲁棒解析题目编号与标题，覆盖普通题库、打卡活动、分栏、讨论等各类 URL 结构
   */
  private extractProblemInfo(): { problemId: string; problemTitle: string; rawPid: string } {
    const path = window.location.pathname;
    let rawPid = '';

    // 规则 1: /problem/content/(?:xxx/)?(\d+) 或 /activity/problem/content/...
    const m1 = path.match(/(?:problem\/content|activity\/problem\/content)(?:.*?\/)?(\d+)/i);
    if (m1 && m1[1]) {
      rawPid = m1[1];
    }

    // 规则 2: URL 末尾纯数字段
    if (!rawPid) {
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

    const problemId = rawPid ? `acwing_${rawPid}` : 'acwing_unknown';

    // 提取标题
    const titleElem = document.querySelector('.problem-content-title, #problem-title, h1.title, .fs-headline');
    let problemTitle = titleElem ? titleElem.textContent?.trim() || '' : '';
    if (!problemTitle) {
      problemTitle = rawPid ? `AcWing-${rawPid}` : problemId;
    }

    return { problemId, problemTitle, rawPid };
  }

  /**
   * 收集当前 DOM 中已存在的全部 submissionId，防止将历史提交错认为本次提交
   */
  private getAllSubmissionIdsInDom(): string[] {
    const ids: string[] = [];
    try {
      // 检查 submission-result-XXXX
      const resultSpans = document.querySelectorAll('[id*="submission-result-"]');
      resultSpans.forEach((el) => {
        const m = el.id.match(/submission-result-(\d+)/);
        if (m && m[1]) ids.push(m[1]);
      });

      // 检查 code_detail 链接
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
    const EXPIRY_MS = 10 * 60 * 1000; // 10 分钟
    if (Date.now() - this.pendingSubmission.timestamp > EXPIRY_MS) {
      this.pendingSubmission = null;
      return null;
    }
    return this.pendingSubmission;
  }

  /**
   * 捕获编辑器源码与语言，记录旧提交 ID 快照，启动主动轮询看门狗
   */
  private captureEditorState(): void {
    try {
      this.clearPollTimers();

      let code = '';
      let language = 'unknown';

      // 1. 从 Ace Editor 获取
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
            else if (modeId.includes('python')) language = 'Python3';
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

      // 兜底语言
      if (!language || language === 'unknown') {
        const domLang = this.extractLanguageFromDom();
        if (domLang && domLang !== 'unknown') language = domLang;
      }

      const { problemId, problemTitle, rawPid } = this.extractProblemInfo();

      // 快照记录提交前 DOM 里已经存在的提交 ID，防范错位挂载
      this.preExistingSubmissionIds = new Set(this.getAllSubmissionIdsInDom());

      this.pendingSubmission = {
        problemId,
        problemTitle,
        rawPid,
        code,
        language,
        timestamp: Date.now(),
      };

      Logger.info(`[AcWingAdapter] Captured editor state for ${problemId} (${problemTitle}), lang: ${language}, code len: ${code.length}`);
      Transport.notifyStatus('syncing', `AcWing 正在判题: ${problemTitle}...`);

      // 启动主动查询保底轮询（若 WebSocket 在 2.5s、5s、8s、13s 未能送达终态，直接端侧查接口）
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
   * 启动类似 Luogu 的轻量主动轮询，作为 WebSocket 的 100% 可靠保障
   */
  private scheduleActivePolling(rawPid: string): void {
    const delays = [2500, 5000, 8500, 13000];
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
   * 主动查询题目的提交历史列表 (/problem/content/submission/{pid}/)
   * 拥有用户当前网页会话 Cookie，首行即为刚刚判完的真实提交
   */
  private async pollRecentProblemSubmission(rawPid: string): Promise<void> {
    try {
      const fetchFn = NetworkHookBus.rawFetch || fetch;
      const url = `/problem/content/submission/${rawPid}/`;
      const res = await fetchFn(url, {
        method: 'GET',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'include',
      });

      if (res.status === 200) {
        const html = await res.text();
        this.parseSubmissionListHtml(html, rawPid);
      }
    } catch (_) {}
  }

  /**
   * 解析提交列表 HTML，提取首行最新记录
   */
  private parseSubmissionListHtml(html: string, rawPid: string): void {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const rows = doc.querySelectorAll('table tbody tr, table tr');
      if (!rows || rows.length === 0) return;

      const firstRow = rows[0];
      const tds = firstRow.querySelectorAll('td');
      if (tds.length < 3) return;

      // 提取 submission ID
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

      if (!sid || !/^\d+$/.test(sid)) return;

      // 如果这个 ID 恰好是在提交之前就已经存在的旧记录，直接跳过
      if (this.preExistingSubmissionIds.has(sid) || Storage.isDuplicate(this.platform, sid)) {
        return;
      }

      // 提取 verdict
      const statusText = tds[1]?.textContent?.trim() || '';
      const verdict = this.mapStatusStringToVerdict(statusText);
      if (!verdict) return;

      // 提取耗时与内存
      let timeMs = 0;
      let memoryKb = 0;
      const timeStr = tds[2]?.textContent?.trim() || '';
      const tm = timeStr.match(/(\d+)\s*ms/i);
      if (tm) timeMs = parseInt(tm[1], 10);

      const memStr = tds.length >= 4 ? tds[3]?.textContent?.trim() || '' : '';
      const mm = memStr.match(/([\d.]+)\s*(KB|MB)/i);
      if (mm) {
        memoryKb = mm[2].toUpperCase() === 'MB' ? Math.round(parseFloat(mm[1]) * 1024) : Math.round(parseFloat(mm[1]));
      }

      const langStr = tds.length >= 5 ? tds[4]?.textContent?.trim() : undefined;

      Logger.info(`[AcWingAdapter] Successfully extracted latest submission via active poll: ${sid} (${verdict})`);
      this.clearPollTimers();
      this.emitUnifiedSubmission(sid, verdict, statusText, timeMs, memoryKb, langStr);
    } catch (e) {
      Logger.error('[AcWingAdapter] Error parsing submission list HTML:', e);
    }
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    // 拦截 POST 请求
    if (event.method === 'POST') {
      // 1. 从提交请求体提取源码与语言
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

            this.pendingSubmission = {
              problemId: prev?.problemId || problemId,
              problemTitle: prev?.problemTitle || problemTitle,
              rawPid: prev?.rawPid || rawPid,
              code: code || prev?.code || '',
              language: lang || prev?.language || 'unknown',
              timestamp: Date.now(),
              submissionId: prev?.submissionId,
            };
          }
        } catch (_) {}
      }

      // 2. 从 POST 响应提取真实的 submission_id
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
    // 监控上行 WebSocket 是否发送代码
    if (!data) return;
    try {
      if (data.startsWith('{') || data.startsWith('[')) {
        const json = JSON.parse(data);
        if (json.code) {
          Logger.info('[AcWingAdapter] Captured code from outgoing WS frame.');
          const prev = this.getValidPendingSubmission();
          const { problemId, problemTitle, rawPid } = this.extractProblemInfo();
          this.pendingSubmission = {
            problemId: prev?.problemId || problemId,
            problemTitle: prev?.problemTitle || problemTitle,
            rawPid: prev?.rawPid || rawPid,
            code: json.code,
            language: json.language || json.lang || prev?.language || 'unknown',
            timestamp: Date.now(),
            submissionId: prev?.submissionId,
          };
        }
      }
    } catch (_) {}
  }

  private handleWsMessage(url: string, data: string): void {
    if (!data) return;
    // 深度打印收到的 WebSocket 帧，告别黑盒盲猜
    Logger.debug('[AcWingAdapter] Ingoing WS Message:', data.length > 300 ? data.slice(0, 300) + '...' : data);

    // 首先尝试从中抓取并保存任何可能出现的 submissionId
    this.inspectTextForId(data);

    // 检查是否包含终态判题结果
    this.checkTerminalResultInText(data);
  }

  /**
   * 递归检索任何 JSON 对象中的 submission ID，一旦出现立即保存
   */
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

  /**
   * 检查文本是否包含终态，并完成上报
   */
  private checkTerminalResultInText(text: string): void {
    try {
      let statusStr = '';
      let submissionId = '';
      let timeMs = 0;
      let memoryKb = 0;
      let respLang = '';

      if (text.startsWith('{') || text.startsWith('[')) {
        const json = JSON.parse(text);
        statusStr = this.findStatusInObject(json);
        submissionId = this.findIdInObject(json) || '';
        respLang = json.language || json.lang || json.code_language || (json.data && json.data.language) || '';

        const rawTime = json.time ?? json.execution_time ?? (json.data && json.data.time);
        if (rawTime) timeMs = parseInt(String(rawTime), 10) || 0;

        const rawMem = json.memory ?? json.memory_used ?? (json.data && json.data.memory);
        if (rawMem) memoryKb = parseInt(String(rawMem), 10) || 0;
      } else {
        const match = text.match(/"(?:status|result|state)":\s*"([^"]+)"/i);
        if (match) statusStr = match[1];
      }

      if (!statusStr) return;

      const verdict = this.mapStatusStringToVerdict(statusStr);
      if (!verdict) return;

      // 1. 如果当前消息未带 submissionId，使用 pendingSubmission 中捕获的值
      if (!submissionId || !/^\d+$/.test(submissionId)) {
        const pending = this.getValidPendingSubmission();
        if (pending?.submissionId && /^\d+$/.test(pending.submissionId)) {
          submissionId = pending.submissionId;
        }
      }

      // 2. 检查 DOM 中刚生成的新 ID (排除提交前的历史旧 ID)
      if (!submissionId || !/^\d+$/.test(submissionId)) {
        const domSid = this.findNewlyAppearedSubmissionIdFromDom();
        if (domSid && /^\d+$/.test(domSid)) {
          submissionId = domSid;
        }
      }

      // 3. 若尚未捕获到 ID，记录状态并在 1 秒后触发一次主动查询补全
      if (!submissionId || !/^\d+$/.test(submissionId)) {
        Logger.warn(`[AcWingAdapter] Verdict detected (${verdict}) but real submission ID pending. Polling submission API...`);
        const pending = this.getValidPendingSubmission();
        if (pending?.rawPid) {
          setTimeout(() => {
            this.pollRecentProblemSubmission(pending.rawPid);
          }, 800);
        }
        return;
      }

      this.clearPollTimers();
      this.emitUnifiedSubmission(submissionId, verdict, statusStr, timeMs, memoryKb, respLang);
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
   * 扫描页面 DOM 容器中的状态变动
   */
  private scanDomForStatus(): void {
    const statusBlock = document.querySelector(
      '#submit-code-status-block, #submission-status-block, .submission-status-text, #submit_code_result, #run_code_result, .run-code-result, #code_result, [id*="submission-result-"]'
    );
    if (!statusBlock) return;

    const text = statusBlock.textContent?.trim() || '';
    if (!text || text.includes('Running') || text.includes('Pending') || text.includes('Compiling') || text.includes('判题中') || text.includes('排队中') || text.includes('运行中')) {
      return;
    }

    const verdict = this.mapStatusStringToVerdict(text);
    if (!verdict) return;

    let submissionId = '';
    const pending = this.getValidPendingSubmission();
    if (pending?.submissionId && /^\d+$/.test(pending.submissionId)) {
      submissionId = pending.submissionId;
    }

    if (!submissionId) {
      const domSid = this.findNewlyAppearedSubmissionIdFromDom();
      if (domSid && /^\d+$/.test(domSid)) {
        submissionId = domSid;
      }
    }

    // 若无法提取到纯数字真实 ID，且在提交中，则尝试通过接口核实补全
    if (!submissionId || !/^\d+$/.test(submissionId)) {
      if (pending?.rawPid) {
        this.pollRecentProblemSubmission(pending.rawPid);
      }
      return;
    }

    // 提取耗时与内存
    let timeMs = 0;
    let memoryKb = 0;
    const timeMatch = (statusBlock.textContent || document.body.textContent || '').match(/耗时[：:]\s*(\d+)\s*ms/i);
    if (timeMatch) timeMs = parseInt(timeMatch[1], 10);
    const memMatch = (statusBlock.textContent || document.body.textContent || '').match(/内存[：:]\s*([\d.]+)\s*(KB|MB)/i);
    if (memMatch) {
      memoryKb = memMatch[2].toUpperCase() === 'MB' ? Math.round(parseFloat(memMatch[1]) * 1024) : Math.round(parseFloat(memMatch[1]));
    }

    this.clearPollTimers();
    this.emitUnifiedSubmission(submissionId, verdict, text, timeMs, memoryKb);
  }

  /**
   * 仅查找提交之后新出现的 submissionId（严格避开 preExistingSubmissionIds）
   */
  private findNewlyAppearedSubmissionIdFromDom(): string | null {
    try {
      const allCurrent = this.getAllSubmissionIdsInDom();
      for (const id of allCurrent) {
        if (!this.preExistingSubmissionIds.has(id) && !Storage.isDuplicate(this.platform, id)) {
          return id;
        }
      }
    } catch (_) {}
    return null;
  }

  private extractLanguageFromDom(): string {
    try {
      const langSelect = document.querySelector('#code_language, select[name="language"]') as HTMLSelectElement | null;
      if (langSelect) {
        const opt = langSelect.options[langSelect.selectedIndex];
        const val = opt?.text?.trim() || opt?.value?.trim() || langSelect.value?.trim();
        if (val && val !== 'unknown') return val;
      }

      const activeBtn = document.querySelector('.btn-language.active, [data-language].active');
      if (activeBtn) {
        const val = activeBtn.getAttribute('data-language') || activeBtn.textContent?.trim();
        if (val) return val;
      }
    } catch (_) {}
    return 'unknown';
  }

  private emitUnifiedSubmission(
    submissionId: string,
    verdict: VerdictType,
    rawStatus: string,
    timeMs: number,
    memoryKb: number,
    respLang?: string
  ): void {
    if (Storage.isDuplicate(this.platform, submissionId)) return;

    const pending = this.getValidPendingSubmission();
    const { problemId, problemTitle } = this.extractProblemInfo();

    const finalProblemId = pending?.problemId && pending.problemId !== 'acwing_unknown' ? pending.problemId : problemId;
    const finalTitle = pending?.problemTitle && pending.problemTitle !== 'acwing_unknown' ? pending.problemTitle : problemTitle;

    const language = (respLang && respLang !== 'unknown') ? respLang : (pending?.language && pending.language !== 'unknown' ? pending.language : 'C++');

    const payload: UnifiedSubmissionPayload = {
      platform: 'acwing',
      platformSubmissionId: String(submissionId),
      problemId: finalProblemId,
      problemTitle: finalTitle,
      problemUrl: window.location.href,
      platformUserHandle: this.extractUserHandle(),
      verdict,
      rawStatus,
      score: verdict === 'AC' ? 100 : 0,
      language,
      sourceCode: pending?.code || '',
      executionTimeMs: timeMs,
      memoryUsedKb: memoryKb,
      submittedAt: pending?.timestamp || Date.now(),
      clientVersion: '1.0.0',
    };

    // 清理本次提交状态与定时器
    this.pendingSubmission = null;
    this.clearPollTimers();

    Logger.info(`[AcWingAdapter] Submitting verified record to transport: ${submissionId} (${verdict})`);
    this.submitPayload(payload);
  }

  private mapStatusStringToVerdict(status: string): VerdictType | null {
    if (!status) return null;
    const s = String(status).toLowerCase().trim();

    if (s.includes('accepted') || s.includes('通过') || s === 'ac' || s === '0' || s === 'ok') return 'AC';
    if (s.includes('wrong answer') || s.includes('答案错误') || s === 'wa') return 'WA';
    if (s.includes('time limit') || s.includes('时间超限') || s === 'tle') return 'TLE';
    if (s.includes('memory limit') || s.includes('内存超限') || s === 'mle') return 'MLE';
    if (s.includes('runtime error') || s.includes('运行时错误') || s === 're') return 'RE';
    if (s.includes('compile error') || s.includes('编译错误') || s === 'ce') return 'CE';
    return null;
  }

  private extractUserHandle(): string | undefined {
    try {
      const userElem = document.querySelector(
        '#user-menu a[href*="/user/myspace/index/"], a[href*="/user/myspace/index/"], a.navbar-user-name, #navbar-user-name'
      );
      if (userElem) {
        const href = userElem.getAttribute('href') || '';
        const m = href.match(/\/user\/myspace\/index\/(\d+)/);
        if (m && m[1]) return m[1];
        const text = userElem.textContent?.trim();
        if (text && !text.includes('登录') && !text.includes('注册')) return text;
      }
    } catch (_) {}
    return undefined;
  }
}
