import { Storage } from '../core/storage';
import { Transport } from '../core/transport';
import { Logger } from '../core/sandbox';

declare function GM_xmlhttpRequest(details: any): void;

export class StatusBadge {
  private static hostElement: HTMLElement | null = null;
  private static shadowRoot: ShadowRoot | null = null;
  private static isModalOpen = false;
  private static currentPlatform = 'OJ';

  public static init(platformName: string): void {
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

    // 订阅传输状态以实时更新指示灯与文本
    Transport.onStatus((status, message) => {
      this.updateStatus(status, message);
    });

    // 注册全局配置菜单回调
    Storage.init(() => {
      this.toggleModal(true);
    });
  }

  private static createAndMountUI(): void {
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

  private static renderShadowContent(): void {
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

      /* 胶囊状态栏 */
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

      /* 状态圆点 */
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

      /* 配置弹窗 */
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
      
      <!-- 胶囊状态栏 -->
      <div class="badge-capsule" id="capsule">
        <span class="status-dot" id="status-dot"></span>
        <span class="badge-text" id="status-text">${this.currentPlatform} Ready</span>
        <button class="btn-settings" id="btn-open-settings" title="配置 OJ Tracker">⚙️</button>
      </div>

      <!-- 配置弹窗 -->
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

  private static bindEvents(): void {
    if (!this.shadowRoot) return;

    const capsule = this.shadowRoot.getElementById('capsule');
    const modal = this.shadowRoot.getElementById('modal');
    const btnOpenSettings = this.shadowRoot.getElementById('btn-open-settings');
    const btnCloseModal = this.shadowRoot.getElementById('btn-close-modal');
    const btnSave = this.shadowRoot.getElementById('btn-save');
    const btnTest = this.shadowRoot.getElementById('btn-test-conn');
    const btnClearCache = this.shadowRoot.getElementById('btn-clear-cache');
    const inputUrl = this.shadowRoot.getElementById('input-backend-url') as HTMLInputElement;
    const inputToken = this.shadowRoot.getElementById('input-user-token') as HTMLInputElement;

    // 点击胶囊展开/收起配置
    capsule?.addEventListener('click', (e) => {
      // 若点击的是设置小按钮则由其自身处理
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

    // 保存配置
    btnSave?.addEventListener('click', () => {
      const url = inputUrl?.value || '';
      const token = inputToken?.value || '';
      Storage.setBackendUrl(url);
      Storage.setUserToken(token);
      this.showFeedback('配置已保存 ✓', '#059669');
    });

    // 测试连接
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
          onload: (res: any) => {
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

    // 清空缓存
    btnClearCache?.addEventListener('click', () => {
      Storage.clearReported();
      const cacheStats = this.shadowRoot?.getElementById('cache-stats');
      if (cacheStats) cacheStats.textContent = '缓存: 0/500';
      this.showFeedback('已清空去重队列', '#059669');
    });
  }

  public static toggleModal(open: boolean): void {
    this.isModalOpen = open;
    const modal = this.shadowRoot?.getElementById('modal');
    const inputUrl = this.shadowRoot?.getElementById('input-backend-url') as HTMLInputElement;
    const inputToken = this.shadowRoot?.getElementById('input-user-token') as HTMLInputElement;
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

  private static showFeedback(msg: string, color: string): void {
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

  public static updateStatus(status: 'idle' | 'syncing' | 'synced' | 'error', message?: string): void {
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
        // 4秒后自动恢复默认就绪状态
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
