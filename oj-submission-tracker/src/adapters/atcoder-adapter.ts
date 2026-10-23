import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { InterceptedHttpEvent, NetworkHookBus } from '../core/network-hook';
import { Storage } from '../core/storage';
import { Transport } from '../core/transport';
import { Logger } from '../core/sandbox';

interface AtCoderColumnIndices {
  timeIndex: number;
  taskIndex: number;
  userIndex: number;
  langIndex: number;
  scoreIndex: number;
  statusIndex: number;
  execTimeIndex: number;
  memoryIndex: number;
}

export class AtCoderAdapter extends BaseAdapter {
  public readonly platform: PlatformType = 'atcoder';
  private observedWaitingSids: Set<string> = new Set();
  private observerInitialized = false;

  public matchDomain(hostname: string): boolean {
    return hostname === 'atcoder.jp' || hostname.endsWith('.atcoder.jp');
  }

  public init(): void {
    Logger.info('[AtCoderAdapter] Initialized.');

    // 1. 拦截前端自动轮询的 /status/json 响应
    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });

    // 2. 监听提交按钮/表单，主动触发胶囊反馈
    this.bindSubmitListener();

    // 3. 页面表格扫描与 MutationObserver 监听
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this.scanStaticSubmissions();
        this.initDomObserver();
      });
    } else {
      this.scanStaticSubmissions();
      this.initDomObserver();
    }
  }

  private bindSubmitListener(): void {
    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest('#submit, button[type="submit"], input[type="submit"]');
      if (btn && (window.location.pathname.includes('/tasks/') || window.location.pathname.includes('/submit'))) {
        Logger.info('[AtCoderAdapter] Submit button clicked. Waiting for judge...');
        Transport.notifyStatus('syncing', 'AtCoder 代码已提交，等待评测...');
      }
    }, true);
  }

  private initDomObserver(): void {
    if (this.observerInitialized) return;
    const table = document.querySelector('table');
    if (!table) return;

    this.observerInitialized = true;
    const observer = new MutationObserver(() => {
      this.scanStaticSubmissions();
    });

    observer.observe(table, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    Logger.info('[AtCoderAdapter] Submissions table DOM observer active.');
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    // 匹配 /contests/{cid}/submissions/me/status/json 或 /contests/{cid}/submissions/status/json
    if (event.url.includes('/status/json') && event.responseText) {
      try {
        const json = JSON.parse(event.responseText);
        const result = json.Result;
        if (!result || typeof result !== 'object') return;

        for (const [sid, item] of Object.entries(result)) {
          const detail = item as { Html?: string; Interval?: number | null };
          if (!detail) continue;

          const html = detail.Html || '';
          const isWaiting = (typeof detail.Interval === 'number' && detail.Interval > 0) ||
            html.includes('WJ') ||
            html.includes('waiting-judge') ||
            /\d+\s*\/\s*\d+/.test(html) ||
            html.includes('Waiting for Judging');

          if (isWaiting) {
            this.observedWaitingSids.add(sid);
            Transport.notifyStatus('syncing', `AtCoder 正在评测 (${sid})...`);
          } else {
            // 评测完成判断：!detail.Interval (兼容 null/缺失/0) 且 html 中不含 WJ/等待状态
            this.observedWaitingSids.delete(sid);
            Transport.notifyStatus('syncing', `AtCoder 评测完成 (${sid})，正在同步...`);
            this.handleFinishedSubmission(sid, html);
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

    const { problemId, problemTitle, problemUrl, language, submittedAtMs } = this.extractRowMeta(sid);

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
      submittedAt: submittedAtMs > 0 ? submittedAtMs : Date.now(),
      clientVersion: '1.0.0',
    };

    this.submitPayload(payload);
  }

  /**
   * 表格扫描：只处理当前用户的行，且仅上报本会话中观察到由 WJ/等待 变为终态的行；历史行跳过交给爬虫补
   */
  private scanStaticSubmissions(): void {
    const table = document.querySelector('table');
    if (!table) return;

    const rows = table.querySelectorAll('tbody tr');
    if (!rows || rows.length === 0) return;

    const cols = this.getTableColumnMap(table as HTMLTableElement);
    const currentUser = this.extractUserHandle();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLTableRowElement;
      const subLink = row.querySelector('a[href*="/submissions/"]') as HTMLAnchorElement;
      if (!subLink) continue;

      const subMatch = subLink.getAttribute('href')?.match(/\/submissions\/(\d+)/);
      if (!subMatch) continue;

      const sid = subMatch[1];
      if (Storage.isDuplicate(this.platform, sid)) continue;

      // 只处理当前用户的行 (若存在 User 列且与当前用户不符则跳过)
      if (cols.userIndex >= 0 && currentUser) {
        const rowUser = row.children[cols.userIndex]?.textContent?.trim();
        if (rowUser && rowUser !== currentUser) {
          continue;
        }
      }

      // 检查判题状态
      const statusSpan = row.querySelector('.label');
      const statusText = statusSpan?.textContent?.trim() || '';
      const isWaiting = !statusText || statusText === 'WJ' || statusText.includes('/') || statusText.includes('Waiting');

      if (isWaiting) {
        this.observedWaitingSids.add(sid);
        Transport.notifyStatus('syncing', `AtCoder 正在评测 (${sid})...`);
      } else if (this.observedWaitingSids.has(sid)) {
        // 仅上报本页面会话中观察到由 WJ/等待变为终态的行
        this.observedWaitingSids.delete(sid);
        this.handleFinishedRow(sid, row, statusText, cols);
      }
    }
  }

  private handleFinishedRow(
    sid: string,
    row: HTMLTableRowElement,
    statusText: string,
    cols: AtCoderColumnIndices
  ): void {
    if (Storage.isDuplicate(this.platform, sid)) return;

    const verdict = this.mapStatusTextToVerdict(statusText);
    const scoreText = cols.scoreIndex >= 0 ? row.children[cols.scoreIndex]?.textContent?.trim() : '';
    const score = parseInt(scoreText || '', 10) || (verdict === 'AC' ? 100 : 0);

    const timeText = cols.execTimeIndex >= 0 ? row.children[cols.execTimeIndex]?.textContent?.trim() : '';
    const memText = cols.memoryIndex >= 0 ? row.children[cols.memoryIndex]?.textContent?.trim() : '';
    const timeMs = this.parseTimeFromText(timeText || '');
    const memoryKb = this.parseMemoryFromText(memText || '');

    const { problemId, problemTitle, problemUrl, language, submittedAtMs } = this.extractRowMeta(sid, row);

    Transport.notifyStatus('syncing', `AtCoder 评测完成 (${sid})，正在同步...`);

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
      submittedAt: submittedAtMs > 0 ? submittedAtMs : Date.now(),
      clientVersion: '1.0.0',
    };

    this.submitPayload(payload);
  }

  /**
   * 动态表头列映射（兼容日文、英文及 /submissions 与 /submissions/me 的不同布局）
   */
  private getTableColumnMap(table: HTMLTableElement | null): AtCoderColumnIndices {
    const colMap: AtCoderColumnIndices = {
      timeIndex: 0,
      taskIndex: 1,
      userIndex: -1,
      langIndex: 2,
      scoreIndex: 3,
      statusIndex: 5,
      execTimeIndex: 6,
      memoryIndex: 7,
    };

    if (!table) return colMap;

    const ths = table.querySelectorAll('thead th');
    if (!ths || ths.length === 0) return colMap;

    ths.forEach((th, idx) => {
      const text = (th.textContent || '').trim().toLowerCase();
      if (text.includes('提出日時') || text.includes('submission time') || text.includes('date')) {
        colMap.timeIndex = idx;
      } else if (text.includes('問題') || text.includes('task') || text.includes('problem')) {
        colMap.taskIndex = idx;
      } else if (text.includes('ユーザ') || text.includes('user')) {
        colMap.userIndex = idx;
      } else if (text.includes('言語') || text.includes('language')) {
        colMap.langIndex = idx;
      } else if (text.includes('得点') || text.includes('score')) {
        colMap.scoreIndex = idx;
      } else if (text.includes('結果') || text.includes('status')) {
        colMap.statusIndex = idx;
      } else if (text.includes('実行時間') || text.includes('exec time') || (text.includes('time') && !text.includes('submission'))) {
        colMap.execTimeIndex = idx;
      } else if (text.includes('メモリ') || text.includes('memory')) {
        colMap.memoryIndex = idx;
      }
    });

    return colMap;
  }

  private extractRowMeta(sid: string, targetRow?: HTMLTableRowElement): {
    problemId: string;
    problemTitle: string;
    problemUrl: string;
    language: string;
    submittedAtMs: number;
  } {
    let row = targetRow;
    if (!row) {
      const link = document.querySelector(`a[href$="/submissions/${sid}"]`);
      if (link) {
        row = link.closest('tr') as HTMLTableRowElement;
      }
    }

    if (!row) {
      return { problemId: '', problemTitle: '', problemUrl: '', language: '', submittedAtMs: 0 };
    }

    const table = row.closest('table') as HTMLTableElement | null;
    const cols = this.getTableColumnMap(table);

    // 提取提交时间戳
    let submittedAtMs = 0;
    if (cols.timeIndex >= 0 && row.children[cols.timeIndex]) {
      const timeCell = row.children[cols.timeIndex];
      const timeElem = timeCell.querySelector('time');
      const timeStr = timeElem?.getAttribute('datetime') || timeCell.textContent?.trim() || '';
      if (timeStr) {
        const parsed = Date.parse(timeStr);
        if (!isNaN(parsed) && parsed > 0) {
          submittedAtMs = parsed;
        }
      }
    }

    // 提取题目信息
    let problemId = '';
    let problemTitle = '';
    let problemUrl = '';

    const taskCell = cols.taskIndex >= 0 ? row.children[cols.taskIndex] : row;
    const taskLink = taskCell?.querySelector('a[href*="/tasks/"]') as HTMLAnchorElement | null;
    if (taskLink) {
      problemUrl = taskLink.href;
      problemTitle = taskLink.textContent?.trim() || '';
      const m = taskLink.getAttribute('href')?.match(/\/tasks\/([A-Za-z0-9_]+)/);
      if (m) {
        problemId = m[1];
      }
    }

    // 提取语言
    let language = '';
    if (cols.langIndex >= 0 && row.children[cols.langIndex]) {
      language = row.children[cols.langIndex].textContent?.trim() || '';
    }

    return { problemId, problemTitle, problemUrl, language, submittedAtMs };
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
      // 优先从头部导航栏的 /users/ 链接中提取 URL 路径中的真实 username
      // 避免被浏览器网页翻译（如翻译为"我的资料"、"My Profile"、"プロフィール"）污染
      const userLink = document.querySelector(
        '#header a[href^="/users/"], .navbar a[href^="/users/"], a.username, a[href^="/users/"]'
      );
      if (userLink) {
        const href = userLink.getAttribute('href') || '';
        const m = href.match(/\/users\/([^/?#]+)/);
        if (m && m[1]) {
          const raw = decodeURIComponent(m[1]).trim();
          if (raw && !['profile', 'settings', 'contests', 'undefined', 'null'].includes(raw.toLowerCase())) {
            return raw;
          }
        }
        const text = userLink.textContent?.trim();
        if (text && !['我的资料', 'My Profile', 'プロフィール', 'Profile', 'Sign In', 'ログイン'].includes(text)) {
          return text;
        }
      }
    } catch (_) {}
    return undefined;
  }
}
