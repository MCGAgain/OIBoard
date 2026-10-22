/**
 * 沙箱穿透与全局上下文封装
 */

declare const unsafeWindow: Window & typeof globalThis;

export const pageWindow: Window & typeof globalThis =
  typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

export class Logger {
  private static prefix = '[OJ-Tracker]';

  public static info(...args: any[]): void {
    console.info(this.prefix, ...args);
  }

  public static warn(...args: any[]): void {
    console.warn(this.prefix, ...args);
  }

  public static error(...args: any[]): void {
    console.error(this.prefix, ...args);
  }

  public static debug(...args: any[]): void {
    console.debug(this.prefix, ...args);
  }
}
