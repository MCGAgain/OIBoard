import { BaseAdapter } from './base-adapter';
import { PlatformType, UnifiedSubmissionPayload, VerdictType } from '../types/payload';
import { InterceptedHttpEvent, NetworkHookBus } from '../core/network-hook';
import { RouterHookBus } from '../core/router-hook';
import { Storage } from '../core/storage';
import { Logger } from '../core/sandbox';
import { Transport } from '../core/transport';

interface LuoguPendingSubmission {
  problemId: string;
  code: string;
  lang: string;
  timestamp: number;
}

export class LuoguAdapter extends BaseAdapter {
  public readonly platform: PlatformType = 'luogu';
  private pendingMap: Map<string, LuoguPendingSubmission> = new Map();
  private activePollers: Set<string> = new Set();

  public matchDomain(hostname: string): boolean {
    return hostname === 'www.luogu.com.cn' || hostname === 'luogu.com.cn';
  }

  public init(): void {
    Logger.info('[LuoguAdapter] Initialized.');

    // 1. 拦截提交接口
    NetworkHookBus.onHttp((event: InterceptedHttpEvent) => {
      this.handleHttpEvent(event);
    });

    // 2. 监听单页路由变化（进入 /record/{rid} 自动兜底轮询）
    RouterHookBus.onRouteChange((newUrl: string) => {
      this.checkUrlForRecord(newUrl);
    });

    // 3. 初始页面加载检查
    if (typeof window !== 'undefined' && window.location) {
      this.checkUrlForRecord(window.location.href);
    }
  }

  private handleHttpEvent(event: InterceptedHttpEvent): void {
    if (event.method !== 'POST') return;

    // 匹配提交接口 /fe/api/problem/submit/{pid} 或 /api/problem/submit/{pid}
    const submitMatch = event.url.match(/(?:fe\/api\/problem\/submit|api\/problem\/submit)\/([A-Za-z0-9_]+)/);
    if (!submitMatch || !event.responseText) return;

    try {
      const problemId = submitMatch[1];
      const reqBody = event.requestBody ? JSON.parse(event.requestBody) : {};
      const resBody = JSON.parse(event.responseText);

      const rid = resBody.data?.rid || resBody.rid;
      if (!rid) return;

      const ridStr = String(rid);
      this.pendingMap.set(ridStr, {
        problemId,
        code: reqBody.code || '',
        lang: String(reqBody.lang || ''),
        timestamp: Date.now(),
      });

      Logger.info(`[LuoguAdapter] Intercepted submit for problem ${problemId}, rid: ${ridStr}`);
      Transport.notifyStatus('syncing', `洛谷已提交: ${problemId} (rid: ${ridStr})...`);

      // 立即触发端侧轻量主动轮询
      this.startActivePolling(ridStr);
    } catch (e) {
      Logger.error('[LuoguAdapter] Error parsing submit response:', e);
    }
  }

  private checkUrlForRecord(url: string): void {
    const match = url.match(/\/record\/(\d+)/);
    if (match) {
      const rid = match[1];
      if (!Storage.isDuplicate(this.platform, rid) && !this.activePollers.has(rid)) {
        Logger.info(`[LuoguAdapter] Detected record page for rid: ${rid}, starting active polling...`);
        this.startActivePolling(rid);
      }
    }
  }

  /**
   * 端侧轻量主动轮询器（解决 WebSocket 评测结束不发 XHR 的核心痛点）
   */
  public startActivePolling(rid: string): void {
    if (this.activePollers.has(rid)) return;
    if (Storage.isDuplicate(this.platform, rid)) return;

    this.activePollers.add(rid);
    Transport.notifyStatus('syncing', `正在等待洛谷评测出资 (rid: ${rid})...`);

    let attempts = 0;
    const maxAttempts = 20; // 2秒一次，最多轮询 40 秒
    const intervalMs = 2000;

    const poll = async () => {
      attempts++;
      if (attempts > maxAttempts) {
        Logger.warn(`[LuoguAdapter] Polling timeout for rid: ${rid}`);
        this.activePollers.delete(rid);
        Transport.notifyStatus('idle');
        return;
      }

      try {
        const url = `https://www.luogu.com.cn/record/${rid}?_contentOnly=1`;
        // 使用 rawFetch 避免死循环
        const fetchFn = NetworkHookBus.rawFetch || fetch;
        const res = await fetchFn(url, {
          method: 'GET',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'x-lentille-request': 'content-only',
          },
        });

        if (res.status === 200) {
          const text = await res.text();
          const record = this.parseRecordData(text);

          if (record && typeof record.status === 'number') {
            Logger.debug(`[LuoguAdapter] Polling rid ${rid}: status=${record.status}, attempt=${attempts}`);

            // status: 0=Waiting, 1=Judging, >=2 评测完成
            if (record.status >= 2) {
              this.activePollers.delete(rid);
              this.handleRecordFinished(rid, record);
              return;
            }
          }
        }
      } catch (e) {
        Logger.error(`[LuoguAdapter] Polling error for rid: ${rid}:`, e);
      }

      // 未结束则继续下一轮轮询
      if (this.activePollers.has(rid)) {
        setTimeout(poll, intervalMs);
      }
    };

