import { PlatformType, UnifiedSubmissionPayload } from '../types/payload';
import { Transport } from '../core/transport';
import { Logger } from '../core/sandbox';

export abstract class BaseAdapter {
  public abstract readonly platform: PlatformType;

  /**
   * 判断当前页面 Hostname 是否匹配该适配器
   */
  public abstract matchDomain(hostname: string): boolean;

  /**
   * 初始化适配器：注册网络钩子、路由监听与 DOM 观察者
   */
  public abstract init(): void;

  /**
   * 提交标准化数据
   */
  protected async submitPayload(payload: UnifiedSubmissionPayload): Promise<boolean> {
    Logger.info(`[${this.platform}] Submitting payload for problem: ${payload.problemId}, verdict: ${payload.verdict}`);
    return Transport.send(payload);
  }
}
