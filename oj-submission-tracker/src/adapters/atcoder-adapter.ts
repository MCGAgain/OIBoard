import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { InterceptedHttpEvent, NetworkHookBus } from '../core/network-hook';
import { Storage } from '../core/storage';
import { Logger } from '../core/sandbox';

export class AtCoderAdapter extends BaseAdapter {
  public readonly platform: PlatformType = 'atcoder';

  public matchDomain(hostname: string): boolean {
    return hostname === 'atcoder.jp' || hostname.endsWith('.atcoder.jp');
  }

  public init(): void {
    Logger.info('[AtCoderAdapter] Initialized.');

    // 方式一：拦截前端自动轮询的 /status/json 响应
    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });

    // 方式二：首屏静态已评测表格扫描兜底（简单题秒出结果）
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.scanStaticSubmissions());
    } else {
      this.scanStaticSubmissions();
    }
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    // 匹配 /contests/{cid}/submissions/me/status/json
    if (event.url.includes('/submissions/me/status/json') && event.responseText) {
      try {
        const json = JSON.parse(event.responseText);
        const result = json.Result;
        if (!result || typeof result !== 'object') return;

        for (const [sid, item] of Object.entries(result)) {
          const detail = item as { Html?: string; Interval?: number | null };
          // 判题结束标志：Interval === null
          if (detail && detail.Interval === null && detail.Html) {
            this.handleFinishedSubmission(sid, detail.Html);
          }
        }
      } catch (e) {
        Logger.error('[AtCoderAdapter] Error parsing status json:', e);
      }
    }
  }

  private handleFinishedSubmission(sid: string, htmlSnippet: string): void {
    if (Storage.isDuplicate(this.platform, sid)) return;

    const verdict = this.parseVerdictFromHtml(htmlSnippet);
    const score = this.parseScoreFromHtml(htmlSnippet);
    const timeMs = this.parseTimeFromHtml(htmlSnippet);
    const memoryKb = this.parseMemoryFromHtml(htmlSnippet);

    // 从页面表格中查找该 sid 所在行，提取题目信息
    const { problemId, problemTitle, problemUrl, language } = this.extractRowMeta(sid);

    const payload: UnifiedSubmissionPayload = {
      platform: 'atcoder',
      platformSubmissionId: String(sid),
      problemId: problemId || 'atcoder_unknown',
      problemTitle: problemTitle || problemId,
      problemUrl: problemUrl || window.location.href,
      platformUserHandle: this.extractUserHandle(),
      verdict,
      rawStatus: verdict,
      score: typeof score === 'number' ? score : (verdict === 'AC' ? 100 : 0),
      language: language || 'unknown',
      sourceCode: '',
      executionTimeMs: timeMs,
      memoryUsedKb: memoryKb,
      submittedAt: Date.now(),
      clientVersion: '1.0.0',
    };

    this.submitPayload(payload);
  }

  /**
   * 首屏静态扫描已评测行（针对进入页面时就已经 AC 的提交）
   */
  private scanStaticSubmissions(): void {
    const rows = document.querySelectorAll('table tbody tr');
    if (!rows || rows.length === 0) return;

    // 扫描前 5 行
    const maxScan = Math.min(rows.length, 5);
    for (let i = 0; i < maxScan; i++) {
      const row = rows[i] as HTMLTableRowElement;
      const subLink = row.querySelector('a[href*="/submissions/"]') as HTMLAnchorElement;
      if (!subLink) continue;

      const subMatch = subLink.getAttribute('href')?.match(/\/submissions\/(\d+)/);
      if (!subMatch) continue;

      const sid = subMatch[1];
      if (Storage.isDuplicate(this.platform, sid)) continue;

      // 检查判题状态是否已经结束 (非 WJ 且非判题进度 3/15)
      const statusSpan = row.querySelector('.label');
      const statusText = statusSpan?.textContent?.trim() || '';

      if (!statusText || statusText === 'WJ' || statusText.includes('/')) {
        continue;
      }

      const verdict = this.mapStatusTextToVerdict(statusText);
      const scoreText = row.querySelector('.submission-score')?.textContent?.trim() || '';
      const score = parseInt(scoreText, 10) || (verdict === 'AC' ? 100 : 0);

      const timeText = row.children[7]?.textContent?.trim() || '';
      const memText = row.children[8]?.textContent?.trim() || '';
      const timeMs = this.parseTimeFromText(timeText);
      const memoryKb = this.parseMemoryFromText(memText);

      const { problemId, problemTitle, problemUrl, language } = this.extractRowMeta(sid, row);

      const payload: UnifiedSubmissionPayload = {
        platform: 'atcoder',
        platformSubmissionId: String(sid),
        problemId: problemId || 'atcoder_unknown',
        problemTitle: problemTitle || problemId,
        problemUrl: problemUrl || window.location.href,
        platformUserHandle: this.extractUserHandle(),
        verdict,
        rawStatus: statusText,
        score,
        language: language || 'unknown',
        sourceCode: '',
        executionTimeMs: timeMs,
        memoryUsedKb: memoryKb,
        submittedAt: Date.now(),
        clientVersion: '1.0.0',
      };

      this.submitPayload(payload);
    }
  }

  private extractRowMeta(sid: string, targetRow?: HTMLTableRowElement): {
    problemId: string;
    problemTitle: string;
    problemUrl: string;
    language: string;
  } {
    let row = targetRow;
    if (!row) {
      const link = document.querySelector(`a[href$="/submissions/${sid}"]`);
      if (link) {
        row = link.closest('tr') as HTMLTableRowElement;
      }
    }

    if (!row) {
      return { problemId: '', problemTitle: '', problemUrl: '', language: '' };
    }

    const taskLink = row.querySelector('a[href*="/tasks/"]') as HTMLAnchorElement;
    let problemId = '';
    let problemTitle = '';
    let problemUrl = '';

    if (taskLink) {
      problemUrl = taskLink.href;
      problemTitle = taskLink.textContent?.trim() || '';
      const m = taskLink.getAttribute('href')?.match(/\/tasks\/([A-Za-z0-9_]+)/);
      if (m) {
        problemId = m[1];
      }
    }

    const langCell = row.children[3];
    const language = langCell?.textContent?.trim() || '';

    return { problemId, problemTitle, problemUrl, language };
  }

  private parseVerdictFromHtml(html: string): VerdictType {
    if (html.includes('>AC<') || html.includes('label-success')) return 'AC';
    if (html.includes('>WA<')) return 'WA';
    if (html.includes('>TLE<')) return 'TLE';
    if (html.includes('>MLE<')) return 'MLE';
    if (html.includes('>RE<')) return 'RE';
    if (html.includes('>CE<')) return 'CE';
    if (html.includes('>OLE<')) return 'OTHER';
    return 'OTHER';
  }

  private mapStatusTextToVerdict(text: string): VerdictType {
    const s = text.trim();
    if (s === 'AC') return 'AC';
    if (s === 'WA') return 'WA';
    if (s === 'TLE') return 'TLE';
    if (s === 'MLE') return 'MLE';
    if (s === 'RE') return 'RE';
    if (s === 'CE') return 'CE';
    return 'OTHER';
  }

  private parseScoreFromHtml(html: string): number {
    const m = html.match(/submission-score[^>]*>\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  private parseTimeFromHtml(html: string): number {
    const m = html.match(/(\d+)\s*ms/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  private parseMemoryFromHtml(html: string): number {
    const m = html.match(/(\d+)\s*KB/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  private parseTimeFromText(text: string): number {
    const m = text.match(/(\d+)\s*ms/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  private parseMemoryFromText(text: string): number {
    const m = text.match(/(\d+)\s*KB/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  private extractUserHandle(): string | undefined {
    try {
      const userLink = document.querySelector('a.username, a[href^="/users/"]');
      return userLink?.textContent?.trim();
    } catch (_) {
      return undefined;
    }
  }
}
