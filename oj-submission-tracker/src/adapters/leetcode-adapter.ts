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
      if (event.url.includes('/graphql') && event.requestBody && event.requestBody.includes('submissionDetail')) {
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
   * 拦截提交请求，记录提交的代码和语言
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
    } catch (e) {
      Logger.error('[LeetCodeAdapter] Error parsing submit request:', e);
    }
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
      const problemSlug = pending?.titleSlug || `leetcode_${data.question_id || ''}`;
      const userHandle = this.extractUserHandle();

      const payload: UnifiedSubmissionPayload = {
        platform: 'leetcode_cn',
        platformSubmissionId: String(submissionId),
        problemId: problemSlug,
        problemTitle: pending?.titleSlug || problemSlug,
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

      const problemSlug = pending?.titleSlug || detail.question?.titleSlug || `leetcode_${detail.question?.questionId || ''}`;
      const userHandle = this.extractUserHandle();

      const payload: UnifiedSubmissionPayload = {
        platform: 'leetcode_cn',
        platformSubmissionId: subIdStr,
        problemId: problemSlug,
        problemTitle: detail.question?.title || pending?.titleSlug || problemSlug,
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
      // 尝试从页面全局变量或用户头像链接提取
      const userAvatar = document.querySelector('a[href^="/u/"]');
      if (userAvatar) {
        const href = userAvatar.getAttribute('href');
        const m = href?.match(/\/u\/([^/]+)/);
        if (m) return m[1];
      }
      if ((pageWindow as any).userStatus?.username) {
        return (pageWindow as any).userStatus.username;
      }
    } catch (_) {}
    return undefined;
  }
}
