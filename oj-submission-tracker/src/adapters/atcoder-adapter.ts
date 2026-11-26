import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { InterceptedHttpEvent, NetworkHookBus } from '../core/network-hook';
import { Storage } from '../core/storage';
import { Transport } from '../core/transport';
import { Logger } from '../core/sandbox';

const KEY_RECENT_SUBMIT_TS = 'oiboard_atcoder_submit_ts';

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
  // 仅监听页面自身 jQuery $.ajax (XHR) 的 /status/json 响应；保持 fetch / ws / router 原生不劫持
  public readonly requiredHooks = { fetch: false, xhr: true, ws: false, router: false };
  private observedWaitingSids: Set<string> = new Set();
  private observerInitialized = false;
  private scanDebounceTimer: number | null = null;

  public matchDomain(hostname: string): boolean {
    return hostname === 'atcoder.jp' || hostname.endsWith('.atcoder.jp');
  }

  private isSubmissionsListPage(): boolean {
    const path = window.location.pathname;
    if (/\/submissions\/\d+/.test(path)) return false;
    return /\/submissions(\/me)?\/?$/.test(path);
  }

  private isMySubmissionsPage(): boolean {
    return /\/submissions\/me\/?$/.test(window.location.pathname);
  }

  private isSubmissionDetailPage(): boolean {
    return /\/submissions\/\d+/.test(window.location.pathname);
  }

  public init(): void {
    Logger.info('[AtCoderAdapter] Initialized (XHR /status/json + DOM observer dual mode).');

    // 1. 监听 AtCoder 页面自身轮询的 /status/json XHR 响应（秒级捕获评测终态，无额外请求）
    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });

    // 2. 监听提交按钮与表单提交事件，记录最近提交时间戳（兜底捕获跳转前已秒判完成的提交）
    this.bindSubmitListener();

    // 3. 在提交列表页或提交详情页启动 DOM 扫描与防抖观察器作为双保险
    if (!this.isSubmissionsListPage() && !this.isSubmissionDetailPage()) return;

    const start = () => {
      if (this.isSubmissionsListPage()) {
        this.scanStaticSubmissions();
        this.initDomObserver();
      } else if (this.isSubmissionDetailPage()) {
        this.scanDetailPage();
        this.initDomObserver();
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  private markRecentSubmitIntent(): void {
    try {
      sessionStorage.setItem(KEY_RECENT_SUBMIT_TS, String(Date.now()));
    } catch (_) {}
    Logger.info('[AtCoderAdapter] Submit detected. Waiting for judge...');
    Transport.notifyStatus('syncing', 'AtCoder 代码已提交，等待评测...');
  }

  private bindSubmitListener(): void {
    document.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const btn = target?.closest('#submit, button[type="submit"], input[type="submit"]');
      if (btn && (window.location.pathname.includes('/tasks/') || window.location.pathname.includes('/submit'))) {
        this.markRecentSubmitIntent();
      }
    }, true);

    document.addEventListener('submit', (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      const action = form?.getAttribute('action') || '';
      if (
        action.includes('/submit') ||
        window.location.pathname.includes('/tasks/') ||
        window.location.pathname.includes('/submit')
      ) {
        this.markRecentSubmitIntent();
      }
    }, true);
  }

  private findSubmissionsTable(): HTMLTableElement | null {
    const tables = Array.from(document.querySelectorAll('table')) as HTMLTableElement[];
    for (const t of tables) {
      if (t.querySelector('tbody a[href*="/submissions/"]')) {
        return t;
      }
    }
    return document.querySelector('table.table') as HTMLTableElement | null || tables[0] || null;
  }

  private initDomObserver(): void {
    if (this.observerInitialized) return;
    const targetNode = this.isSubmissionsListPage()
      ? (this.findSubmissionsTable() || document.querySelector('#main-container') || document.body)
      : (document.querySelector('#main-container') || document.body);
    if (!targetNode) return;

    this.observerInitialized = true;
    const observer = new MutationObserver(() => {
      if (this.scanDebounceTimer !== null) {
        window.clearTimeout(this.scanDebounceTimer);
      }
      this.scanDebounceTimer = window.setTimeout(() => {
        this.scanDebounceTimer = null;
        if (this.isSubmissionsListPage()) {
          this.scanStaticSubmissions();
        } else if (this.isSubmissionDetailPage()) {
          this.scanDetailPage();
        }
      }, 150);
    });

    observer.observe(targetNode, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    Logger.info('[AtCoderAdapter] Submissions DOM observer active.');
  }

  private hasRecentSubmitIntent(): boolean {
    try {
      const raw = sessionStorage.getItem(KEY_RECENT_SUBMIT_TS);
      if (!raw) return false;
      const ts = parseInt(raw, 10);
      if (!isNaN(ts) && Date.now() - ts < 120_000) {
        return true;
      }
      sessionStorage.removeItem(KEY_RECENT_SUBMIT_TS);
    } catch (_) {}
    return false;
  }

  private clearRecentSubmitIntent(): void {
    try {
      sessionStorage.removeItem(KEY_RECENT_SUBMIT_TS);
    } catch (_) {}
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    // 匹配 /contests/{cid}/submissions/me/status/json 或 /contests/{cid}/submissions/status/json
    if (!event.url || !event.url.includes('/status/json') || !event.responseText) return;

    try {
      const json = JSON.parse(event.responseText);
      const result = json.Result;
      if (!result || typeof result !== 'object') return;

      const isMeEndpoint = event.url.includes('/submissions/me/');
      const currentUser = this.extractUserHandle();

      for (const [sid, item] of Object.entries(result)) {
        const detail = item as { Html?: string; Interval?: number | null };
        if (!detail) continue;

        // 若是全站 /submissions/status/json，则校验该行是否属于当前登录用户
        if (!isMeEndpoint && currentUser) {
          const rowUser = this.extractRowUserBySid(sid);
          if (rowUser && rowUser.toLowerCase() !== currentUser.toLowerCase()) {
            continue;
          }
        }

        const html = detail.Html || '';
        const isWaiting =
          (typeof detail.Interval === 'number' && detail.Interval > 0) ||
          html.includes('WJ') ||
          html.includes('waiting-judge') ||
          /\d+\s*\/\s*\d+/.test(html) ||
          html.includes('Waiting for Judging');

        if (isWaiting) {
          this.observedWaitingSids.add(sid);
          Transport.notifyStatus('syncing', `AtCoder 正在评测 (${sid})...`);
        } else {
          this.observedWaitingSids.delete(sid);
          this.clearRecentSubmitIntent();
          Transport.notifyStatus('syncing', `AtCoder 评测完成 (${sid})，正在同步...`);
          this.handleFinishedSubmissionFromHtml(sid, html);
        }
      }
    } catch (e) {
      Logger.error('[AtCoderAdapter] Error parsing status json:', e);
    }
  }

  private handleFinishedSubmissionFromHtml(sid: string, htmlSnippet: string): void {
    if (Storage.isDuplicate(this.platform, sid)) return;

    const verdict = this.parseVerdictFromHtml(htmlSnippet);
    const score = this.parseScoreFromHtml(htmlSnippet);
    const timeMs = this.parseTimeFromHtml(htmlSnippet);
    const memoryKb = this.parseMemoryFromHtml(htmlSnippet);

    const meta = this.extractRowMeta(sid);

    const payload: UnifiedSubmissionPayload = {
      platform: 'atcoder',
      platformSubmissionId: String(sid),
      problemId: meta.problemId || 'atcoder_unknown',
      problemTitle: meta.problemTitle || meta.problemId || 'atcoder_unknown',
      problemUrl: meta.problemUrl || window.location.href,
      platformUserHandle: this.extractUserHandle(),
      verdict,
      rawStatus: verdict,
      score: typeof score === 'number' && score > 0 ? score : (verdict === 'AC' ? 100 : 0),
      language: meta.language || 'unknown',
      sourceCode: '',
      executionTimeMs: timeMs,
      memoryUsedKb: memoryKb,
      submittedAt: meta.submittedAtMs > 0 ? meta.submittedAtMs : Date.now(),
      clientVersion: '1.0.0',
    };

    this.submitPayload(payload);
  }

  /**
   * 列表页表格扫描（双保险）：
   * 1. 捕获本会话中由 WJ/等待变为终态的行
   * 2. 捕获刚提交后 120s 内落在 /submissions/me 首行的秒判记录
   */
  private scanStaticSubmissions(): void {
    const table = this.findSubmissionsTable();
    if (!table) return;

    const rows = table.querySelectorAll('tbody tr');
    if (!rows || rows.length === 0) return;

    const cols = this.getTableColumnMap(table);
    const currentUser = this.extractUserHandle();
    const isMePage = this.isMySubmissionsPage();
    const recentSubmit = this.hasRecentSubmitIntent();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLTableRowElement;
      const subLink = row.querySelector('a[href*="/submissions/"]') as HTMLAnchorElement | null;
      if (!subLink) continue;

      const subMatch = subLink.getAttribute('href')?.match(/\/submissions\/(\d+)/);
      if (!subMatch) continue;

      const sid = subMatch[1];
      if (Storage.isDuplicate(this.platform, sid)) continue;

      // 在 /submissions/me 页所有行均为当前用户；仅在全站 /submissions 页按用户过滤
      if (!isMePage && currentUser) {
        const rowUser = this.extractUserFromRow(row, cols);
        if (rowUser && rowUser.toLowerCase() !== currentUser.toLowerCase()) {
          continue;
        }
      }

      // 优先从状态列读取 .label，避免命中其他列装饰标签
      const statusCell = cols.statusIndex >= 0 ? row.children[cols.statusIndex] : null;
      const statusSpan = statusCell?.querySelector('.label') || row.querySelector('.label');
      const statusText = statusSpan?.textContent?.trim() || '';
      const isWaiting =
        !statusText ||
        statusText === 'WJ' ||
        statusText.includes('/') ||
        statusText.includes('Waiting') ||
        Boolean(row.querySelector('.waiting-judge'));

      if (isWaiting) {
        this.observedWaitingSids.add(sid);
        Transport.notifyStatus('syncing', `AtCoder 正在评测 (${sid})...`);
      } else if (this.observedWaitingSids.has(sid)) {
        this.observedWaitingSids.delete(sid);
        this.clearRecentSubmitIntent();
        this.handleFinishedRow(sid, row, statusText, cols);
      } else if (i === 0 && isMePage && recentSubmit) {
        // 刚提交后跳到 /submissions/me 且评测瞬间完成（不强依赖时间解析成功，解析成功时校验 3 分钟窗口）
        const meta = this.extractRowMeta(sid, row);
        const withinWindow = meta.submittedAtMs <= 0 || Math.abs(Date.now() - meta.submittedAtMs) < 180_000;
        if (withinWindow) {
          this.clearRecentSubmitIntent();
          this.handleFinishedRow(sid, row, statusText, cols);
        }
      }
    }
  }

  /**
   * 详情页 (/contests/{cid}/submissions/{sid}) DOM 扫描兜底
   */
  private scanDetailPage(): void {
    const m = window.location.pathname.match(/\/submissions\/(\d+)/);
    if (!m) return;
    const sid = m[1];
    if (Storage.isDuplicate(this.platform, sid)) return;

    const currentUser = this.extractUserHandle();
    const detailMeta = this.extractDetailPageMeta();
    if (currentUser && detailMeta.userHandle && detailMeta.userHandle.toLowerCase() !== currentUser.toLowerCase()) {
      return;
    }

    const statusElem = document.querySelector('#judge-status .label, td#judge-status .label, table .label');
    const statusText = statusElem?.textContent?.trim() || '';
    const isWaiting =
      !statusText ||
      statusText === 'WJ' ||
      statusText.includes('/') ||
      statusText.includes('Waiting') ||
      Boolean(document.querySelector('#judge-status.waiting-judge, .waiting-judge'));

    if (isWaiting) {
      this.observedWaitingSids.add(sid);
      Transport.notifyStatus('syncing', `AtCoder 正在评测 (${sid})...`);
    } else if (this.observedWaitingSids.has(sid) || this.hasRecentSubmitIntent()) {
      this.observedWaitingSids.delete(sid);
      this.clearRecentSubmitIntent();
      const verdict = this.mapStatusTextToVerdict(statusText);
      const payload: UnifiedSubmissionPayload = {
        platform: 'atcoder',
        platformSubmissionId: String(sid),
        problemId: detailMeta.problemId || 'atcoder_unknown',
        problemTitle: detailMeta.problemTitle || detailMeta.problemId || 'atcoder_unknown',
        problemUrl: detailMeta.problemUrl || window.location.href,
        platformUserHandle: currentUser || detailMeta.userHandle,
        verdict,
        rawStatus: statusText,
        score: detailMeta.score > 0 ? detailMeta.score : (verdict === 'AC' ? 100 : 0),
        language: detailMeta.language || 'unknown',
        sourceCode: '',
        executionTimeMs: detailMeta.timeMs,
        memoryUsedKb: detailMeta.memoryKb,
        submittedAt: detailMeta.submittedAtMs > 0 ? detailMeta.submittedAtMs : Date.now(),
        clientVersion: '1.0.0',
      };
      this.submitPayload(payload);
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
      problemTitle: problemTitle || problemId || 'atcoder_unknown',
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
      langIndex: 3,
      scoreIndex: 4,
      statusIndex: 6,
      execTimeIndex: 7,
      memoryIndex: 8,
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

  private extractUserFromRow(row: HTMLTableRowElement, cols: AtCoderColumnIndices): string | undefined {
    const userCell = cols.userIndex >= 0 ? row.children[cols.userIndex] : null;
    const link = (userCell?.querySelector('a[href^="/users/"]') || row.querySelector('a[href^="/users/"]')) as HTMLAnchorElement | null;
    if (link) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/\/users\/([^/?#]+)/);
      if (m && m[1]) {
        return decodeURIComponent(m[1]).trim();
      }
    }
    return userCell?.textContent?.trim() || undefined;
  }

  private extractRowUserBySid(sid: string): string | undefined {
    const link = document.querySelector(`a[href$="/submissions/${sid}"]`);
    const row = link?.closest('tr') as HTMLTableRowElement | null;
    if (!row) return undefined;
    const table = row.closest('table') as HTMLTableElement | null;
    return this.extractUserFromRow(row, this.getTableColumnMap(table));
  }

  private parseAtCoderDateTime(raw: string): number {
    if (!raw) return 0;
    const s = raw.trim();
    // 优先标准解析
    const direct = Date.parse(s);
    if (!isNaN(direct) && direct > 0) return direct;
    // 兼容 "2026-11-26 21:25:10+0900" -> "2026-11-26T21:25:10+09:00"
    const normalized = s
      .replace(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}:\d{2}:\d{2})/, '$1-$2-$3T$4')
      .replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const parsed = Date.parse(normalized);
    return !isNaN(parsed) && parsed > 0 ? parsed : 0;
  }

  private extractDetailPageMeta(): {
    problemId: string;
    problemTitle: string;
    problemUrl: string;
    language: string;
    submittedAtMs: number;
    score: number;
    timeMs: number;
    memoryKb: number;
    userHandle?: string;
  } {
    let problemId = '';
    let problemTitle = '';
    let problemUrl = '';
    let language = '';
    let submittedAtMs = 0;
    let score = 0;
    let timeMs = 0;
    let memoryKb = 0;
    let userHandle: string | undefined;

    const rows = document.querySelectorAll('table tr');
    rows.forEach((tr) => {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      if (!th || !td) return;
      const label = (th.textContent || '').trim().toLowerCase();
      if (label.includes('提出日時') || label.includes('submission time')) {
        const t = td.querySelector('time');
        submittedAtMs = this.parseAtCoderDateTime(t?.getAttribute('datetime') || td.textContent || '');
      } else if (label.includes('問題') || label.includes('task')) {
        const a = td.querySelector('a[href*="/tasks/"]') as HTMLAnchorElement | null;
        if (a) {
          problemUrl = a.href;
          problemTitle = a.textContent?.trim() || '';
          const m = a.getAttribute('href')?.match(/\/tasks\/([A-Za-z0-9_]+)/);
          if (m) problemId = m[1];
        }
      } else if (label.includes('ユーザ') || label.includes('user')) {
        const a = td.querySelector('a[href^="/users/"]') as HTMLAnchorElement | null;
        const m = a?.getAttribute('href')?.match(/\/users\/([^/?#]+)/);
        if (m && m[1]) userHandle = decodeURIComponent(m[1]).trim();
      } else if (label.includes('言語') || label.includes('language')) {
        language = td.textContent?.trim() || '';
      } else if (label.includes('得点') || label.includes('score')) {
        score = parseInt((td.textContent || '').trim(), 10) || 0;
      } else if (label.includes('実行時間') || label.includes('exec time')) {
        timeMs = this.parseTimeFromText(td.textContent || '');
      } else if (label.includes('メモリ') || label.includes('memory')) {
        memoryKb = this.parseMemoryFromText(td.textContent || '');
      }
    });

    return { problemId, problemTitle, problemUrl, language, submittedAtMs, score, timeMs, memoryKb, userHandle };
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
      if (this.isSubmissionDetailPage()) {
        const d = this.extractDetailPageMeta();
        return {
          problemId: d.problemId,
          problemTitle: d.problemTitle,
          problemUrl: d.problemUrl,
          language: d.language,
          submittedAtMs: d.submittedAtMs,
        };
      }
      return { problemId: '', problemTitle: '', problemUrl: '', language: '', submittedAtMs: 0 };
    }

    const table = row.closest('table') as HTMLTableElement | null;
    const cols = this.getTableColumnMap(table);

    let submittedAtMs = 0;
    if (cols.timeIndex >= 0 && row.children[cols.timeIndex]) {
      const timeCell = row.children[cols.timeIndex];
      const timeElem = timeCell.querySelector('time');
      const timeStr = timeElem?.getAttribute('datetime') || timeCell.textContent?.trim() || '';
      submittedAtMs = this.parseAtCoderDateTime(timeStr);
    }

    let problemId = '';
    let problemTitle = '';
    let problemUrl = '';

    const taskCell = cols.taskIndex >= 0 ? row.children[cols.taskIndex] : row;
    const taskLink = (taskCell?.querySelector('a[href*="/tasks/"]') || row.querySelector('a[href*="/tasks/"]')) as HTMLAnchorElement | null;
    if (taskLink) {
      problemUrl = taskLink.href;
      problemTitle = taskLink.textContent?.trim() || '';
      const m = taskLink.getAttribute('href')?.match(/\/tasks\/([A-Za-z0-9_]+)/);
      if (m) {
        problemId = m[1];
      }
    }

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
      // 仅从顶部导航栏提取登录用户名，避免误匹配正文表格中其他用户的 /users/ 链接
      const userLink = document.querySelector(
        '#header a[href^="/users/"], .navbar a[href^="/users/"], a.username'
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
