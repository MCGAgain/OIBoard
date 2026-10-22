// ==UserScript==
// @name         OJ Submission Tracker (多平台 OJ 提交采集与端云核实)
// @namespace    https://github.com/OIBoard/oj-tracker
// @version      1.0.0
// @description  实时截获力扣、洛谷、AcWing、Codeforces、AtCoder 的判题与提交记录，并秒级同步至后端对账核实
// @author       OIBoard
// @match        https://leetcode.cn/*
// @match        https://www.luogu.com.cn/*
// @match        https://www.acwing.com/*
// @match        https://codeforces.com/*
// @match        https://mirror.codeforces.com/*
// @match        https://atcoder.jp/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================
  // 1. 沙箱穿透与全局变量封装 (Sandbox & Logger)
  // ==========================================
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  class Logger {
    static prefix = '[OJ-Tracker]';
    static info(...args) {
      console.info(this.prefix, ...args);
    }
    static warn(...args) {
      console.warn(this.prefix, ...args);
    }
    static error(...args) {
      console.error(this.prefix, ...args);
    }
    static debug(...args) {
      console.debug(this.prefix, ...args);
    }
  }

  // ==========================================
  // 2. 本地持久化与幂等去重 (Storage & Deduplicator)
  // ==========================================
  const KEY_REPORTED_IDS = 'reported_ids';
  const KEY_BACKEND_URL = 'backend_url';
  const KEY_USER_TOKEN = 'user_token';
  const KEY_FAILED_QUEUE = 'failed_payload_queue';
  const MAX_DEDUPLICATION_CAPACITY = 500;

  class Storage {
    static cachedReportedSet = null;

    static init(onOpenConfigModal) {
      if (typeof GM_registerMenuCommand === 'function' && onOpenConfigModal) {
        GM_registerMenuCommand('⚙️ 打开 OJ Tracker 配置面板', onOpenConfigModal);
      }
    }

    static getBackendUrl() {
      const val = typeof GM_getValue === 'function'
        ? GM_getValue(KEY_BACKEND_URL, '')
        : localStorage.getItem(KEY_BACKEND_URL) || '';
      return val || 'http://localhost:8000/api/v1/submissions/push';
    }

    static setBackendUrl(url) {
      const trimmed = url.trim();
      if (typeof GM_setValue === 'function') {
        GM_setValue(KEY_BACKEND_URL, trimmed);
      } else {
        localStorage.setItem(KEY_BACKEND_URL, trimmed);
      }
    }

    static getUserToken() {
      if (typeof GM_getValue === 'function') {
        return GM_getValue(KEY_USER_TOKEN, '');
      }
      return localStorage.getItem(KEY_USER_TOKEN) || '';
    }

    static setUserToken(token) {
      const trimmed = token.trim();
      if (typeof GM_setValue === 'function') {
        GM_setValue(KEY_USER_TOKEN, trimmed);
      } else {
        localStorage.setItem(KEY_USER_TOKEN, trimmed);
      }
    }

    static isDuplicate(platform, submissionId) {
      if (!submissionId) return false;
      const key = `${platform}:${submissionId}`;
      const set = this.getReportedSet();
      return set.has(key);
    }

    static markReported(platform, submissionId) {
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

    static getReportedCount() {
      return this.getReportedList().length;
    }

    static clearReported() {
      this.saveReportedList([]);
      this.cachedReportedSet = new Set();
    }

    static getFailedQueue() {
      try {
        if (typeof GM_getValue === 'function') {
          return GM_getValue(KEY_FAILED_QUEUE, []) || [];
        }
        const raw = localStorage.getItem(KEY_FAILED_QUEUE);
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    }

    static saveFailedPayload(payload) {
      try {
        const queue = this.getFailedQueue();
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

    static removeFailedPayload(platform, submissionId) {
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

    static getReportedList() {
      try {
        if (typeof GM_getValue === 'function') {
          return GM_getValue(KEY_REPORTED_IDS, []) || [];
        }
        const raw = localStorage.getItem(KEY_REPORTED_IDS);
        return raw ? JSON.parse(raw) : [];
      } catch (_) {
        return [];
      }
    }

    static saveReportedList(list) {
      if (typeof GM_setValue === 'function') {
        GM_setValue(KEY_REPORTED_IDS, list);
      } else {
        localStorage.setItem(KEY_REPORTED_IDS, JSON.stringify(list));
      }
      this.cachedReportedSet = new Set(list);
    }

    static getReportedSet() {
      if (!this.cachedReportedSet) {
        this.cachedReportedSet = new Set(this.getReportedList());
      }
      return this.cachedReportedSet;
    }
  }

  // ==========================================
  // 3. 核心网络总线 (NetworkHookBus)
  // ==========================================
  class NetworkHookBus {
    static httpListeners = [];
    static wsListeners = [];
    static initialized = false;
    static rawFetch = null;

    static init(targetWindow) {
      if (this.initialized) return;
      this.initialized = true;

      // 1. 保存原生 fetch 供内部主动轮询使用，避免死循环拦截
      const originalFetch = targetWindow.fetch ? targetWindow.fetch.bind(targetWindow) : fetch.bind(window);
      this.rawFetch = originalFetch;

      // 2. 劫持 Fetch
      if (targetWindow.fetch) {
        targetWindow.fetch = async function (...args) {
          let url = '';
          let method = 'GET';
          let requestBody = null;

          const input = args[0];
          const init = args[1];

          if (typeof input === 'string') {
            url = input;
          } else if (input instanceof URL) {
            url = input.toString();
          } else if (input && typeof input.url === 'string') {
            url = input.url;
            method = input.method || 'GET';
          }

          if (init) {
            method = (init.method || method).toUpperCase();
            if (typeof init.body === 'string') {
              requestBody = init.body;
            } else if (init.body instanceof URLSearchParams) {
              requestBody = init.body.toString();
            } else if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
              try {
                const pairs = [];
                init.body.forEach((val, key) => {
                  if (typeof val === 'string') {
                    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
                  }
                });
                requestBody = pairs.join('&');
              } catch (_) {}
            }
          }

          const response = await originalFetch(...args);

          // 关键防坑：克隆响应流，异步读取文本，严禁消费原始流
          try {
            const cloned = response.clone();
            cloned
              .text()
              .then((text) => {
                NetworkHookBus.emitHttp({
                  type: 'fetch',
                  method: method.toUpperCase(),
                  url,
                  requestBody,
                  status: response.status,
                  responseText: text,
                });
              })
              .catch(() => {});
          } catch (_) {}

          return response;
        };
      }

      // 3. 劫持 XMLHttpRequest
      const OriginalXHR = targetWindow.XMLHttpRequest;
      if (OriginalXHR && OriginalXHR.prototype) {
        const originalOpen = OriginalXHR.prototype.open;
        const originalSend = OriginalXHR.prototype.send;

        OriginalXHR.prototype.open = function (method, url, ...rest) {
          this._tmMethod = (method || 'GET').toUpperCase();
          this._tmUrl = String(url);
          return originalOpen.apply(this, [method, url, ...rest]);
        };

        OriginalXHR.prototype.send = function (body) {
          let reqBody = null;
          if (typeof body === 'string') {
            reqBody = body;
          } else if (body instanceof URLSearchParams) {
            reqBody = body.toString();
          } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
            try {
              const pairs = [];
              body.forEach((val, key) => {
                if (typeof val === 'string') {
                  pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
                }
              });
              reqBody = pairs.join('&');
            } catch (_) {}
          }
          this.addEventListener('load', function () {
            try {
              if (this.responseType === '' || this.responseType === 'text') {
                NetworkHookBus.emitHttp({
                  type: 'xhr',
                  method: this._tmMethod || 'GET',
                  url: this._tmUrl || '',
                  requestBody: reqBody,
                  status: this.status,
                  responseText: this.responseText || '',
                });
              } else if (this.responseType === 'json' && this.response) {
                NetworkHookBus.emitHttp({
                  type: 'xhr',
                  method: this._tmMethod || 'GET',
                  url: this._tmUrl || '',
                  requestBody: reqBody,
                  status: this.status,
                  responseText: typeof this.response === 'string' ? this.response : JSON.stringify(this.response),
                });
              }
            } catch (_) {}
          });
          return originalSend.call(this, body);
        };
      }

      // 4. 劫持 WebSocket
      const OriginalWS = targetWindow.WebSocket;
      if (OriginalWS) {
        const PatchedWS = function (url, protocols) {
          const wsInstance = protocols
            ? new OriginalWS(url, protocols)
            : new OriginalWS(url);

          try {
            wsInstance.addEventListener('message', (event) => {
              if (typeof event.data === 'string') {
                NetworkHookBus.emitWs(String(url), event.data);
              }
            });
          } catch (_) {}

          return wsInstance;
        };

        PatchedWS.prototype = OriginalWS.prototype;
        Object.assign(PatchedWS, OriginalWS);
        targetWindow.WebSocket = PatchedWS;
      }

      Logger.info('NetworkHookBus initialized on target window.');
    }

    static onHttp(listener) {
      this.httpListeners.push(listener);
    }

    static onWs(listener) {
      this.wsListeners.push(listener);
    }

    static emitHttp(event) {
      for (const fn of this.httpListeners) {
        try {
          fn(event);
        } catch (e) {
          Logger.error('HTTP listener error:', e);
        }
      }
    }

    static emitWs(url, data) {
      for (const fn of this.wsListeners) {
        try {
          fn(url, data);
        } catch (e) {
          Logger.error('WS listener error:', e);
        }
      }
    }
  }

  // ==========================================
  // 4. SPA 路由变化监听 (RouterHookBus)
  // ==========================================
  class RouterHookBus {
    static listeners = [];
    static initialized = false;
    static currentUrl = '';

    static init(targetWindow) {
      if (this.initialized) return;
      this.initialized = true;
      this.currentUrl = targetWindow.location.href;

      const history = targetWindow.history;
      if (history) {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function (...args) {
          const oldUrl = RouterHookBus.currentUrl;
          originalPushState.apply(this, args);
          const newUrl = targetWindow.location.href;
          if (newUrl !== oldUrl) {
            RouterHookBus.currentUrl = newUrl;
            RouterHookBus.emitRouteChange(newUrl, oldUrl);
          }
        };

        history.replaceState = function (...args) {
          const oldUrl = RouterHookBus.currentUrl;
          originalReplaceState.apply(this, args);
          const newUrl = targetWindow.location.href;
          if (newUrl !== oldUrl) {
            RouterHookBus.currentUrl = newUrl;
            RouterHookBus.emitRouteChange(newUrl, oldUrl);
          }
        };
      }

      targetWindow.addEventListener('popstate', () => {
        const oldUrl = RouterHookBus.currentUrl;
        const newUrl = targetWindow.location.href;
        RouterHookBus.currentUrl = newUrl;
        RouterHookBus.emitRouteChange(newUrl, oldUrl);
      });

      targetWindow.addEventListener('hashchange', () => {
        const oldUrl = RouterHookBus.currentUrl;
        const newUrl = targetWindow.location.href;
        RouterHookBus.currentUrl = newUrl;
        RouterHookBus.emitRouteChange(newUrl, oldUrl);
      });

      Logger.info('RouterHookBus initialized.');
    }

    static onRouteChange(listener) {
      this.listeners.push(listener);
    }

    static emitRouteChange(newUrl, oldUrl) {
      for (const listener of this.listeners) {
        try {
          listener(newUrl, oldUrl);
        } catch (e) {
          Logger.error('Route change listener error:', e);
        }
      }
    }
  }

  // ==========================================
  // 5. 跨域传输器与重试控制 (Transport)
  // ==========================================
  class Transport {
    static statusListeners = [];
    static isFlushingFailedQueue = false;
    static inflightSet = new Set();

    static onStatus(listener) {
      this.statusListeners.push(listener);
    }

    static notifyStatus(status, message) {
      for (const fn of this.statusListeners) {
        try {
          fn(status, message);
        } catch (e) {
          Logger.error('Status listener error:', e);
        }
      }
    }

    static async send(payload, retryCount = 0) {
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

      return new Promise((resolve) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
          Logger.error('GM_xmlhttpRequest is not available in current environment!');
          this.notifyStatus('error', 'GM_xmlhttpRequest 未授权');
          Storage.saveFailedPayload(payload);
          this.inflightSet.delete(flightKey);
          resolve(false);
          return;
        }

        const headers = {
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

              // 补发离线队列
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

    static handleRetry(payload, retryCount, resolve, reason) {
      const flightKey = `${payload.platform}:${payload.platformSubmissionId}`;
      const MAX_RETRIES = 3;
      if (retryCount < MAX_RETRIES) {
        const delayMs = Math.pow(2, retryCount) * 1000;
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
        this.notifyStatus('error', `同步失败 (${reason})，已暂存离线队列`);
        resolve(false);
      }
    }

    static async flushOfflineQueue() {
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
          if (!ok) break;
        } catch (e) {
          Logger.error('[Transport] Error during offline flush:', e);
          break;
        }
      }
      this.isFlushingFailedQueue = false;
    }
  }

  // ==========================================
  // 6. 基础适配器与平台适配器 (Adapters)
  // ==========================================
  class BaseAdapter {
    platform = 'other';
    matchDomain(hostname) {
      return false;
    }
    init() {}
    async submitPayload(payload) {
      Logger.info(`[${this.platform}] Submitting payload for problem: ${payload.problemId}, verdict: ${payload.verdict}`);
      return Transport.send(payload);
    }
  }

  // 6.1 力扣中国适配器 (LeetCodeAdapter)
  class LeetCodeAdapter extends BaseAdapter {
    platform = 'leetcode_cn';
    pendingMap = new Map();

    matchDomain(hostname) {
      return hostname === 'leetcode.cn' || hostname.endsWith('.leetcode.cn');
    }

    init() {
      Logger.info('[LeetCodeAdapter] Initialized.');
      NetworkHookBus.onHttp((event) => {
        this.handleHttpEvent(event);
      });

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.initDomObserver());
      } else {
        this.initDomObserver();
      }
    }

    handleHttpEvent(event) {
      if (event.method === 'POST') {
        const submitMatch = event.url.match(/(?:problems|contest\/[^/]+\/problems)\/([^/]+)\/submit\/?/);
        if (submitMatch) {
          this.handleSubmitRequest(submitMatch[1], event);
          return;
        }

        if (event.url.includes('/graphql') && event.responseText && (event.responseText.includes('submissionDetail') || event.responseText.includes('statusDisplay'))) {
          this.handleGraphQLSubmissionDetail(event);
          return;
        }
      }

      if (event.method === 'GET') {
        const checkMatch = event.url.match(/\/submissions\/detail\/(\d+)\/check\/?/);
        if (checkMatch) {
          this.handleCheckResponse(checkMatch[1], event.responseText);
        }
      }
    }

    handleSubmitRequest(titleSlug, event) {
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

    startPollingCheckStatus(submissionId, titleSlug) {
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

    handleCheckResponse(submissionId, responseText) {
      try {
        if (!responseText) return;
        const data = JSON.parse(responseText);

        if (data.state !== 'SUCCESS') return;

        const pending = this.pendingMap.get(submissionId);
        const verdict = this.mapStatusCodeToVerdict(data.status_code);

        const runtimeMs = this.cleanRuntime(data.status_runtime);
        const memoryKb = this.cleanMemory(data.status_memory);
        const problemSlug = pending?.titleSlug || this.extractSlugFromUrl();
        const problemTitle = this.extractProblemTitle() || problemSlug;
        const userHandle = this.extractUserHandle();

        const payload = {
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

    handleGraphQLSubmissionDetail(event) {
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

        const payload = {
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

    initDomObserver() {
      if (typeof MutationObserver === 'undefined') return;
      let debounceTimer = null;
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

    scanDomForSubmissionResult() {
      if (!this.pendingMap.size) return;

      const pageText = document.body.innerText || '';
      let foundVerdict = null;
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

      const payload = {
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

    extractSlugFromUrl() {
      const m = window.location.pathname.match(/\/problems\/([^/]+)/);
      return m ? m[1] : 'unknown';
    }

    extractProblemTitle() {
      try {
        const rawTitle = document.title || '';
        const cleaned = rawTitle.replace(/\s*-\s*力扣.*$/, '').replace(/^\d+\.\s*/, '').trim();
        if (cleaned) return cleaned;
        const h4 = document.querySelector('h4, [data-e2e-locator="question-title"]');
        if (h4?.textContent) return h4.textContent.replace(/^\d+\.\s*/, '').trim();
      } catch (_) {}
      return '';
    }

    mapStatusCodeToVerdict(code) {
      switch (code) {
        case 10: return 'AC';
        case 11: return 'WA';
        case 12: return 'MLE';
        case 13: return 'OTHER';
        case 14: return 'TLE';
        case 15: return 'RE';
        case 20: return 'CE';
        default: return 'OTHER';
      }
    }

    mapStatusDisplayToVerdict(display) {
      const s = display.toLowerCase();
      if (s.includes('accepted')) return 'AC';
      if (s.includes('wrong answer')) return 'WA';
      if (s.includes('time limit')) return 'TLE';
      if (s.includes('memory limit')) return 'MLE';
      if (s.includes('runtime error')) return 'RE';
      if (s.includes('compile error')) return 'CE';
      return 'OTHER';
    }

    cleanRuntime(val) {
      if (!val || val === 'N/A') return 0;
      if (typeof val === 'number') return val;
      const match = String(val).match(/(\d+)\s*ms/i);
      return match ? parseInt(match[1], 10) : parseInt(String(val), 10) || 0;
    }

    cleanMemory(val) {
      if (!val || val === 'N/A') return 0;
      if (typeof val === 'number') return val;
      const s = String(val);
      const mbMatch = s.match(/([\d.]+)\s*MB/i);
      if (mbMatch) return Math.round(parseFloat(mbMatch[1]) * 1024);
      const kbMatch = s.match(/([\d.]+)\s*KB/i);
      if (kbMatch) return Math.round(parseFloat(kbMatch[1]));
      return Math.round(parseFloat(s) * 1024) || 0;
    }

    extractUserHandle() {
      try {
        const userAvatar = document.querySelector('a[href^="/u/"]');
        if (userAvatar) {
          const href = userAvatar.getAttribute('href');
          const m = href?.match(/\/u\/([^/]+)/);
          if (m) return m[1];
        }
        if (pageWindow.userStatus?.username) {
          return pageWindow.userStatus.username;
        }
        const nextData = pageWindow.__NEXT_DATA__;
        if (nextData?.props?.pageProps?.userStatus?.username) {
          return nextData.props.pageProps.userStatus.username;
        }
      } catch (_) {}
      return undefined;
    }
  }

  // 6.2 洛谷适配器 (LuoguAdapter)
  class LuoguAdapter extends BaseAdapter {
    platform = 'luogu';
    pendingMap = new Map();
    activePollers = new Set();

    matchDomain(hostname) {
      return hostname === 'www.luogu.com.cn' || hostname === 'luogu.com.cn';
    }

    init() {
      Logger.info('[LuoguAdapter] Initialized.');

      NetworkHookBus.onHttp((event) => {
        this.handleHttpEvent(event);
      });

      RouterHookBus.onRouteChange((newUrl) => {
        this.checkUrlForRecord(newUrl);
      });

      if (typeof window !== 'undefined' && window.location) {
        this.checkUrlForRecord(window.location.href);
      }
    }

    handleHttpEvent(event) {
      if (event.method !== 'POST') return;

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

        this.startActivePolling(ridStr);
      } catch (e) {
        Logger.error('[LuoguAdapter] Error parsing submit response:', e);
      }
    }

    checkUrlForRecord(url) {
      const match = url.match(/\/record\/(\d+)/);
      if (match) {
        const rid = match[1];
        if (!Storage.isDuplicate(this.platform, rid) && !this.activePollers.has(rid)) {
          Logger.info(`[LuoguAdapter] Detected record page for rid: ${rid}, starting active polling...`);
          this.startActivePolling(rid);
        }
      }
    }

    startActivePolling(rid) {
      if (this.activePollers.has(rid)) return;
      if (Storage.isDuplicate(this.platform, rid)) return;

      this.activePollers.add(rid);
      Transport.notifyStatus('syncing', `正在等待洛谷评测出资 (rid: ${rid})...`);

      let attempts = 0;
      const maxAttempts = 20;
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

        if (this.activePollers.has(rid)) {
          setTimeout(poll, intervalMs);
        }
      };

      setTimeout(poll, 1200);
    }

    parseRecordData(text) {
      if (!text) return null;

      if (text.trim().startsWith('{')) {
        try {
          const json = JSON.parse(text);
          if (json.currentData?.record) return json.currentData.record;
          if (json.data?.record) return json.data.record;
          if (json.record) return json.record;
        } catch (_) {}
      }

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

    handleRecordFinished(rid, record) {
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

      const payload = {
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

    mapLuoguLanguage(langId) {
      const map = {
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

    mapStatusToVerdict(status, score) {
      switch (status) {
        case 12: return 'AC';
        case 14: return score > 0 ? 'PA' : 'WA';
        case 7: return 'CE';
        case 2: return 'TLE';
        case 3: return 'MLE';
        case 4: return 'RE';
        default: return 'WA';
      }
    }
  }

  // 6.3 AcWing 适配器 (AcWingAdapter)
  class AcWingAdapter extends BaseAdapter {
    platform = 'acwing';
    pendingSubmission = null;
    observerInitialized = false;

    matchDomain(hostname) {
      return hostname === 'www.acwing.com' || hostname === 'acwing.com';
    }

    init() {
      Logger.info('[AcWingAdapter] Initialized.');

      // 通道 A-1: 监听 HTTP / XHR 请求
      NetworkHookBus.onHttp((event) => {
        this.handleHttpEvent(event);
      });

      // 通道 A-2: 监听 WebSocket 实时推送
      NetworkHookBus.onWs((url, data) => {
        this.handleWsMessage(url, data);
      });

      // 通道 B: DOM MutationObserver 兜底
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.initDomObserver());
      } else {
        this.initDomObserver();
      }

      // 监听代码提交按钮点击（事件委托）以捕获源码与语言
      this.bindSubmitButtonListener();
    }

    /**
     * 使用事件委托监听提交按钮点击，不依赖 DOM 加载时的按钮存在
     */
    bindSubmitButtonListener() {
      document.addEventListener('click', (event) => {
        const target = event.target;
        if (!target) return;

        const btn = target.closest('#submit_code_btn, button.btn-run, button[type="submit"], .btn-submit-code, button:has(.fa-send)');
        if (btn) {
          Logger.info('[AcWingAdapter] Submit button clicked (delegated). Capturing editor state...');
          this.captureEditorState();
        }
      }, true);
    }

    /**
     * 获取有效的 pendingSubmission（超过 10 分钟自动过期抛弃，防止数据串线）
     */
    getValidPendingSubmission() {
      if (!this.pendingSubmission) return null;
      const EXPIRY_MS = 10 * 60 * 1000; // 10 分钟过期
      if (Date.now() - this.pendingSubmission.timestamp > EXPIRY_MS) {
        Logger.warn('[AcWingAdapter] Pending submission expired (>10min), discarding.');
        this.pendingSubmission = null;
        return null;
      }
      return this.pendingSubmission;
    }

    /**
     * 从 Ace Editor 或页面 DOM 中截获代码与语言
     */
    captureEditorState() {
      try {
        let code = '';
        let language = 'unknown';

        // 1. 尝试从 Ace Editor 获取代码与语言模式
        const ace = pageWindow.ace;
        if (ace && typeof ace.edit === 'function') {
          const editor = ace.edit('code_editor') || ace.edit(document.querySelector('#code_editor'));
          if (editor) {
            if (typeof editor.getValue === 'function') {
              code = editor.getValue();
            }
            if (editor.getSession) {
              const modeId = editor.getSession().getMode()?.$id || '';
              if (modeId.includes('c_cpp')) language = 'C++';
              else if (modeId.includes('python')) language = 'Python3';
              else if (modeId.includes('java')) language = 'Java';
              else if (modeId.includes('golang')) language = 'Go';
              else if (modeId.includes('rust')) language = 'Rust';
              else if (modeId.includes('javascript')) language = 'JavaScript';
            }
          }
        }

        if (!code) {
          const textarea = document.querySelector('#code_editor textarea, textarea[name="code"]');
          if (textarea && textarea.value) {
            code = textarea.value;
          }
        }

        // 2. 若编辑器未取到语言，从 DOM select 控件中提取
        if (!language || language === 'unknown') {
          const domLang = this.extractLanguageFromDom();
          if (domLang && domLang !== 'unknown') {
            language = domLang;
          }
        }

        // 3. 提取题目 ID 与标题
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

        Logger.info(`[AcWingAdapter] Captured editor code for ${problemId}, lang: ${language}, length: ${code.length}`);
        Transport.notifyStatus('syncing', `AcWing 已提交判题: ${problemTitle || problemId}...`);
      } catch (e) {
        Logger.error('[AcWingAdapter] Error capturing editor state:', e);
      }
    }

    /**
     * 4级优先级解析语言：
     * ① 提交请求体里的 language 字段
     * ② 判题响应或 WS 消息里的语言字段
     * ③ 页面 DOM 读取 (Select / Ace Editor Mode / 激活按钮)
     * ④ 从该提交的 code_detail 页或提交列表行里取
     */
    resolveLanguage(reqLang, respLang, sid) {
      // 优先级 1: 提交请求体里的 language
      if (reqLang && reqLang !== 'unknown' && reqLang.trim() !== '') {
        return reqLang.trim();
      }

      // 优先级 2: 判题响应或 WS 消息里的语言字段
      if (respLang && respLang !== 'unknown' && respLang.trim() !== '') {
        return respLang.trim();
      }

      // 优先级 3: pendingSubmission 或页面 DOM 读取
      const pending = this.getValidPendingSubmission();
      if (pending && pending.language && pending.language !== 'unknown') {
        return pending.language;
      }

      const domLang = this.extractLanguageFromDom();
      if (domLang && domLang !== 'unknown') {
        return domLang;
      }

      // 优先级 4: 从该提交的 code_detail 页或提交列表行中提取
      if (sid) {
        const listLang = this.extractLanguageFromSubmissionList(sid);
        if (listLang && listLang !== 'unknown') {
          return listLang;
        }
      }

      return 'unknown';
    }

    extractLanguageFromDom() {
      try {
        const langSelect = document.querySelector('#code_language, select[name="language"]');
        if (langSelect) {
          const opt = langSelect.options[langSelect.selectedIndex];
          const val = opt?.text?.trim() || opt?.value?.trim() || langSelect.value?.trim();
          if (val && val !== 'unknown') return val;
        }

        const activeBtn = document.querySelector('.btn-language.active, [data-language].active');
        if (activeBtn) {
          const val = activeBtn.getAttribute('data-language') || activeBtn.textContent?.trim();
          if (val) return val;
        }

        const ace = pageWindow.ace;
        if (ace && typeof ace.edit === 'function') {
          const editor = ace.edit('code_editor') || ace.edit(document.querySelector('#code_editor'));
          if (editor && editor.getSession) {
            const modeId = editor.getSession().getMode()?.$id || '';
            if (modeId.includes('c_cpp')) return 'C++';
            if (modeId.includes('python')) return 'Python3';
            if (modeId.includes('java')) return 'Java';
            if (modeId.includes('golang')) return 'Go';
            if (modeId.includes('rust')) return 'Rust';
            if (modeId.includes('javascript')) return 'JavaScript';
          }
        }
      } catch (_) {}
      return 'unknown';
    }

    extractLanguageFromSubmissionList(sid) {
      try {
        const link = document.querySelector(`a[href*="/code_detail/${sid}/"], tr[data-submission-id="${sid}"]`);
        if (link) {
          const row = link.closest('tr');
          if (row) {
            const langCell = row.querySelector('.submission-language, .language, td:nth-child(4)');
            const text = langCell?.textContent?.trim();
            if (text && !text.includes(':') && !text.includes('/')) return text;
          }
        }
      } catch (_) {}
      return 'unknown';
    }

    handleHttpEvent(event) {
      // 拦截提交请求并捕获可能附带的源码与语言（同时支持 URLSearchParams / string / FormData / JSON）
      if (event.method === 'POST' && event.url.includes('/problem/content/submission/')) {
        if (event.requestBody && typeof event.requestBody === 'string') {
          try {
            let code = null;
            let lang = null;

            if (event.requestBody.startsWith('{') || event.requestBody.startsWith('[')) {
              const json = JSON.parse(event.requestBody);
              code = json.code || null;
              lang = json.language || json.lang || null;
            } else {
              const params = new URLSearchParams(event.requestBody);
              code = params.get('code');
              lang = params.get('language');
            }

            if (code || lang) {
              const urlMatch = event.url.match(/\/problem\/content\/submission\/(\d+)/);
              const problemId = urlMatch ? `acwing_${urlMatch[1]}` : (this.pendingSubmission?.problemId || 'acwing_unknown');
              const prev = this.getValidPendingSubmission();

              this.pendingSubmission = {
                problemId,
                problemTitle: prev?.problemTitle || '',
                code: code || prev?.code || '',
                language: lang || prev?.language || 'unknown',
                timestamp: Date.now(),
              };
              Logger.info(`[AcWingAdapter] Captured submission POST params. Lang: ${this.pendingSubmission.language}`);
            }
          } catch (_) {}
        }
      }

      if (event.responseText && (event.url.includes('/submission') || event.url.includes('/wss/'))) {
        this.checkTerminalResultInText(event.responseText);
      }
    }

    handleWsMessage(url, data) {
      if (!data) return;
      this.checkTerminalResultInText(data);
    }

    checkTerminalResultInText(text) {
      try {
        let statusStr = '';
        let submissionId = '';
        let timeMs = 0;
        let memoryKb = 0;
        let respLang = '';

        if (text.startsWith('{') || text.startsWith('[')) {
          const json = JSON.parse(text);
          statusStr = json.status || json.result || json.state || '';
          submissionId = String(json.submission_id || json.record_id || json.id || '');
          respLang = json.language || json.lang || json.code_language || '';
          if (json.time) timeMs = parseInt(String(json.time), 10) || 0;
          if (json.memory) memoryKb = parseInt(String(json.memory), 10) || 0;
        } else {
          const match = text.match(/"status":\s*"([^"]+)"/);
          if (match) statusStr = match[1];
          const langMatch = text.match(/"(?:language|lang)":\s*"([^"]+)"/);
          if (langMatch) respLang = langMatch[1];
        }

        if (!statusStr) return;

        const verdict = this.mapStatusStringToVerdict(statusStr);
        if (verdict) {
          if (!submissionId || !/^\d+$/.test(submissionId)) {
            const domSid = this.findRecentSubmissionIdFromDom();
            if (domSid && /^\d+$/.test(domSid)) {
              submissionId = domSid;
            }
          }

          // 严禁生成 acwing_auto_* / acwing_dom_* 这类伪造 ID，必须是真实编号
          if (!submissionId || !/^\d+$/.test(submissionId)) {
            Logger.warn('[AcWingAdapter] Real submission ID not found in WS/JSON yet. Waiting for DOM update...');
            return;
          }

          this.emitUnifiedSubmission(submissionId, verdict, statusStr, timeMs, memoryKb, respLang);
        }
      } catch (_) {}
    }

    initDomObserver() {
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

    scanDomForStatus() {
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

      let submissionId = '';
      const detailLink = document.querySelector('a[href*="/problem/content/submission/code_detail/"]');
      if (detailLink) {
        const m = detailLink.getAttribute('href')?.match(/\/problem\/content\/submission\/code_detail\/(\d+)/);
        if (m) submissionId = m[1];
      }
      if (!submissionId) {
        const domSid = this.findRecentSubmissionIdFromDom();
        if (domSid && /^\d+$/.test(domSid)) {
          submissionId = domSid;
        }
      }

      // 若无法提取到纯数字真实 ID，跳过以避免假数据入库
      if (!submissionId || !/^\d+$/.test(submissionId)) {
        return;
      }

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

    findRecentSubmissionIdFromDom() {
      const links = document.querySelectorAll('a[href*="/code_detail/"]');
      for (let i = 0; i < links.length; i++) {
        const href = links[i].getAttribute('href') || '';
        const m = href.match(/\/code_detail\/(\d+)/);
        if (m && m[1]) return m[1];
      }
      return null;
    }

    emitUnifiedSubmission(submissionId, verdict, rawStatus, timeMs, memoryKb, respLang) {
      if (Storage.isDuplicate(this.platform, submissionId)) return;

      const pending = this.getValidPendingSubmission();
      const urlMatch = window.location.pathname.match(/\/problem\/content\/(?:submission\/code_detail\/|submission\/|)(\d+)/);
      const problemId = pending?.problemId || (urlMatch ? `acwing_${urlMatch[1]}` : 'acwing_unknown');
      const problemTitle = pending?.problemTitle || document.querySelector('.problem-content-title')?.textContent?.trim() || problemId;

      // 解析语言（四层优先级判定）
      const language = this.resolveLanguage(pending?.language, respLang, submissionId);

      const payload = {
        platform: 'acwing',
        platformSubmissionId: String(submissionId),
        problemId,
        problemTitle,
        problemUrl: window.location.href,
        platformUserHandle: this.extractUserHandle(),
        verdict,
        rawStatus,
        score: verdict === 'AC' ? 100 : 0,
        language: language !== 'unknown' ? language : 'C++',
        sourceCode: pending?.code || '',
        executionTimeMs: timeMs,
        memoryUsedKb: memoryKb,
        submittedAt: pending?.timestamp || Date.now(),
        clientVersion: '1.0.0',
      };

      // 关键操作：使用完毕后立即清除 pendingSubmission，防止泄漏到下次提交
      this.pendingSubmission = null;

      this.submitPayload(payload);
    }

    mapStatusStringToVerdict(status) {
      const s = status.toLowerCase();
      if (s.includes('accepted') || s.includes('通过')) return 'AC';
      if (s.includes('wrong answer') || s.includes('答案错误')) return 'WA';
      if (s.includes('time limit') || s.includes('时间超限')) return 'TLE';
      if (s.includes('memory limit') || s.includes('内存超限')) return 'MLE';
      if (s.includes('runtime error') || s.includes('运行时错误')) return 'RE';
      if (s.includes('compile error') || s.includes('编译错误')) return 'CE';
      return null;
    }

    extractUserHandle() {
      try {
        const userElem = document.querySelector('#user-menu a[href*="/user/profile/"], a.navbar-user-name');
        return userElem?.textContent?.trim();
      } catch (_) {
        return undefined;
      }
    }
  }

  // 6.4 Codeforces 适配器 (CodeforcesAdapter)
  class CodeforcesAdapter extends BaseAdapter {
    platform = 'codeforces';
    observedCells = new Set();
    observer = null;

    matchDomain(hostname) {
      return (
        hostname === 'codeforces.com' ||
        hostname.endsWith('.codeforces.com') ||
        hostname === 'mirror.codeforces.com'
      );
    }

    init() {
      Logger.info('[CodeforcesAdapter] Initialized.');

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.startScanning());
      } else {
        this.startScanning();
      }
    }

    startScanning() {
      this.scanStatusTable();

      this.observer = new MutationObserver(() => {
        this.scanStatusTable();
      });

      const target = document.querySelector('.status-frame-datatable, .datatable, #pageContent') || document.body;
      this.observer.observe(target, {
        childList: true,
        subtree: true,
      });
    }

    scanStatusTable() {
      const rows = document.querySelectorAll('table.status-frame-datatable tr[data-submission-id], .datatable table tr[data-submission-id]');
      if (!rows || rows.length === 0) return;

      const maxScan = Math.min(rows.length, 10);
      for (let i = 0; i < maxScan; i++) {
        const row = rows[i];
        this.processRow(row);
      }
    }

    processRow(row) {
      const submissionId = row.getAttribute('data-submission-id');
      if (!submissionId) return;

      if (Storage.isDuplicate(this.platform, submissionId)) return;

      const verdictCell = row.querySelector('td.status-cell.status-verdict-cell, td[waiting]');
      if (!verdictCell) return;

      const waiting = verdictCell.getAttribute('waiting');

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

      this.extractAndSubmit(row, submissionId, verdictCell);
    }

    extractAndSubmit(row, submissionId, verdictCell) {
      if (Storage.isDuplicate(this.platform, submissionId)) return;

      const problemLink = row.querySelector('td[data-problemid] a, a[href*="/problem/"]');
      let problemId = 'CF_UNKNOWN';
      let problemTitle = '';
      let problemUrl = '';

      if (problemLink) {
        problemUrl = problemLink.href;
        problemTitle = problemLink.textContent?.trim() || '';
        const href = problemLink.getAttribute('href') || '';

        const contestMatch = href.match(/(?:contest|problemset\/problem)\/(\d+)\/([A-Za-z0-9_]+)/);
        if (contestMatch) {
          problemId = `${contestMatch[1]}${contestMatch[2]}`;
        } else {
          problemId = problemTitle;
        }
      }

      const verdict = this.parseVerdict(verdictCell);
      const rawStatus = verdictCell.textContent?.trim() || '';

      const timeCell = row.querySelector('td.time-consumed-cell');
      const timeMs = this.parseNumber(timeCell?.textContent || '');

      const memoryCell = row.querySelector('td.memory-consumed-cell');
      const memoryKb = this.parseNumber(memoryCell?.textContent || '');

      const langCell = row.querySelector('td:nth-child(4)');
      const language = langCell?.textContent?.trim() || 'unknown';
      const userHandle = this.extractUserHandle();

      const payload = {
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
        sourceCode: '',
        executionTimeMs: timeMs,
        memoryUsedKb: memoryKb,
        submittedAt: Date.now(),
        clientVersion: '1.0.0',
      };

      this.submitPayload(payload);
    }

    parseVerdict(cell) {
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

    parseNumber(str) {
      const match = str.match(/(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    }

    extractUserHandle() {
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

  // 6.5 AtCoder 适配器 (AtCoderAdapter)
  class AtCoderAdapter extends BaseAdapter {
    platform = 'atcoder';
    observedWaitingSids = new Set();
    observerInitialized = false;

    matchDomain(hostname) {
      return hostname === 'atcoder.jp' || hostname.endsWith('.atcoder.jp');
    }

    init() {
      Logger.info('[AtCoderAdapter] Initialized.');

      // 1. 拦截前端自动轮询的 /status/json 响应
      NetworkHookBus.onHttp((event) => {
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

    bindSubmitListener() {
      document.addEventListener('click', (e) => {
        const target = e.target;
        const btn = target?.closest('#submit, button[type="submit"], input[type="submit"]');
        if (btn && (window.location.pathname.includes('/tasks/') || window.location.pathname.includes('/submit'))) {
          Logger.info('[AtCoderAdapter] Submit button clicked. Waiting for judge...');
          Transport.notifyStatus('syncing', 'AtCoder 代码已提交，等待评测...');
        }
      }, true);
    }

    initDomObserver() {
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

    handleHttpEvent(event) {
      // 匹配 /contests/{cid}/submissions/me/status/json 或 /contests/{cid}/submissions/status/json
      if (event.url.includes('/status/json') && event.responseText) {
        try {
          const json = JSON.parse(event.responseText);
          const result = json.Result;
          if (!result || typeof result !== 'object') return;

          for (const [sid, item] of Object.entries(result)) {
            const detail = item;
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

    handleFinishedSubmission(sid, htmlSnippet) {
      if (Storage.isDuplicate(this.platform, sid)) return;

      const verdict = this.parseVerdictFromHtml(htmlSnippet);
      const score = this.parseScoreFromHtml(htmlSnippet);
      const timeMs = this.parseTimeFromHtml(htmlSnippet);
      const memoryKb = this.parseMemoryFromHtml(htmlSnippet);

      const { problemId, problemTitle, problemUrl, language, submittedAtMs } = this.extractRowMeta(sid);

      const payload = {
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
    scanStaticSubmissions() {
      const table = document.querySelector('table');
      if (!table) return;

      const rows = table.querySelectorAll('tbody tr');
      if (!rows || rows.length === 0) return;

      const cols = this.getTableColumnMap(table);
      const currentUser = this.extractUserHandle();

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const subLink = row.querySelector('a[href*="/submissions/"]');
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

    handleFinishedRow(sid, row, statusText, cols) {
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

      const payload = {
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
    getTableColumnMap(table) {
      const colMap = {
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

    extractRowMeta(sid, targetRow) {
      let row = targetRow;
      if (!row) {
        const link = document.querySelector(`a[href$="/submissions/${sid}"]`);
        if (link) {
          row = link.closest('tr');
        }
      }

      if (!row) {
        return { problemId: '', problemTitle: '', problemUrl: '', language: '', submittedAtMs: 0 };
      }

      const table = row.closest('table');
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
      const taskLink = taskCell?.querySelector('a[href*="/tasks/"]');
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

    parseVerdictFromHtml(html) {
      if (html.includes('>AC<') || html.includes('label-success')) return 'AC';
      if (html.includes('>WA<')) return 'WA';
      if (html.includes('>TLE<')) return 'TLE';
      if (html.includes('>MLE<')) return 'MLE';
      if (html.includes('>RE<')) return 'RE';
      if (html.includes('>CE<')) return 'CE';
      if (html.includes('>OLE<')) return 'OTHER';
      return 'OTHER';
    }

    mapStatusTextToVerdict(text) {
      const s = text.trim();
      if (s === 'AC') return 'AC';
      if (s === 'WA') return 'WA';
      if (s === 'TLE') return 'TLE';
      if (s === 'MLE') return 'MLE';
      if (s === 'RE') return 'RE';
      if (s === 'CE') return 'CE';
      return 'OTHER';
    }

    parseScoreFromHtml(html) {
      const m = html.match(/submission-score[^>]*>\s*(\d+)/i);
      return m ? parseInt(m[1], 10) : 0;
    }

    parseTimeFromHtml(html) {
      const m = html.match(/(\d+)\s*ms/i);
      return m ? parseInt(m[1], 10) : 0;
    }

    parseMemoryFromHtml(html) {
      const m = html.match(/(\d+)\s*KB/i);
      return m ? parseInt(m[1], 10) : 0;
    }

    parseTimeFromText(text) {
      const m = text.match(/(\d+)\s*ms/i);
      return m ? parseInt(m[1], 10) : 0;
    }

    parseMemoryFromText(text) {
      const m = text.match(/(\d+)\s*KB/i);
      return m ? parseInt(m[1], 10) : 0;
    }

    extractUserHandle() {
      try {
        const userLink = document.querySelector('a.username, a[href^="/users/"]');
        return userLink?.textContent?.trim();
      } catch (_) {
        return undefined;
      }
    }
  }

  // ==========================================
  // 7. 悬浮状态胶囊 UI (Shadow DOM)
  // ==========================================
  class StatusBadge {
    static hostElement = null;
    static shadowRoot = null;
    static isModalOpen = false;
    static currentPlatform = 'OJ';

    static init(platformName) {
      this.currentPlatform = platformName;

      const mount = () => {
        if (this.hostElement) return;
        this.createAndMountUI();
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
      } else {
        mount();
      }

      Transport.onStatus((status, message) => {
        this.updateStatus(status, message);
      });

      Storage.init(() => {
        this.toggleModal(true);
      });
    }

    static createAndMountUI() {
      try {
        this.hostElement = document.createElement('div');
        this.hostElement.id = 'oj-tracker-badge-host';
        this.hostElement.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; bottom: 20px; right: 20px;';

        this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });
        this.renderShadowContent();

        document.body.appendChild(this.hostElement);
        Logger.info('[StatusBadge] Mounted Shadow DOM UI successfully.');
      } catch (e) {
        Logger.error('[StatusBadge] Failed to mount UI:', e);
      }
    }

    static renderShadowContent() {
      if (!this.shadowRoot) return;

      const styles = `
        :host {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          color: #1f2937;
          box-sizing: border-box;
        }
        *, *::before, *::after {
          box-sizing: border-box;
        }

        .badge-capsule {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.94);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(229, 231, 235, 0.9);
          box-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.1), 0 2px 6px -1px rgba(0, 0, 0, 0.06);
          border-radius: 9999px;
          padding: 6px 12px;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          user-select: none;
        }
        .badge-capsule:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.14), 0 4px 10px -2px rgba(0, 0, 0, 0.08);
          background: #ffffff;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: #10b981;
          transition: background-color 0.3s ease;
          position: relative;
        }
        .status-dot.pulse {
          background-color: #3b82f6;
        }
        .status-dot.pulse::after {
          content: '';
          position: absolute;
          width: 100%;
          height: 100%;
          top: 0;
          left: 0;
          border-radius: 50%;
          background-color: #3b82f6;
          animation: pulse-ring 1.4s cubic-bezier(0.24, 0, 0.38, 1) infinite;
        }
        .status-dot.error {
          background-color: #ef4444;
        }
        .status-dot.synced {
          background-color: #10b981;
        }

        @keyframes pulse-ring {
          0% {
            transform: scale(0.95);
            opacity: 0.8;
          }
          70% {
            transform: scale(2.6);
            opacity: 0;
          }
          100% {
            transform: scale(2.6);
            opacity: 0;
          }
        }

        .badge-text {
          font-weight: 500;
          color: #374151;
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .btn-settings {
          background: none;
          border: none;
          padding: 2px 4px;
          cursor: pointer;
          font-size: 13px;
          color: #9ca3af;
          transition: color 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-settings:hover {
          color: #4b5563;
        }

        .modal-overlay {
          position: fixed;
          bottom: 60px;
          right: 20px;
          width: 330px;
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          border: 1px solid #e5e7eb;
          padding: 16px;
          display: none;
          animation: modal-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .modal-overlay.open {
          display: block;
        }
        @keyframes modal-fade-in {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #f3f4f6;
        }
        .modal-title {
          font-size: 14px;
          font-weight: 600;
          color: #111827;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .modal-close {
          background: none;
          border: none;
          font-size: 16px;
          cursor: pointer;
          color: #9ca3af;
          padding: 2px;
          line-height: 1;
        }
        .modal-close:hover {
          color: #4b5563;
        }

        .form-group {
          margin-bottom: 10px;
        }
        .form-label {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: #4b5563;
          margin-bottom: 4px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .form-input {
          width: 100%;
          padding: 6px 10px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 12px;
          color: #111827;
          outline: none;
          transition: border-color 0.2s;
        }
        .form-input:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
        }

        .stats-box {
          background: #f9fafb;
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 11px;
          color: #6b7280;
          margin-bottom: 12px;
          display: flex;
          justify-content: space-between;
        }

        .btn-row {
          display: flex;
          gap: 8px;
        }
        .btn {
          flex: 1;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border: none;
          transition: all 0.15s;
          text-align: center;
        }
        .btn-primary {
          background: #2563eb;
          color: #ffffff;
        }
        .btn-primary:hover {
          background: #1d4ed8;
        }
        .btn-secondary {
          background: #f3f4f6;
          color: #374151;
        }
        .btn-secondary:hover {
          background: #e5e7eb;
        }
        .btn-danger {
          background: #fee2e2;
          color: #b91c1c;
        }
        .btn-danger:hover {
          background: #fecaca;
        }

        .feedback-msg {
          font-size: 11px;
          margin-top: 8px;
          text-align: center;
          color: #059669;
          display: none;
        }
      `;

      this.shadowRoot.innerHTML = `
        <style>${styles}</style>
        
        <div class="badge-capsule" id="capsule">
          <span class="status-dot" id="status-dot"></span>
          <span class="badge-text" id="status-text">${this.currentPlatform} Ready</span>
          <button class="btn-settings" id="btn-open-settings" title="配置 OJ Tracker">⚙️</button>
        </div>

        <div class="modal-overlay" id="modal">
          <div class="modal-header">
            <div class="modal-title">
              <span>⚡ OJ Tracker 配置</span>
            </div>
            <button class="modal-close" id="btn-close-modal">&times;</button>
          </div>

          <div class="form-group">
            <label class="form-label">后端接收 API URL</label>
            <input type="text" class="form-input" id="input-backend-url" placeholder="http://localhost:8000/api/v1/submissions/push" />
          </div>

          <div class="form-group">
            <label class="form-label">个人认证 Token / 凭据 (Bearer)</label>
            <input type="password" class="form-input" id="input-user-token" placeholder="留空或输入 OIBoard 同步 Token / 用户名" />
            <div style="font-size: 10px; color: #9ca3af; margin-top: 3px; line-height: 1.4;">
              提示: 可在 OIBoard「设置 -> 账号设置」中复制当前同步凭据 (Sync Token) 填入此处，亦可留空或输入登录用户名。
            </div>
          </div>

          <div class="stats-box">
            <span>平台: <b>${this.currentPlatform}</b></span>
            <span id="cache-stats">缓存: ${Storage.getReportedCount()}/500</span>
          </div>

          <div class="btn-row" style="margin-bottom: 8px;">
            <button class="btn btn-secondary" id="btn-test-conn">测试连接</button>
            <button class="btn btn-primary" id="btn-save">保存配置</button>
          </div>

          <div class="btn-row">
            <button class="btn btn-danger" id="btn-clear-cache">清空去重缓存</button>
          </div>

          <div class="feedback-msg" id="feedback"></div>
        </div>
      `;

      this.bindEvents();
    }

    static bindEvents() {
      if (!this.shadowRoot) return;

      const capsule = this.shadowRoot.getElementById('capsule');
      const btnOpenSettings = this.shadowRoot.getElementById('btn-open-settings');
      const btnCloseModal = this.shadowRoot.getElementById('btn-close-modal');
      const btnSave = this.shadowRoot.getElementById('btn-save');
      const btnTest = this.shadowRoot.getElementById('btn-test-conn');
      const btnClearCache = this.shadowRoot.getElementById('btn-clear-cache');
      const inputUrl = this.shadowRoot.getElementById('input-backend-url');
      const inputToken = this.shadowRoot.getElementById('input-user-token');

      capsule?.addEventListener('click', (e) => {
        if (e.target !== btnOpenSettings) {
          this.toggleModal(!this.isModalOpen);
        }
      });

      btnOpenSettings?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleModal(!this.isModalOpen);
      });

      btnCloseModal?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleModal(false);
      });

      btnSave?.addEventListener('click', () => {
        const url = inputUrl?.value || '';
        const token = inputToken?.value || '';
        Storage.setBackendUrl(url);
        Storage.setUserToken(token);
        this.showFeedback('配置已保存 ✓', '#059669');
      });

      btnTest?.addEventListener('click', () => {
        const url = inputUrl?.value || Storage.getBackendUrl();
        const token = inputToken?.value || Storage.getUserToken();
        this.showFeedback('正在测试连接...', '#3b82f6');

        if (typeof GM_xmlhttpRequest === 'function') {
          GM_xmlhttpRequest({
            method: 'GET',
            url: url.replace('/push', '/health') || url,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            timeout: 5000,
            onload: (res) => {
              if (res.status >= 200 && res.status < 400) {
                this.showFeedback(`连接成功 (HTTP ${res.status}) ✓`, '#059669');
              } else {
                this.showFeedback(`服务响应 HTTP ${res.status}`, '#d97706');
              }
            },
            onerror: () => {
              this.showFeedback('连接失败：网络错误或跨域拒绝', '#dc2626');
            },
            ontimeout: () => {
              this.showFeedback('连接超时', '#dc2626');
            },
          });
        } else {
          this.showFeedback('当前环境缺少 GM_xmlhttpRequest', '#dc2626');
        }
      });

      btnClearCache?.addEventListener('click', () => {
        Storage.clearReported();
        const cacheStats = this.shadowRoot?.getElementById('cache-stats');
        if (cacheStats) cacheStats.textContent = '缓存: 0/500';
        this.showFeedback('已清空去重队列', '#059669');
      });
    }

    static toggleModal(open) {
      this.isModalOpen = open;
      const modal = this.shadowRoot?.getElementById('modal');
      const inputUrl = this.shadowRoot?.getElementById('input-backend-url');
      const inputToken = this.shadowRoot?.getElementById('input-user-token');
      const cacheStats = this.shadowRoot?.getElementById('cache-stats');

      if (modal) {
        if (open) {
          modal.classList.add('open');
          if (inputUrl) inputUrl.value = Storage.getBackendUrl();
          if (inputToken) inputToken.value = Storage.getUserToken();
          if (cacheStats) cacheStats.textContent = `缓存: ${Storage.getReportedCount()}/500`;
        } else {
          modal.classList.remove('open');
        }
      }
    }

    static showFeedback(msg, color) {
      const fb = this.shadowRoot?.getElementById('feedback');
      if (fb) {
        fb.style.color = color;
        fb.textContent = msg;
        fb.style.display = 'block';
        setTimeout(() => {
          fb.style.display = 'none';
        }, 3000);
      }
    }

    static updateStatus(status, message) {
      if (!this.shadowRoot) return;

      const dot = this.shadowRoot.getElementById('status-dot');
      const text = this.shadowRoot.getElementById('status-text');
      if (!dot || !text) return;

      dot.className = 'status-dot';

      switch (status) {
        case 'syncing':
          dot.classList.add('pulse');
          text.textContent = message || 'Syncing...';
          break;
        case 'synced':
          dot.classList.add('synced');
          text.textContent = message || 'Synced ✓';
          setTimeout(() => {
            this.updateStatus('idle');
          }, 4000);
          break;
        case 'error':
          dot.classList.add('error');
          text.textContent = message || 'Sync Error';
          break;
        case 'idle':
        default:
          text.textContent = `${this.currentPlatform} Ready`;
          break;
      }
    }
  }

  // ==========================================
  // 8. 入口启动引导 (Bootstrap)
  // ==========================================
  function bootstrap() {
    Logger.info('Starting OJ Submission Tracker bootstrap...');

    // 1. 初始化底层拦截总线
    NetworkHookBus.init(pageWindow);
    RouterHookBus.init(pageWindow);

    // 2. 注册适配器
    const adapters = [
      new LeetCodeAdapter(),
      new LuoguAdapter(),
      new AcWingAdapter(),
      new CodeforcesAdapter(),
      new AtCoderAdapter(),
    ];

    const currentHostname = window.location.hostname;
    let activeAdapter = null;

    for (const adapter of adapters) {
      if (adapter.matchDomain(currentHostname)) {
        activeAdapter = adapter;
        break;
      }
    }

    if (activeAdapter) {
      Logger.info(`Matched platform adapter: [${activeAdapter.platform}] for ${currentHostname}`);
      activeAdapter.init();
      StatusBadge.init(activeAdapter.platform.toUpperCase());
    } else {
      Logger.info(`No specific platform adapter matched for ${currentHostname}. Tracker is in passive mode.`);
    }

    // 3. 页面就绪后补发离线队列
    setTimeout(() => {
      Transport.flushOfflineQueue();
    }, 3000);
  }

  // 立即在 document-start 执行
  bootstrap();
})();