    // 启动首次轮询（延迟 1 秒后开始）
    setTimeout(poll, 1200);
  }

  /**
   * 双格式兼容解析（旧版 currentData 与新版 lentille-context）
   */
  private parseRecordData(text: string): any | null {
    if (!text) return null;

    // 格式 1：直接返回 JSON
    if (text.trim().startsWith('{')) {
      try {
        const json = JSON.parse(text);
        if (json.currentData?.record) return json.currentData.record;
        if (json.data?.record) return json.data.record;
        if (json.record) return json.record;
      } catch (_) {}
    }

    // 格式 2：新版 Lentille 架构 HTML 中的 <script id="lentille-context">
    try {
      const match = text.match(/<script\s+id="lentille-context"\s+type="application\/json">([\s\S]*?)<\/script>/i);
      if (match && match[1]) {
        const context = JSON.parse(match[1]);
        if (context.data?.record) return context.data.record;
        if (context.currentData?.record) return context.currentData.record;
      }
    } catch (_) {}

    return null;
  }

  private handleRecordFinished(rid: string, record: any): void {
    const pending = this.pendingMap.get(rid);
    const statusCode = record.status;
    const score = typeof record.score === 'number' ? record.score : 0;
    const verdict = this.mapStatusToVerdict(statusCode, score);

    const problemId = record.problem?.pid || pending?.problemId || 'P_UNKNOWN';
    const problemTitle = record.problem?.title || '';
    const executionTimeMs = typeof record.time === 'number' ? record.time : 0;
    const memoryUsedKb = typeof record.memory === 'number' ? record.memory : 0;
    const language = this.mapLuoguLanguage(record.language || pending?.lang);
    const sourceCode = record.sourceCode || pending?.code || '';
    const userHandle = (record.user?.uid ? String(record.user.uid) : '') || record.user?.name || undefined;
    const submittedAt = record.submitTime ? record.submitTime * 1000 : Date.now();

    const payload: UnifiedSubmissionPayload = {
      platform: 'luogu',
      platformSubmissionId: String(rid),
      problemId,
      problemTitle,
      problemUrl: `https://www.luogu.com.cn/problem/${problemId}`,
      platformUserHandle: userHandle,
      verdict,
      rawStatus: String(statusCode),
      score: verdict === 'AC' ? 100 : score,
      language,
      sourceCode,
      executionTimeMs,
      memoryUsedKb,
      submittedAt,
      clientVersion: '1.0.0',
    };

    this.pendingMap.delete(rid);
    this.submitPayload(payload);
  }

  private mapLuoguLanguage(langId: any): string {
    const map: Record<string, string> = {
      '1': 'Pascal',
      '2': 'C',
      '3': 'C++98',
      '4': 'C++11',
      '7': 'Python 3',
      '8': 'Python 2',
      '9': 'Java 8',
      '11': 'C++14',
      '12': 'C++17',
      '13': 'Node.js',
      '14': 'Rust',
      '15': 'PHP',
      '16': 'Go',
      '17': 'C#',
      '18': 'Ruby',
      '19': 'Kotlin',
      '20': 'Haskell',
      '21': 'Scala',
      '22': 'Perl',
      '27': 'C++20',
      '28': 'C++20 (O2)',
    };
    return map[String(langId)] || String(langId || 'unknown');
  }

  private mapStatusToVerdict(status: number, score: number): VerdictType {
    switch (status) {
      case 12:
        return 'AC';
      case 14:
        return score > 0 ? 'PA' : 'WA';
      case 7:
        return 'CE';
      case 2:
        return 'TLE';
      case 3:
        return 'MLE';
      case 4:
        return 'RE';
      default:
        return 'WA';
    }
  }
}
