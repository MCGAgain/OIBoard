import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { InterceptedHttpEvent, NetworkHookBus } from '../core/network-hook';
import { pageWindow, Logger } from '../core/sandbox';
import { Transport } from '../core/transport';

interface LeetCodePendingSubmission {
  titleSlug: string;
  questionId: string;
  lang: string;
  code: string;
  timestamp: number;
}

export class LeetCodeAdapter extends BaseAdapter {
  public readonly platform: PlatformType = 'leetcode_cn';
  private pendingMap: Map<string, LeetCodePendingSubmission> = new Map();

  public matchDomain(hostname: string): boolean {
    return hostname === 'leetcode.cn' || hostname.endsWith('.leetcode.cn');
  }

  public init(): void {
    Logger.info('[LeetCodeAdapter] Initialized.');

    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.initDomObserver());
    } else {
      this.initDomObserver();
    }
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    // 1. 拦截提交阶段（POST /submit/）
    if (event.method === 'POST') {
      const submitMatch = event.url.match(/(?:problems|contest\/[^/]+\/problems)\/([^/]+)\/submit\/?/);
      if (submitMatch) {
        this.handleSubmitRequest(submitMatch[1], event);
        return;
      }

      // 拦截 GraphQL 判题结果
      if (event.url.includes('/graphql') && event.responseText && (event.responseText.includes('submissionDetail') || event.responseText.includes('statusDisplay'))) {
        this.handleGraphQLSubmissionDetail(event);
        return;
      }
    }

    // 2. 拦截 REST 轮询判题结果（GET /submissions/detail/{id}/check/）
    if (event.method === 'GET') {
      const checkMatch = event.url.match(/\/submissions\/detail\/(\d+)\/check\/?/);
      if (checkMatch) {
        this.handleCheckResponse(checkMatch[1], event.responseText);
      }
    }
  }

  /**
   * 拦截提交请求，记录提交的代码和语言并立即启动主动轮询
   */
  private handleSubmitRequest(titleSlug: string, event: InterceptedHttpEvent): void {
    try {
      if (!event.requestBody || !event.responseText) return;

      const reqBody = JSON.parse(event.requestBody);
      const resBody = JSON.parse(event.responseText);

      const submissionId = resBody.submission_id;
      if (!submissionId) return;

      const subIdStr = String(submissionId);
      this.pendingMap.set(subIdStr, {
        titleSlug,
        questionId: String(reqBody.question_id || ''),
        lang: reqBody.lang || '',
        code: reqBody.typed_code || '',
        timestamp: Date.now(),
      });

      Transport.notifyStatus('syncing', `力扣已提交判题: ${titleSlug}...`);
      Logger.info(`[LeetCodeAdapter] Cached pending submission: ID=${subIdStr}, Title=${titleSlug}`);

      // 关键增强：主动轮询 check 接口，避免漏掉页面异步请求
      this.startPollingCheckStatus(subIdStr, titleSlug);
    } catch (e) {
      Logger.error('[LeetCodeAdapter] Error parsing submit request:', e);
    }
  }

  /**
   * 端侧主动轮询 check 接口 (每 1.5 秒轮询一次，最多 25 次)
   */
  private startPollingCheckStatus(submissionId: string, titleSlug: string): void {
    let attempts = 0;
    const maxAttempts = 25;
    const pollInterval = 1500;

    const poll = async () => {
      if (!this.pendingMap.has(submissionId)) return;
      attempts++;
      try {
        const checkUrl = `/submissions/detail/${submissionId}/check/`;
        const fetchFn = NetworkHookBus.rawFetch || fetch;
        const res = await fetchFn(checkUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'include',
        });
        if (res.status === 200) {
          const text = await res.text();
          if (text) {
            const data = JSON.parse(text);
            if (data.state === 'SUCCESS') {
              this.handleCheckResponse(submissionId, text);
              return;
            }
          }
        }
      } catch (e) {
        Logger.warn(`[LeetCodeAdapter] Polling attempt ${attempts} error:`, e);
      }

      if (attempts < maxAttempts && this.pendingMap.has(submissionId)) {
        setTimeout(poll, pollInterval);
      } else if (this.pendingMap.has(submissionId)) {
        Logger.warn(`[LeetCodeAdapter] Polling timed out for submission ${submissionId}`);
      }
    };

    setTimeout(poll, pollInterval);
  }

  /**
   * 拦截 REST 轮询结果 (/submissions/detail/{id}/check/)
   */
  private handleCheckResponse(submissionId: string, responseText: string): void {
    try {
      if (!responseText) return;
      const data = JSON.parse(responseText);

      // 只有在判题状态变为 SUCCESS 时才表示判题完毕
      if (data.state !== 'SUCCESS') {
        return;
      }

      const pending = this.pendingMap.get(submissionId);
      const verdict = this.mapStatusCodeToVerdict(data.status_code);

      const runtimeMs = this.cleanRuntime(data.status_runtime);
      const memoryKb = this.cleanMemory(data.status_memory);
      const problemSlug = pending?.titleSlug || this.extractSlugFromUrl();
      const problemTitle = this.extractProblemTitle() || problemSlug;
      const userHandle = this.extractUserHandle();

      const payload: UnifiedSubmissionPayload = {
        platform: 'leetcode_cn',
        platformSubmissionId: String(submissionId),
        problemId: problemSlug,
        problemTitle,
        problemUrl: `https://leetcode.cn/problems/${problemSlug}/`,
        platformUserHandle: userHandle,
        verdict,
        rawStatus: data.status_msg || String(data.status_code),
        score: verdict === 'AC' ? 100 : 0,
        language: pending?.lang || data.lang || 'unknown',
        sourceCode: pending?.code || '',
        executionTimeMs: runtimeMs,
        memoryUsedKb: memoryKb,
        submittedAt: Date.now(),
        clientVersion: '1.0.0',
      };

      this.pendingMap.delete(submissionId);
      this.submitPayload(payload);
    } catch (e) {
      Logger.error('[LeetCodeAdapter] Error handling check response:', e);
    }
  }

  /**
   * 拦截新版 GraphQL submissionDetails 响应
   */
  private handleGraphQLSubmissionDetail(event: InterceptedHttpEvent): void {
    try {
      if (!event.responseText) return;
      const json = JSON.parse(event.responseText);
      const detail = json.data?.submissionDetail || json.data?.submissionDetails;
      if (!detail) return;

      const subIdStr = String(detail.id || detail.submissionId);
      if (!subIdStr) return;

      const pending = this.pendingMap.get(subIdStr);
      const statusDisplay = detail.statusDisplay || detail.statusMsg || '';
      const verdict = this.mapStatusDisplayToVerdict(statusDisplay);

      const runtimeMs = typeof detail.runtime === 'number'
        ? detail.runtime
        : this.cleanRuntime(detail.runtime || detail.statusRuntime);
      const memoryKb = typeof detail.memory === 'number'
        ? Math.round(detail.memory / 1024)
        : this.cleanMemory(detail.memory || detail.statusMemory);

      const problemSlug = pending?.titleSlug || detail.question?.titleSlug || this.extractSlugFromUrl();
      const problemTitle = detail.question?.title || this.extractProblemTitle() || problemSlug;
      const userHandle = this.extractUserHandle();

      const payload: UnifiedSubmissionPayload = {
        platform: 'leetcode_cn',
        platformSubmissionId: subIdStr,
        problemId: problemSlug,
        problemTitle,
        problemUrl: `https://leetcode.cn/problems/${problemSlug}/`,
        platformUserHandle: userHandle,
        verdict,
        rawStatus: statusDisplay,
        score: verdict === 'AC' ? 100 : 0,
        language: detail.lang?.name || pending?.lang || 'unknown',
        sourceCode: detail.code || pending?.code || '',
        executionTimeMs: runtimeMs,
        memoryUsedKb: memoryKb,
        submittedAt: detail.timestamp ? Number(detail.timestamp) * 1000 : Date.now(),
        clientVersion: '1.0.0',
      };

      this.pendingMap.delete(subIdStr);
      this.submitPayload(payload);
    } catch (e) {
      Logger.error('[LeetCodeAdapter] Error handling GraphQL detail:', e);
    }
  }

  /**
   * DOM MutationObserver 双保险监听
   */
  private initDomObserver(): void {
    if (typeof MutationObserver === 'undefined') return;
    let debounceTimer: any = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.scanDomForSubmissionResult();
      }, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private scanDomForSubmissionResult(): void {
    if (!this.pendingMap.size) return;

    const pageText = document.body.innerText || '';
    let foundVerdict: VerdictType | null = null;
    let foundStatusText = '';

    const resultBadges = document.querySelectorAll(
      '[data-e2e-locator="submission-result"], .text-green-s, .text-red-s, [class*="result-status"]'
    );

    for (const el of Array.from(resultBadges)) {
      const t = el.textContent?.trim() || '';
      if (t === '通过' || t === 'Accepted') {
        foundVerdict = 'AC';
        foundStatusText = t;
        break;
      } else if (t === '解答错误' || t === 'Wrong Answer') {
        foundVerdict = 'WA';
        foundStatusText = t;
        break;
      } else if (t === '超出时间限制' || t === 'Time Limit Exceeded') {
        foundVerdict = 'TLE';
        foundStatusText = t;
        break;
      } else if (t === '超出内存限制' || t === 'Memory Limit Exceeded') {
        foundVerdict = 'MLE';
        foundStatusText = t;
        break;
      } else if (t.includes('执行出错') || t.includes('Runtime Error')) {
        foundVerdict = 'RE';
        foundStatusText = t;
        break;
      } else if (t.includes('编译出错') || t.includes('Compile Error')) {
        foundVerdict = 'CE';
        foundStatusText = t;
        break;
      }
    }

    if (!foundVerdict) {
      if (pageText.includes('执行用时分布') || pageText.includes('消耗内存分布')) {
        if (/(\n|^)\s*通过\s*(\n|$)/m.test(pageText) || pageText.includes('状态：通过') || pageText.includes('状态: 通过')) {
          foundVerdict = 'AC';
          foundStatusText = '通过';
        } else if (/(\n|^)\s*解答错误\s*(\n|$)/m.test(pageText)) {
          foundVerdict = 'WA';
          foundStatusText = '解答错误';
        }
      }
    }

    if (!foundVerdict) return;

    let runtimeMs = 0;
    let memoryKb = 0;
    const runtimeMatch = pageText.match(/(?:执行用时|用时|Runtime)[^\d]*(\d+)\s*ms/i) || pageText.match(/(\d+)\s*ms/i);
    if (runtimeMatch) runtimeMs = parseInt(runtimeMatch[1], 10);

    const memMatch = pageText.match(/(?:消耗内存|内存|Memory)[^\d]*([\d.]+)\s*MB/i) || pageText.match(/([\d.]+)\s*MB/i);
    if (memMatch) memoryKb = Math.round(parseFloat(memMatch[1]) * 1024);

    const [subIdStr, pending] = Array.from(this.pendingMap.entries())[0];
    this.pendingMap.delete(subIdStr);

    const problemSlug = pending.titleSlug || this.extractSlugFromUrl();
    const problemTitle = this.extractProblemTitle() || problemSlug;
    const userHandle = this.extractUserHandle();

    const payload: UnifiedSubmissionPayload = {
      platform: 'leetcode_cn',
      platformSubmissionId: subIdStr,
      problemId: problemSlug,
      problemTitle,
      problemUrl: `https://leetcode.cn/problems/${problemSlug}/`,
      platformUserHandle: userHandle,
      verdict: foundVerdict,
      rawStatus: foundStatusText,
      score: foundVerdict === 'AC' ? 100 : 0,
      language: pending.lang || 'unknown',
      sourceCode: pending.code || '',
      executionTimeMs: runtimeMs,
      memoryUsedKb: memoryKb,
      submittedAt: pending.timestamp || Date.now(),
      clientVersion: '1.0.0',
    };

    Logger.info(`[LeetCodeAdapter] Emitted submission via DOM fallback: ${problemSlug} (${foundVerdict})`);
    this.submitPayload(payload);
  }

  private extractSlugFromUrl(): string {
    const m = window.location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : 'unknown';
  }

  private extractProblemTitle(): string {
    try {
      const rawTitle = document.title || '';
      const cleaned = rawTitle.replace(/\s*-\s*力扣.*$/, '').replace(/^\d+\.\s*/, '').trim();
      if (cleaned) return cleaned;
      const h4 = document.querySelector('h4, [data-e2e-locator="question-title"]');
      if (h4?.textContent) return h4.textContent.replace(/^\d+\.\s*/, '').trim();
    } catch (_) {}
    return '';
  }

  private mapStatusCodeToVerdict(code: number): VerdictType {
    switch (code) {
      case 10:
        return 'AC';
      case 11:
        return 'WA';
      case 12:
        return 'MLE';
      case 13:
        return 'OTHER'; // Output Limit Exceeded
      case 14:
        return 'TLE';
      case 15:
        return 'RE';
      case 20:
        return 'CE';
      default:
        return 'OTHER';
    }
  }

  private mapStatusDisplayToVerdict(display: string): VerdictType {
    const s = display.toLowerCase();
    if (s.includes('accepted')) return 'AC';
    if (s.includes('wrong answer')) return 'WA';
    if (s.includes('time limit')) return 'TLE';
    if (s.includes('memory limit')) return 'MLE';
    if (s.includes('runtime error')) return 'RE';
    if (s.includes('compile error')) return 'CE';
    return 'OTHER';
  }

  private cleanRuntime(val: any): number {
    if (!val || val === 'N/A') return 0;
    if (typeof val === 'number') return val;
    const match = String(val).match(/(\d+)\s*ms/i);
    return match ? parseInt(match[1], 10) : parseInt(String(val), 10) || 0;
  }

  private cleanMemory(val: any): number {
    if (!val || val === 'N/A') return 0;
    if (typeof val === 'number') return val;
    const s = String(val);
    const mbMatch = s.match(/([\d.]+)\s*MB/i);
    if (mbMatch) {
      return Math.round(parseFloat(mbMatch[1]) * 1024);
    }
    const kbMatch = s.match(/([\d.]+)\s*KB/i);
    if (kbMatch) {
      return Math.round(parseFloat(kbMatch[1]));
    }
    return Math.round(parseFloat(s) * 1024) || 0;
  }

  private extractUserHandle(): string | undefined {
    try {
      const userAvatar = document.querySelector('a[href^="/u/"]');
      if (userAvatar) {
        const href = userAvatar.getAttribute('href');
        const m = href?.match(/\/u\/([^/]+)/);
        if (m) return m[1];
      }
      if ((pageWindow as any).userStatus?.username) {
        return (pageWindow as any).userStatus.username;
      }
      const nextData = (pageWindow as any).__NEXT_DATA__;
      if (nextData?.props?.pageProps?.userStatus?.username) {
        return nextData.props.pageProps.userStatus.username;
      }
    } catch (_) {}
    return undefined;
  }
}
