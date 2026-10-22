import { PlatformType, UnifiedSubmissionPayload } from '../types/payload';
import { Logger } from './sandbox';

declare function GM_getValue<T>(key: string, defaultValue?: T): T;
declare function GM_setValue<T>(key: string, value: T): void;
declare function GM_registerMenuCommand(caption: string, onClick: () => void): void;

const KEY_REPORTED_IDS = 'reported_ids';
const KEY_BACKEND_URL = 'backend_url';
const KEY_USER_TOKEN = 'user_token';
const KEY_FAILED_QUEUE = 'failed_payload_queue';
const MAX_DEDUPLICATION_CAPACITY = 500;

export class Storage {
  private static cachedReportedSet: Set<string> | null = null;

  /**
   * 初始化存储与油猴菜单命令
   */
  public static init(onOpenConfigModal?: () => void): void {
    if (typeof GM_registerMenuCommand === 'function' && onOpenConfigModal) {
      GM_registerMenuCommand('⚙️ 打开 OJ Tracker 配置面板', onOpenConfigModal);
    }
  }

  /**
   * 获取后端 API 地址
   */
  public static getBackendUrl(): string {
    const val = typeof GM_getValue === 'function'
      ? GM_getValue<string>(KEY_BACKEND_URL, '')
      : localStorage.getItem(KEY_BACKEND_URL) || '';
    return val || 'http://localhost:8000/api/v1/submissions/push';
  }

  /**
   * 设置后端 API 地址
   */
  public static setBackendUrl(url: string): void {
    const trimmed = url.trim();
    if (typeof GM_setValue === 'function') {
      GM_setValue(KEY_BACKEND_URL, trimmed);
    } else {
      localStorage.setItem(KEY_BACKEND_URL, trimmed);
    }
  }

  /**
   * 获取用户认证 Token
   */
  public static getUserToken(): string {
    if (typeof GM_getValue === 'function') {
      return GM_getValue<string>(KEY_USER_TOKEN, '');
    }
    return localStorage.getItem(KEY_USER_TOKEN) || '';
  }

  /**
   * 设置用户认证 Token
   */
  public static setUserToken(token: string): void {
    const trimmed = token.trim();
    if (typeof GM_setValue === 'function') {
      GM_setValue(KEY_USER_TOKEN, trimmed);
    } else {
      localStorage.setItem(KEY_USER_TOKEN, trimmed);
    }
  }

  /**
   * 检查是否已上报过（本地幂等去重）
   */
  public static isDuplicate(platform: PlatformType, submissionId: string): boolean {
    if (!submissionId) return false;
    const key = `${platform}:${submissionId}`;
    const set = this.getReportedSet();
    return set.has(key);
  }

  /**
   * 标记记录已上报，并维护容量为 500 的 FIFO 队列
   */
  public static markReported(platform: PlatformType, submissionId: string): void {
    if (!submissionId) return;
    const key = `${platform}:${submissionId}`;
    const list = this.getReportedList();

    if (!list.includes(key)) {
      list.push(key);
      if (list.length > MAX_DEDUPLICATION_CAPACITY) {
        list.splice(0, list.length - MAX_DEDUPLICATION_CAPACITY);
      }
      this.saveReportedList(list);
      if (this.cachedReportedSet) {
        this.cachedReportedSet.add(key);
      }
    }
  }

  /**
   * 获取去重缓存队列项数量
   */
  public static getReportedCount(): number {
    return this.getReportedList().length;
  }

  /**
   * 清空去重缓存队列
   */
  public static clearReported(): void {
    this.saveReportedList([]);
    this.cachedReportedSet = new Set<string>();
  }

  /**
   * 获取离线或重试失败暂存队列
   */
  public static getFailedQueue(): UnifiedSubmissionPayload[] {
    try {
      if (typeof GM_getValue === 'function') {
        return GM_getValue<UnifiedSubmissionPayload[]>(KEY_FAILED_QUEUE, []) || [];
      }
      const raw = localStorage.getItem(KEY_FAILED_QUEUE);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * 添加失败记录到暂存队列
   */
  public static saveFailedPayload(payload: UnifiedSubmissionPayload): void {
    try {
      const queue = this.getFailedQueue();
      // 避免队列中重复添加
      const exists = queue.some(
        (p) => p.platform === payload.platform && p.platformSubmissionId === payload.platformSubmissionId
      );
      if (!exists) {
        queue.push(payload);
        if (queue.length > 50) {
          queue.shift();
        }
        if (typeof GM_setValue === 'function') {
          GM_setValue(KEY_FAILED_QUEUE, queue);
        } else {
          localStorage.setItem(KEY_FAILED_QUEUE, JSON.stringify(queue));
        }
      }
    } catch (e) {
      Logger.error('Failed to save payload to offline queue:', e);
    }
  }

  /**
   * 从离线队列中移除已成功的记录
   */
  public static removeFailedPayload(platform: PlatformType, submissionId: string): void {
    try {
      const queue = this.getFailedQueue().filter(
        (p) => !(p.platform === platform && p.platformSubmissionId === submissionId)
      );
      if (typeof GM_setValue === 'function') {
        GM_setValue(KEY_FAILED_QUEUE, queue);
      } else {
        localStorage.setItem(KEY_FAILED_QUEUE, JSON.stringify(queue));
      }
    } catch (_) {}
  }

  private static getReportedList(): string[] {
    try {
      if (typeof GM_getValue === 'function') {
        return GM_getValue<string[]>(KEY_REPORTED_IDS, []) || [];
      }
      const raw = localStorage.getItem(KEY_REPORTED_IDS);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  private static saveReportedList(list: string[]): void {
    if (typeof GM_setValue === 'function') {
      GM_setValue(KEY_REPORTED_IDS, list);
    } else {
      localStorage.setItem(KEY_REPORTED_IDS, JSON.stringify(list));
    }
    this.cachedReportedSet = new Set(list);
  }

  private static getReportedSet(): Set<string> {
    if (!this.cachedReportedSet) {
      this.cachedReportedSet = new Set(this.getReportedList());
    }
    return this.cachedReportedSet;
  }
}
