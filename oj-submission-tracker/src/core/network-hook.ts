import { Logger } from './sandbox';

export interface InterceptedHttpEvent {
  type: 'fetch' | 'xhr';
  method: string;
  url: string;
  requestBody: string | null;
  status: number;
  responseText: string;
}

export type HttpListener = (event: InterceptedHttpEvent) => void;
export type WsMessageListener = (url: string, data: string) => void;

export class NetworkHookBus {
  private static httpListeners: HttpListener[] = [];
  private static wsListeners: WsMessageListener[] = [];
  private static wsSendListeners: WsMessageListener[] = [];
  private static initialized = false;
  public static rawFetch: typeof fetch;

  public static init(targetWindow: Window & typeof globalThis): void {
    if (this.initialized) return;
    this.initialized = true;

    // 1. 保存原生 fetch 供内部主动轮询使用，避免死循环拦截
    const originalFetch = targetWindow.fetch ? targetWindow.fetch.bind(targetWindow) : fetch.bind(window);
    this.rawFetch = originalFetch;

    // 2. 劫持 Fetch
    if (targetWindow.fetch) {
      targetWindow.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
        let url = '';
        let method = 'GET';
        let requestBody: string | null = null;

        const input = args[0];
        const init = args[1];

        if (typeof input === 'string') {
          url = input;
        } else if (input instanceof URL) {
          url = input.toString();
        } else if (input && typeof (input as Request).url === 'string') {
          url = (input as Request).url;
          method = (input as Request).method || 'GET';
        }

        if (init) {
          method = (init.method || method).toUpperCase();
          if (typeof init.body === 'string') {
            requestBody = init.body;
          } else if (init.body instanceof URLSearchParams) {
            requestBody = init.body.toString();
          } else if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
            try {
              const pairs: string[] = [];
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

      OriginalXHR.prototype.open = function (
        method: string,
        url: string | URL,
        ...rest: any[]
      ): void {
        (this as any)._tmMethod = (method || 'GET').toUpperCase();
        (this as any)._tmUrl = String(url);
        return originalOpen.apply(this, [method, url, ...rest] as any);
      };

      OriginalXHR.prototype.send = function (
        body?: Document | XMLHttpRequestBodyInit | null
      ): void {
        let reqBody: string | null = null;
        if (typeof body === 'string') {
          reqBody = body;
        } else if (body instanceof URLSearchParams) {
          reqBody = body.toString();
        } else if (typeof FormData !== 'undefined' && body instanceof FormData) {
          try {
            const pairs: string[] = [];
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
                method: (this as any)._tmMethod || 'GET',
                url: (this as any)._tmUrl || '',
                requestBody: reqBody,
                status: this.status,
                responseText: this.responseText || '',
              });
            } else if (this.responseType === 'json' && this.response) {
              NetworkHookBus.emitHttp({
                type: 'xhr',
                method: (this as any)._tmMethod || 'GET',
                url: (this as any)._tmUrl || '',
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

    // 4. 劫持 WebSocket（针对 AcWing 和洛谷实时推送）
    const OriginalWS = targetWindow.WebSocket;
    if (OriginalWS) {
      const PatchedWS = function (this: any, url: string | URL, protocols?: string | string[]) {
        const wsInstance = protocols
          ? new OriginalWS(url, protocols)
          : new OriginalWS(url);

        try {
          wsInstance.addEventListener('message', (event: MessageEvent) => {
            if (typeof event.data === 'string') {
              NetworkHookBus.emitWs(String(url), event.data);
            } else if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
              event.data.text().then((txt) => {
                NetworkHookBus.emitWs(String(url), txt);
              }).catch(() => {});
            }
          });

          const origWsSend = wsInstance.send;
          wsInstance.send = function (data: any) {
            try {
              if (typeof data === 'string') {
                NetworkHookBus.emitWsSend(String(url), data);
              }
            } catch (_) {}
            return origWsSend.apply(this, arguments as any);
          };
        } catch (_) {}

        return wsInstance;
      } as any;

      PatchedWS.prototype = OriginalWS.prototype;
      Object.assign(PatchedWS, OriginalWS);
      targetWindow.WebSocket = PatchedWS;
    }

    Logger.info('NetworkHookBus initialized on target window.');
  }

  public static onHttp(listener: HttpListener): void {
    this.httpListeners.push(listener);
  }

  public static onWs(listener: WsMessageListener): void {
    this.wsListeners.push(listener);
  }

  public static onWsSend(listener: WsMessageListener): void {
    this.wsSendListeners.push(listener);
  }

  private static emitHttp(event: InterceptedHttpEvent): void {
    for (const fn of this.httpListeners) {
      try {
        fn(event);
      } catch (e) {
        Logger.error('HTTP listener error:', e);
      }
    }
  }

  private static emitWs(url: string, data: string): void {
    for (const fn of this.wsListeners) {
      try {
        fn(url, data);
      } catch (e) {
        Logger.error('WS listener error:', e);
      }
    }
  }

  private static emitWsSend(url: string, data: string): void {
    for (const fn of this.wsSendListeners) {
      try {
        fn(url, data);
      } catch (e) {
        Logger.error('WS Send listener error:', e);
      }
    }
  }
}
