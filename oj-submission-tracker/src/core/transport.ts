import { UnifiedSubmissionPayload } from '../types/payload';
import { Storage } from './storage';
import { Logger } from './sandbox';

declare function GM_xmlhttpRequest(details: {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  data?: string;
  timeout?: number;
  onload?: (response: {
    status: number;
    statusText: string;
    responseText: string;
    responseHeaders: string;
  }) => void;
  onerror?: (error: any) => void;
  ontimeout?: () => void;
}): void;

export type TransportStatusListener = (
  status: 'idle' | 'syncing' | 'synced' | 'error',
  message?: string
) => void;

export class Transport {
  private static statusListeners: TransportStatusListener[] = [];
  private static isFlushingFailedQueue = false;
  private static inflightSet: Set<string> = new Set();

  public static onStatus(listener: TransportStatusListener): void {
    this.statusListeners.push(listener);
  }

  public static notifyStatus(
    status: 'idle' | 'syncing' | 'synced' | 'error',
    message?: string
  ): void {
    for (const fn of this.statusListeners) {
      try {
        fn(status, message);
      } catch (e) {
        Logger.error('Status listener error:', e);
      }
    }
  }

  /**
   * 发送统一上报报文（包含幂等校验与 3 次指数退避重试）
   */
  public static async send(
    payload: UnifiedSubmissionPayload,
    retryCount = 0
  ): Promise<boolean> {
    const flightKey = `${payload.platform}:${payload.platformSubmissionId}`;

    // 1. 本地幂等去重检查与 Inflight 保护
    if (Storage.isDuplicate(payload.platform, payload.platformSubmissionId)) {
      Logger.info(
        `[Transport] Skipped duplicate submission: ${flightKey}`
      );
      return true;
    }

    if (retryCount === 0) {
      if (this.inflightSet.has(flightKey)) {
        Logger.info(
          `[Transport] Skipped inflight submission: ${flightKey}`
        );
        return true;
      }
      this.inflightSet.add(flightKey);
    }

    const backendUrl = Storage.getBackendUrl();
    const token = Storage.getUserToken();

    if (!backendUrl) {
      Logger.warn('[Transport] Backend URL is not configured.');
      this.notifyStatus('error', '未配置后端地址');
      Storage.saveFailedPayload(payload);
      this.inflightSet.delete(flightKey);
      return false;
    }

    this.notifyStatus('syncing', `正在同步 ${payload.problemId}...`);
    Logger.info(
      `[Transport] Sending submission (${flightKey}, attempt ${retryCount + 1})...`
    );

    return new Promise<boolean>((resolve) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        Logger.error('GM_xmlhttpRequest is not available in current environment!');
        this.notifyStatus('error', 'GM_xmlhttpRequest 未授权');
        Storage.saveFailedPayload(payload);
        this.inflightSet.delete(flightKey);
        resolve(false);
        return;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-OJ-Tracker-Version': payload.clientVersion || '1.0.0',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      GM_xmlhttpRequest({
        method: 'POST',
        url: backendUrl,
        headers,
        data: JSON.stringify(payload),
        timeout: 12000,
        onload: (response) => {
          this.inflightSet.delete(flightKey);
          if (response.status >= 200 && response.status < 300) {
            Logger.info(
              `[Transport] Successfully synced: ${flightKey}`
            );
            Storage.markReported(payload.platform, payload.platformSubmissionId);
            Storage.removeFailedPayload(payload.platform, payload.platformSubmissionId);
            this.notifyStatus('synced', `已同步 ✓ (${payload.problemId})`);

            // 成功后尝试触发补发离线队列
            setTimeout(() => this.flushOfflineQueue(), 1500);
            resolve(true);
          } else {
            Logger.warn(
              `[Transport] Server returned status ${response.status}: ${response.responseText}`
            );
            this.handleRetry(payload, retryCount, resolve, `HTTP ${response.status}`);
          }
        },
        onerror: (err) => {
          Logger.error('[Transport] Network error:', err);
          this.handleRetry(payload, retryCount, resolve, '网络错误');
        },
        ontimeout: () => {
          Logger.warn('[Transport] Request timed out.');
          this.handleRetry(payload, retryCount, resolve, '连接超时');
        },
      });
    });
  }

  /**
   * 指数退避重试控制
   */
  private static handleRetry(
    payload: UnifiedSubmissionPayload,
    retryCount: number,
    resolve: (val: boolean) => void,
    reason: string
  ): void {
    const flightKey = `${payload.platform}:${payload.platformSubmissionId}`;
    const MAX_RETRIES = 3;
    if (retryCount < MAX_RETRIES) {
      const delayMs = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      Logger.info(
        `[Transport] Retrying ${flightKey} in ${delayMs}ms (retry ${retryCount + 1}/${MAX_RETRIES})...`
      );
      this.notifyStatus('syncing', `同步失败 (${reason})，${delayMs / 1000}s 后重试...`);
      setTimeout(async () => {
        const ok = await this.send(payload, retryCount + 1);
        resolve(ok);
      }, delayMs);
    } else {
      this.inflightSet.delete(flightKey);
      Logger.error(
        `[Transport] Exceeded max retries for ${flightKey}. Saving to offline queue.`
      );
      Storage.saveFailedPayload(payload);
      this.notifyStatus('error', `同步失败 (${reason})，已加入离线暂存队列`);
      resolve(false);
    }
  }

  /**
   * 补发离线暂存队列
   */
  public static async flushOfflineQueue(): Promise<void> {
    if (this.isFlushingFailedQueue) return;
    const queue = Storage.getFailedQueue();
    if (!queue || queue.length === 0) return;

    this.isFlushingFailedQueue = true;
    Logger.info(`[Transport] Flushing ${queue.length} offline failed submissions...`);

    for (const item of queue) {
      if (Storage.isDuplicate(item.platform, item.platformSubmissionId)) {
        Storage.removeFailedPayload(item.platform, item.platformSubmissionId);
        continue;
      }
      try {
        const ok = await this.send(item, 0);
        if (!ok) {
          // 若仍失败则停止批量重试，等待下一次触发
          break;
        }
      } catch (e) {
        Logger.error('[Transport] Error during offline flush:', e);
        break;
      }
    }
    this.isFlushingFailedQueue = false;
  }
}
