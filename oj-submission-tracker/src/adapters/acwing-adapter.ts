import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { InterceptedHttpEvent, NetworkHookBus } from '../core/network-hook';
import { pageWindow, Logger } from '../core/sandbox';
import { Storage } from '../core/storage';
import { Transport } from '../core/transport';

interface AcWingPendingSubmission {
  problemId: string;
  problemTitle: string;
  code: string;
  language: string;
  timestamp: number;
  submissionId?: string;
}

export class AcWingAdapter extends BaseAdapter {
  public readonly platform: PlatformType = 'acwing';
  private pendingSubmission: AcWingPendingSubmission | null = null;
  private observerInitialized = false;

  public matchDomain(hostname: string): boolean {
    return hostname === 'www.acwing.com' || hostname === 'acwing.com';
  }

  public init(): void {
    Logger.info('[AcWingAdapter] Initialized.');

    // 通道 A-1: 监听 HTTP / XHR 请求
    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });

    // 通道 A-2: 监听 WebSocket 实时推送
    NetworkHookBus.onWs((url: string, data: string) => {
      this.handleWsMessage(url, data);
    });

    // 通道 B: DOM MutationObserver 兜底
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initDomObserver());
    } else {
      this.initDomObserver();
    }

    // 监听代码提交按钮点击（事件委托）以捕获源码与语言
    this.bindSubmitButtonListener();
  }

  /**
   * 使用事件委托监听提交按钮点击，不依赖 DOM 加载时的按钮存在
   */
  private bindSubmitButtonListener(): void {
    document.addEventListener('click', (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const btn = target.closest('#submit_code_btn, button.btn-run, button[type="submit"], .btn-submit-code, button:has(.fa-send)');
      if (btn) {
        Logger.info('[AcWingAdapter] Submit button clicked (delegated). Capturing editor state...');
        this.captureEditorState();
      }
    }, true);
  }

  /**
   * 获取有效的 pendingSubmission（超过 10 分钟自动过期抛弃，防止数据串线）
   */
  private getValidPendingSubmission(): AcWingPendingSubmission | null {
    if (!this.pendingSubmission) return null;
    const EXPIRY_MS = 10 * 60 * 1000; // 10 分钟过期
    if (Date.now() - this.pendingSubmission.timestamp > EXPIRY_MS) {
      Logger.warn('[AcWingAdapter] Pending submission expired (>10min), discarding.');
      this.pendingSubmission = null;
      return null;
    }
    return this.pendingSubmission;
  }

  /**
   * 从 Ace Editor 或页面 DOM 中截获代码与语言
   */
  private captureEditorState(): void {
    try {
      let code = '';
      let language = 'unknown';

      // 1. 尝试从 Ace Editor 获取代码与语言模式
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

      if (!code) {
        const textarea = document.querySelector('#code_editor textarea, textarea[name="code"]') as HTMLTextAreaElement | null;
        if (textarea && textarea.value) {
          code = textarea.value;
        }
      }

      // 2. 若编辑器未取到语言，从 DOM select 控件中提取
      if (!language || language === 'unknown') {
        const domLang = this.extractLanguageFromDom();
        if (domLang && domLang !== 'unknown') {
          language = domLang;
        }
      }

      // 3. 提取题目 ID 与标题
      const urlMatch = window.location.pathname.match(/\/problem\/content\/(?:submission\/code_detail\/|submission\/|)(\d+)/);
      const problemId = urlMatch ? `acwing_${urlMatch[1]}` : 'acwing_unknown';
      const titleElem = document.querySelector('.problem-content-title');
      const problemTitle = titleElem ? titleElem.textContent?.trim() || '' : '';

      this.pendingSubmission = {
        problemId,
        problemTitle,
        code,
        language,
        timestamp: Date.now(),
      };

      Logger.info(`[AcWingAdapter] Captured editor code for ${problemId}, lang: ${language}, length: ${code.length}`);
      Transport.notifyStatus('syncing', `AcWing 已提交判题: ${problemTitle || problemId}...`);
    } catch (e) {
      Logger.error('[AcWingAdapter] Error capturing editor state:', e);
    }
  }

  /**
   * 4级优先级解析语言：
   * ① 提交请求体里的 language 字段
   * ② 判题响应或 WS 消息里的语言字段
   * ③ 页面 DOM 读取 (Select / Ace Editor Mode / 激活按钮)
   * ④ 从该提交的 code_detail 页或提交列表行里取
   */
  private resolveLanguage(reqLang?: string, respLang?: string, sid?: string): string {
    // 优先级 1: 提交请求体里的 language
    if (reqLang && reqLang !== 'unknown' && reqLang.trim() !== '') {
      return reqLang.trim();
    }

    // 优先级 2: 判题响应或 WS 消息里的语言字段
    if (respLang && respLang !== 'unknown' && respLang.trim() !== '') {
      return respLang.trim();
    }

    // 优先级 3: pendingSubmission 或页面 DOM 读取
    const pending = this.getValidPendingSubmission();
    if (pending && pending.language && pending.language !== 'unknown') {
      return pending.language;
    }

    const domLang = this.extractLanguageFromDom();
    if (domLang && domLang !== 'unknown') {
      return domLang;
    }

    // 优先级 4: 从该提交的 code_detail 页或提交列表行中提取
    if (sid) {
      const listLang = this.extractLanguageFromSubmissionList(sid);
      if (listLang && listLang !== 'unknown') {
        return listLang;
      }
    }

    return 'unknown';
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

      // 尝试 Ace Editor Mode
      const ace = (pageWindow as any).ace;
      if (ace && typeof ace.edit === 'function') {
        const editor = ace.edit('code_editor') || ace.edit(document.querySelector('#code_editor'));
        if (editor && editor.getSession) {
          const modeId = editor.getSession().getMode()?.$id || '';
          if (modeId.includes('c_cpp')) return 'C++';
          if (modeId.includes('python')) return 'Python3';
          if (modeId.includes('java')) return 'Java';
          if (modeId.includes('golang')) return 'Go';
          if (modeId.includes('rust')) return 'Rust';
          if (modeId.includes('javascript')) return 'JavaScript';
        }
      }
    } catch (_) {}
    return 'unknown';
  }

  private extractLanguageFromSubmissionList(sid: string): string {
    try {
      const link = document.querySelector(`a[href*="/code_detail/${sid}/"], tr[data-submission-id="${sid}"]`);
      if (link) {
        const row = link.closest('tr');
        if (row) {
          const langCell = row.querySelector('.submission-language, .language, td:nth-child(4)');
          const text = langCell?.textContent?.trim();
          if (text && !text.includes(':') && !text.includes('/')) return text;
        }
      }
    } catch (_) {}
    return 'unknown';
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    // 拦截提交请求并捕获可能附带的源码与语言（同时支持 URLSearchParams / string / FormData / JSON）
    if (event.method === 'POST' && event.url.includes('/problem/content/submission/')) {
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
            const urlMatch = event.url.match(/\/problem\/content\/submission\/(\d+)/);
            const problemId = urlMatch ? `acwing_${urlMatch[1]}` : (this.pendingSubmission?.problemId || 'acwing_unknown');
            const prev = this.getValidPendingSubmission();

            this.pendingSubmission = {
              problemId,
              problemTitle: prev?.problemTitle || '',
              code: code || prev?.code || '',
              language: lang || prev?.language || 'unknown',
              timestamp: Date.now(),
              submissionId: prev?.submissionId,
            };
            Logger.info(`[AcWingAdapter] Captured submission POST params. Lang: ${this.pendingSubmission.language}`);
          }
        } catch (_) {}
      }

      // 关键：从提交代码的 POST 响应中直接提取真实 submission_id
      if (event.responseText) {
        try {
          if (event.responseText.startsWith('{') || event.responseText.startsWith('[')) {
            const json = JSON.parse(event.responseText);
            const sid = String(json.submission_id || json.record_id || json.id || json.sub_id || '');
            if (sid && /^\d+$/.test(sid)) {
              if (this.pendingSubmission) {
                this.pendingSubmission.submissionId = sid;
              } else {
                this.pendingSubmission = {
                  problemId: 'acwing_unknown',
                  problemTitle: '',
                  code: '',
                  language: 'unknown',
                  timestamp: Date.now(),
                  submissionId: sid,
                };
              }
              Logger.info(`[AcWingAdapter] Captured real submissionId from POST response: ${sid}`);
            }
          }
        } catch (_) {}
      }
    }

    // 检查 XHR 响应中是否包含判题终态
    if (event.responseText && (event.url.includes('/submission') || event.url.includes('/wss/'))) {
      this.checkTerminalResultInText(event.responseText);
    }
  }

  private handleWsMessage(url: string, data: string): void {
    if (!data) return;
    this.checkTerminalResultInText(data);
  }

  /**
   * 检查文本中是否包含判题终态并解析上报
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
        statusStr = json.status || json.result || json.state || '';
        submissionId = String(json.submission_id || json.record_id || json.id || json.sub_id || '');
        respLang = json.language || json.lang || json.code_language || '';
        if (json.time) timeMs = parseInt(String(json.time), 10) || 0;
        if (json.memory) memoryKb = parseInt(String(json.memory), 10) || 0;
      } else {
        const match = text.match(/"status":\s*"([^"]+)"/);
        if (match) statusStr = match[1];
        const langMatch = text.match(/"(?:language|lang)":\s*"([^"]+)"/);
        if (langMatch) respLang = langMatch[1];
      }

      if (!statusStr) return;

      const verdict = this.mapStatusStringToVerdict(statusStr);
      if (verdict) {
        // 如果未拿到明确的 submissionId，优先使用之前 HTTP POST 响应中捕获到的真实 ID
        if (!submissionId || !/^\d+$/.test(submissionId)) {
          const pending = this.getValidPendingSubmission();
          if (pending?.submissionId && /^\d+$/.test(pending.submissionId)) {
            submissionId = pending.submissionId;
          }
        }

        // 兜底尝试从 DOM 中检索最新记录链接
        if (!submissionId || !/^\d+$/.test(submissionId)) {
          const domSid = this.findRecentSubmissionIdFromDom();
          if (domSid && /^\d+$/.test(domSid)) {
            submissionId = domSid;
          }
        }

        // 严禁生成 acwing_auto_* / acwing_dom_* 这类伪造 ID，必须是真实编号
        if (!submissionId || !/^\d+$/.test(submissionId)) {
          Logger.warn('[AcWingAdapter] Real submission ID not found in WS/JSON yet. Waiting for DOM update...');
          return;
        }

        this.emitUnifiedSubmission(submissionId, verdict, statusStr, timeMs, memoryKb, respLang);
      }
    } catch (_) {}
  }

  /**
   * 初始化 DOM MutationObserver 双保险
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

  private scanDomForStatus(): void {
    // 判题结果容器选择器 (兼容 AcWing 真实 ID: #submit-code-status-block 与各类备用选择器)
    const statusBlock = document.querySelector(
      '#submit-code-status-block, #submission-status-block, .submission-status-text, #submit_code_result, #run_code_result, .run-code-result, #code_result, [id*="submission-result-"]'
    );
    if (!statusBlock) return;

    const text = statusBlock.textContent?.trim() || '';
    if (!text || text.includes('Running') || text.includes('Pending') || text.includes('Compiling') || text.includes('判题中') || text.includes('排队中')) {
      return;
    }

    const verdict = this.mapStatusStringToVerdict(text);
    if (!verdict) return;

    // 寻找真实 submission_id
    let submissionId = '';
    // 1. 优先使用 pendingSubmission 中从 HTTP POST 响应中捕获到的真实 ID
    const pending = this.getValidPendingSubmission();
    if (pending?.submissionId && /^\d+$/.test(pending.submissionId)) {
      submissionId = pending.submissionId;
    }

    // 2. 检查 DOM 中是否有详情链接
    if (!submissionId) {
      const detailLink = document.querySelector('a[href*="/problem/content/submission/code_detail/"], a[href*="/code_detail/"]');
      if (detailLink) {
        const m = detailLink.getAttribute('href')?.match(/code_detail\/(\d+)/);
        if (m) submissionId = m[1];
      }
    }

    // 3. 兜底从 DOM 其他可能元素提取
    if (!submissionId) {
      const domSid = this.findRecentSubmissionIdFromDom();
      if (domSid && /^\d+$/.test(domSid)) {
        submissionId = domSid;
      }
    }

    // 若无法提取到纯数字真实 ID，跳过以避免假数据入库
    if (!submissionId || !/^\d+$/.test(submissionId)) {
      return;
    }

    // 提取时间与内存
    let timeMs = 0;
    let memoryKb = 0;
    const timeMatch = (statusBlock.textContent || document.body.textContent || '').match(/耗时[：:]\s*(\d+)\s*ms/i);
    if (timeMatch) timeMs = parseInt(timeMatch[1], 10);
    const memMatch = (statusBlock.textContent || document.body.textContent || '').match(/内存[：:]\s*([\d.]+)\s*(KB|MB)/i);
    if (memMatch) {
      memoryKb = memMatch[2].toUpperCase() === 'MB'
        ? Math.round(parseFloat(memMatch[1]) * 1024)
        : Math.round(parseFloat(memMatch[1]));
    }

    this.emitUnifiedSubmission(submissionId, verdict, text, timeMs, memoryKb);
  }

  private findRecentSubmissionIdFromDom(): string | null {
    try {
      // 1. 检查包含 submission-result- 的元素 ID，如 <span id="submission-result-45469382">
      const resElem = document.querySelector('[id*="submission-result-"]');
      if (resElem) {
        const m = resElem.id.match(/submission-result-(\d+)/);
        if (m && m[1]) return m[1];
      }

      // 2. 检查 a[href*="/code_detail/"]
      const detailLinks = document.querySelectorAll('a[href*="/code_detail/"]');
      for (let i = 0; i < detailLinks.length; i++) {
        const href = detailLinks[i].getAttribute('href') || '';
        const m = href.match(/\/code_detail\/(\d+)/);
        if (m && m[1]) return m[1];
      }

      // 3. 检查状态块内的提交链接 a[href*="/submission/"]
      const subLinks = document.querySelectorAll('#submit-code-status-block a[href*="/submission/"], .run-code-result a[href*="/submission/"]');
      for (let i = 0; i < subLinks.length; i++) {
        const href = subLinks[i].getAttribute('href') || '';
        const m = href.match(/\/submission\/(?:code_detail\/|)(\d+)/);
        if (m && m[1]) return m[1];
      }

      // 4. 检查表格中的 data-submission-id 属性
      const tr = document.querySelector('tr[data-submission-id], [data-sub-id]');
      if (tr) {
        const sid = tr.getAttribute('data-submission-id') || tr.getAttribute('data-sub-id');
        if (sid && /^\d+$/.test(sid)) return sid;
      }
    } catch (_) {}
    return null;
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
    const urlMatch = window.location.pathname.match(/\/problem\/content\/(?:submission\/code_detail\/|submission\/|)(\d+)/);
    const problemId = pending?.problemId || (urlMatch ? `acwing_${urlMatch[1]}` : 'acwing_unknown');
    const problemTitle = pending?.problemTitle || document.querySelector('.problem-content-title')?.textContent?.trim() || problemId;

    // 解析语言（四层优先级判定）
    const language = this.resolveLanguage(pending?.language, respLang, submissionId);

    const payload: UnifiedSubmissionPayload = {
      platform: 'acwing',
      platformSubmissionId: String(submissionId),
      problemId,
      problemTitle,
      problemUrl: window.location.href,
      platformUserHandle: this.extractUserHandle(),
      verdict,
      rawStatus,
      score: verdict === 'AC' ? 100 : 0,
      language: language !== 'unknown' ? language : 'C++', // 无法识别时给 AcWing 常见默认而非 unknown
      sourceCode: pending?.code || '',
      executionTimeMs: timeMs,
      memoryUsedKb: memoryKb,
      submittedAt: pending?.timestamp || Date.now(),
      clientVersion: '1.0.0',
    };

    // 关键操作：使用完毕后立即清除 pendingSubmission，防止泄漏到下次提交
    this.pendingSubmission = null;

    this.submitPayload(payload);
  }

  private mapStatusStringToVerdict(status: string): VerdictType | null {
    const s = status.toLowerCase();
    if (s.includes('accepted') || s.includes('通过')) return 'AC';
    if (s.includes('wrong answer') || s.includes('答案错误')) return 'WA';
    if (s.includes('time limit') || s.includes('时间超限')) return 'TLE';
    if (s.includes('memory limit') || s.includes('内存超限')) return 'MLE';
    if (s.includes('runtime error') || s.includes('运行时错误')) return 'RE';
    if (s.includes('compile error') || s.includes('编译错误')) return 'CE';
    return null;
  }

  private extractUserHandle(): string | undefined {
    try {
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
