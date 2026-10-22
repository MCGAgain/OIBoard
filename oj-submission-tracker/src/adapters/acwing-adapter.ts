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

    // 监听代码提交按钮点击以捕获源码与语言
    this.bindSubmitButtonListener();
  }

  private bindSubmitButtonListener(): void {
    const bind = () => {
      const submitBtn = document.querySelector('#submit_code_btn, button.btn-run, button[type="submit"]');
      if (submitBtn) {
        submitBtn.addEventListener('click', () => {
          this.captureEditorState();
        });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bind);
    } else {
      bind();
    }
  }

  /**
   * 从 Ace Editor 或页面 DOM 中截获代码与语言
   */
  private captureEditorState(): void {
    try {
      let code = '';
      let language = 'unknown';

      // 尝试从 Ace Editor 获取
      const ace = (pageWindow as any).ace;
      if (ace && typeof ace.edit === 'function') {
        const editor = ace.edit('code_editor') || ace.edit(document.querySelector('#code_editor'));
        if (editor && typeof editor.getValue === 'function') {
          code = editor.getValue();
        }
      }

      if (!code) {
        const textarea = document.querySelector('#code_editor textarea, textarea[name="code"]') as HTMLTextAreaElement;
        if (textarea && textarea.value) {
          code = textarea.value;
        }
      }

      // 提取语言
      const langSelect = document.querySelector('#code_language, select[name="language"]') as HTMLSelectElement;
      if (langSelect) {
        language = langSelect.value || langSelect.options[langSelect.selectedIndex]?.text || 'unknown';
      }

      // 提取题目 ID 与标题
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

      Logger.info(`[AcWingAdapter] Captured editor code for ${problemId}, length: ${code.length}`);
      Transport.notifyStatus('syncing', `AcWing 已提交判题: ${problemTitle || problemId}...`);
    } catch (e) {
      Logger.error('[AcWingAdapter] Error capturing editor state:', e);
    }
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    // 拦截提交请求并捕获可能附带的源码
    if (event.method === 'POST' && event.url.includes('/problem/content/submission/')) {
      if (event.requestBody && typeof event.requestBody === 'string') {
        try {
          const params = new URLSearchParams(event.requestBody);
          const code = params.get('code');
          const lang = params.get('language');
          if (code) {
            const urlMatch = event.url.match(/\/problem\/content\/submission\/(\d+)/);
            const problemId = urlMatch ? `acwing_${urlMatch[1]}` : (this.pendingSubmission?.problemId || 'acwing_unknown');
            this.pendingSubmission = {
              problemId,
              problemTitle: this.pendingSubmission?.problemTitle || '',
              code,
              language: lang || this.pendingSubmission?.language || 'unknown',
              timestamp: Date.now(),
            };
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

      if (text.startsWith('{') || text.startsWith('[')) {
        const json = JSON.parse(text);
        statusStr = json.status || json.result || json.state || '';
        submissionId = String(json.submission_id || json.record_id || json.id || '');
        if (json.time) timeMs = parseInt(String(json.time), 10) || 0;
        if (json.memory) memoryKb = parseInt(String(json.memory), 10) || 0;
      } else {
        const match = text.match(/"status":\s*"([^"]+)"/);
        if (match) statusStr = match[1];
      }

      if (!statusStr) return;

      const verdict = this.mapStatusStringToVerdict(statusStr);
      if (verdict) {
        // 如果未拿到明确的 submissionId，尝试从 DOM 中检索最新记录链接
        if (!submissionId) {
          submissionId = this.findRecentSubmissionIdFromDom() || `acwing_auto_${Date.now()}`;
        }

        this.emitUnifiedSubmission(submissionId, verdict, statusStr, timeMs, memoryKb);
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
    // 判题结果容器选择器
    const statusBlock = document.querySelector(
      '#submission-status-block, .submission-status-text, #run_code_result, .run-code-result, #code_result'
    );
    if (!statusBlock) return;

    const text = statusBlock.textContent?.trim() || '';
    if (!text || text.includes('Running') || text.includes('Pending') || text.includes('Compiling') || text.includes('判题中')) {
      return;
    }

    const verdict = this.mapStatusStringToVerdict(text);
    if (!verdict) return;

    // 寻找真实 submission_id
    const detailLink = document.querySelector('a[href*="/problem/content/submission/code_detail/"]');
    let submissionId = '';
    if (detailLink) {
      const m = detailLink.getAttribute('href')?.match(/\/problem\/content\/submission\/code_detail\/(\d+)/);
      if (m) submissionId = m[1];
    }
    if (!submissionId) {
      submissionId = this.findRecentSubmissionIdFromDom() || `acwing_dom_${Date.now()}`;
    }

    // 提取时间与内存
    let timeMs = 0;
    let memoryKb = 0;
    const timeMatch = document.body.textContent?.match(/耗时[：:]\s*(\d+)\s*ms/i);
    if (timeMatch) timeMs = parseInt(timeMatch[1], 10);
    const memMatch = document.body.textContent?.match(/内存[：:]\s*([\d.]+)\s*(KB|MB)/i);
    if (memMatch) {
      memoryKb = memMatch[2].toUpperCase() === 'MB'
        ? Math.round(parseFloat(memMatch[1]) * 1024)
        : Math.round(parseFloat(memMatch[1]));
    }

    this.emitUnifiedSubmission(submissionId, verdict, text, timeMs, memoryKb);
  }

  private findRecentSubmissionIdFromDom(): string | null {
    const link = document.querySelector('a[href*="/code_detail/"]');
    if (link) {
      const m = link.getAttribute('href')?.match(/\/code_detail\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  private emitUnifiedSubmission(
    submissionId: string,
    verdict: VerdictType,
    rawStatus: string,
    timeMs: number,
    memoryKb: number
  ): void {
    if (Storage.isDuplicate(this.platform, submissionId)) return;

    const urlMatch = window.location.pathname.match(/\/problem\/content\/(?:submission\/code_detail\/|submission\/|)(\d+)/);
    const problemId = this.pendingSubmission?.problemId || (urlMatch ? `acwing_${urlMatch[1]}` : 'acwing_unknown');
    const problemTitle = this.pendingSubmission?.problemTitle || document.querySelector('.problem-content-title')?.textContent?.trim() || problemId;

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
      language: this.pendingSubmission?.language || 'unknown',
      sourceCode: this.pendingSubmission?.code || '',
      executionTimeMs: timeMs,
      memoryUsedKb: memoryKb,
      submittedAt: this.pendingSubmission?.timestamp || Date.now(),
      clientVersion: '1.0.0',
    };

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
      const userElem = document.querySelector('#user-menu a[href*="/user/profile/"], a.navbar-user-name');
      return userElem?.textContent?.trim();
    } catch (_) {
      return undefined;
    }
  }
}
