import { Logger } from './sandbox';

export type RouteChangeListener = (newUrl: string, oldUrl: string) => void;

export class RouterHookBus {
  private static listeners: RouteChangeListener[] = [];
  private static initialized = false;
  private static currentUrl = '';

  public static init(targetWindow: Window & typeof globalThis): void {
    if (this.initialized) return;
    this.initialized = true;
    this.currentUrl = targetWindow.location.href;

    const history = targetWindow.history;
    if (history) {
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function (...args: Parameters<typeof history.pushState>): void {
        const oldUrl = RouterHookBus.currentUrl;
        originalPushState.apply(this, args);
        const newUrl = targetWindow.location.href;
        if (newUrl !== oldUrl) {
          RouterHookBus.currentUrl = newUrl;
          RouterHookBus.emitRouteChange(newUrl, oldUrl);
        }
      };

      history.replaceState = function (...args: Parameters<typeof history.replaceState>): void {
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

  public static onRouteChange(listener: RouteChangeListener): void {
    this.listeners.push(listener);
  }

  private static emitRouteChange(newUrl: string, oldUrl: string): void {
    for (const listener of this.listeners) {
      try {
        listener(newUrl, oldUrl);
      } catch (e) {
        Logger.error('Route change listener error:', e);
      }
    }
  }
}
