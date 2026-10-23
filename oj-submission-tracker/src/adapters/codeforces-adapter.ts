import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { Logger } from '../core/sandbox';
import { Storage } from '../core/storage';
import { Transport } from '../core/transport';

export class CodeforcesAdapter extends BaseAdapter {
  public readonly platform: PlatformType = 'codeforces';
  private observedCells: Set<Element> = new Set();
  private observer: MutationObserver | null = null;

  public matchDomain(hostname: string): boolean {
    return (
      hostname === 'codeforces.com' ||
      hostname.endsWith('.codeforces.com') ||
      hostname === 'mirror.codeforces.com'
    );
  }

  public init(): void {
    Logger.info('[CodeforcesAdapter] Initialized.');

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.startScanning());
    } else {
      this.startScanning();
    }
  }

  private startScanning(): void {
    // 初始扫描状态表格
    this.scanStatusTable();

    // 监听表格 DOM 变动（如页面内 AJAX 刷新或加载新行）
    this.observer = new MutationObserver(() => {
      this.scanStatusTable();
    });

    const target = document.querySelector('.status-frame-datatable, .datatable, #pageContent') || document.body;
    this.observer.observe(target, {
      childList: true,
      subtree: true,
    });
  }

  private scanStatusTable(): void {
    const rows = document.querySelectorAll('table.status-frame-datatable tr[data-submission-id], .datatable table tr[data-submission-id]');
    if (!rows || rows.length === 0) return;

    // 只检查最近前 10 行
    const maxScan = Math.min(rows.length, 10);
    for (let i = 0; i < maxScan; i++) {
      const row = rows[i] as HTMLTableRowElement;
      this.processRow(row);
    }
  }

  private processRow(row: HTMLTableRowElement): void {
    const submissionId = row.getAttribute('data-submission-id');
    if (!submissionId) return;

    // 已上报去重
    if (Storage.isDuplicate(this.platform, submissionId)) {
      return;
    }

    // 过滤非当前登录用户的提交（防止在公共 status 页误抓路人提交）
    const currentUser = this.extractUserHandle();
    const rowUser = this.extractRowUserHandle(row);
    if (currentUser && rowUser && currentUser.toLowerCase() !== rowUser.toLowerCase()) {
      return;
    }

    const verdictCell = row.querySelector('td.status-cell.status-verdict-cell, td[waiting]') as HTMLTableCellElement;
    if (!verdictCell) return;

    const waiting = verdictCell.getAttribute('waiting');

    // 1. 如果正在判题中 (waiting="true")，挂载单单元格监听器
    if (waiting === 'true') {
      if (!this.observedCells.has(verdictCell)) {
        this.observedCells.add(verdictCell);
        Transport.notifyStatus('syncing', `Codeforces 判题中 (#${submissionId})...`);
        Logger.info(`[CodeforcesAdapter] Observing waiting submission: #${submissionId}`);

        const cellObserver = new MutationObserver(() => {
          const currentWaiting = verdictCell.getAttribute('waiting');
          if (currentWaiting === 'false' || !currentWaiting) {
            cellObserver.disconnect();
            this.observedCells.delete(verdictCell);
            this.extractAndSubmit(row, submissionId, verdictCell);
          }
        });

        cellObserver.observe(verdictCell, {
          attributes: true,
          attributeFilter: ['waiting'],
          childList: true,
          subtree: true,
        });
      }
      return;
    }

    // 2. 如果已经出判题结果 (waiting="false" 或空)
    this.extractAndSubmit(row, submissionId, verdictCell);
  }

  private extractAndSubmit(
    row: HTMLTableRowElement,
    submissionId: string,
    verdictCell: HTMLTableCellElement
  ): void {
    if (Storage.isDuplicate(this.platform, submissionId)) return;

    // 提取题目信息
    const problemCell = row.querySelector('td[data-problemid]') || row.querySelector('td:nth-child(4)');
    const problemLink = (problemCell?.querySelector('a') || row.querySelector('a[href*="/problem/"]')) as HTMLAnchorElement | null;
    let problemId = 'CF_UNKNOWN';
    let problemTitle = '';
    let problemUrl = '';

    if (problemLink) {
      problemUrl = problemLink.href;
      problemTitle = problemLink.textContent?.trim() || '';
      const href = problemLink.getAttribute('href') || '';

      // 兼容 /problemset/problem/1999/A、/contest/1999/problem/A、/gym/104567/problem/A
      const contestMatch = href.match(/(?:contest|gym|problemset\/problem)\/(\d+)\/(?:problem\/)?([A-Za-z0-9_]+)/);
      if (contestMatch) {
        problemId = `${contestMatch[1]}${contestMatch[2]}`;
      } else {
        problemId = problemTitle;
      }
    }

    // 提取判题结果
    const verdict = this.parseVerdict(verdictCell);
    const rawStatus = verdictCell.textContent?.trim() || '';

    // 提取耗时与内存
    const timeCell = row.querySelector('td.time-consumed-cell');
    const timeMs = this.parseNumber(timeCell?.textContent || '');

    const memoryCell = row.querySelector('td.memory-consumed-cell');
    const memoryKb = this.parseNumber(memoryCell?.textContent || '');

    // 提取语言
    const language = this.extractLanguage(row, problemCell, verdictCell);

    // 提取当前用户 Handle
    const userHandle = this.extractUserHandle() || this.extractRowUserHandle(row);

    const payload: UnifiedSubmissionPayload = {
      platform: 'codeforces',
      platformSubmissionId: String(submissionId),
      problemId,
      problemTitle: problemTitle || problemId,
      problemUrl: problemUrl || window.location.href,
      platformUserHandle: userHandle,
      verdict,
      rawStatus,
      score: verdict === 'AC' ? 100 : 0,
      language,
      sourceCode: '', // CF 列表页默认不含源码，由后端单点同步或用户点击代码时补全
      executionTimeMs: timeMs,
      memoryUsedKb: memoryKb,
      submittedAt: Date.now(),
      clientVersion: '1.1.0',
    };

    this.submitPayload(payload);
  }

  /**
   * 三重定位提取提交语言：
   * 1. 题目列 (td[data-problemid]) 的下一个相邻单元格
   * 2. 判题结果列 (td.status-verdict-cell) 的上一个相邻单元格
   * 3. 标准第 5 列 (td:nth-child(5)) 兜底
   */
  private extractLanguage(
    row: HTMLTableRowElement,
    problemCell: Element | null,
    verdictCell: HTMLTableCellElement
  ): string {
    const candidates = [
      problemCell?.nextElementSibling,
      verdictCell?.previousElementSibling,
      row.querySelector('td:nth-child(5)'),
    ];
    for (const cell of candidates) {
      if (!cell) continue;
      // 排除题目列自身或判题列自身
      if (cell.hasAttribute('data-problemid') || cell.classList.contains('status-verdict-cell')) {
        continue;
      }
      const text = cell.textContent?.trim() || '';
      if (text) return text;
    }
    return 'unknown';
  }

  private extractRowUserHandle(row: HTMLTableRowElement): string | undefined {
    try {
      const partyLink = row.querySelector('td.status-party-cell a[href^="/profile/"]');
      if (partyLink) {
        const href = partyLink.getAttribute('href') || '';
        const m = href.match(/\/profile\/([^/?#]+)/);
        if (m && m[1]) return decodeURIComponent(m[1]).trim();
      }
      const partyCell = row.querySelector('td.status-party-cell');
      if (partyCell) {
        const text = partyCell.textContent?.trim();
        if (text) return text.replace(/[*#].*$/, '').trim();
      }
    } catch (_) {}
    return undefined;
  }

  private parseVerdict(cell: HTMLTableCellElement): VerdictType {
    const text = cell.textContent || '';
    if (cell.querySelector('.verdict-accepted') || text.includes('Accepted')) {
      return 'AC';
    }
    if (text.includes('Wrong answer')) return 'WA';
    if (text.includes('Time limit exceeded') || text.includes('Idleness limit exceeded')) return 'TLE';
    if (text.includes('Memory limit exceeded')) return 'MLE';
    if (text.includes('Runtime error')) return 'RE';
    if (text.includes('Compilation error')) return 'CE';
    if (text.includes('Hacked')) return 'WA';
    return 'OTHER';
  }

  private parseNumber(str: string): number {
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  private extractUserHandle(): string | undefined {
    try {
      const profileLink = document.querySelector('.lang-chooser a[href^="/profile/"], #header a[href^="/profile/"]');
      if (profileLink) {
        const href = profileLink.getAttribute('href') || '';
        const m = href.match(/\/profile\/([^/]+)/);
        if (m) return m[1];
      }
    } catch (_) {}
    return undefined;
  }
}
