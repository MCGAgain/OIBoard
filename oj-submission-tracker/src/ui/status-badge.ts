import { Storage, BadgePosition } from '../core/storage';
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

      // 尝试恢复用户自定义拖拽位置，默认停靠在右下角
      const savedPos = Storage.getBadgePosition();
      let initPosCss = 'bottom: 24px; right: 24px;';
      if (savedPos) {
        const clampedLeft = Math.max(10, Math.min(window.innerWidth - 160, savedPos.left));
        const clampedTop = Math.max(10, Math.min(window.innerHeight - 50, savedPos.top));
        initPosCss = `left: ${clampedLeft}px; top: ${clampedTop}px; right: auto; bottom: auto;`;
      }

      this.hostElement.style.cssText = `all: initial; position: fixed; z-index: 2147483647; ${initPosCss}`;

      this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });
      this.renderShadowContent();

      document.body.appendChild(this.hostElement);
      Logger.info('[StatusBadge] Mounted Shadow DOM UI successfully with draggable support.');
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

      .badge-container {
        position: relative;
        display: inline-block;
      }

      /* 可拖拽胶囊状态栏 */
      .badge-capsule {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(226, 232, 240, 0.95);
        box-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.1), 0 2px 6px -1px rgba(0, 0, 0, 0.05);
        border-radius: 9999px;
        padding: 6px 14px;
        cursor: grab;
        user-select: none;
        touch-action: none;
        transition: box-shadow 0.2s ease, border-color 0.2s ease, background-color 0.2s ease;
      }
      .badge-capsule:hover {
        box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.14), 0 4px 10px -2px rgba(0, 0, 0, 0.08);
        border-color: rgba(203, 213, 225, 1);
        background: #ffffff;
      }
      .badge-capsule:active {
        cursor: grabbing;
      }

      /* 状态圆点 */
      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #10b981;
        transition: background-color 0.3s ease;
        position: relative;
        flex-shrink: 0;
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
        color: #334155;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        letter-spacing: -0.01em;
      }

      .btn-settings {
        background: none;
        border: none;
        padding: 3px;
        margin-left: 2px;
        cursor: pointer;
        color: #94a3b8;
        transition: color 0.2s ease, transform 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
      }
      .btn-settings:hover {
        color: #475569;
        transform: rotate(30deg);
      }

      /* 配置弹窗 */
      .modal-overlay {
        position: absolute;
        bottom: calc(100% + 10px);
        right: 0;
        width: 330px;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 16px 36px -4px rgba(0, 0, 0, 0.16), 0 6px 12px -2px rgba(0, 0, 0, 0.08);
        border: 1px solid #e2e8f0;
        padding: 16px;
        display: none;
        z-index: 2147483647;
        animation: modal-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .modal-overlay.open {
        display: block;
      }
      @keyframes modal-fade-in {
        from {
          opacity: 0;
          transform: scale(0.96) translateY(6px);
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
        border-bottom: 1px solid #f1f5f9;
      }
      .modal-title {
        font-size: 14px;
        font-weight: 600;
        color: #0f172a;
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .modal-close {
        background: none;
        border: none;
        cursor: pointer;
        color: #94a3b8;
        padding: 4px;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: background-color 0.15s, color 0.15s;
      }
      .modal-close:hover {
        background-color: #f1f5f9;
        color: #334155;
      }

      .form-group {
        margin-bottom: 10px;
      }
      .form-label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: #475569;
        margin-bottom: 4px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .form-input {
        width: 100%;
        padding: 7px 10px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        font-size: 12px;
        color: #0f172a;
        outline: none;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .form-input:focus {
        border-color: #2563eb;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
      }

      .stats-box {
        background: #f8fafc;
        border: 1px solid #f1f5f9;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 11px;
        color: #64748b;
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
        background: #f1f5f9;
        color: #334155;
      }
      .btn-secondary:hover {
        background: #e2e8f0;
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

    // 使用现代高保真 SVG 取代系统 Emoji
    const gearSvg = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    `;

    const serverSvg = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
      </svg>
    `;

    const closeSvg = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      
      <div class="badge-container" id="container">
        <!-- 可拖拽胶囊状态栏 -->
        <div class="badge-capsule" id="capsule" title="可长按拖拽任意位置">
          <span class="status-dot" id="status-dot"></span>
          <span class="badge-text" id="status-text">${this.currentPlatform} Ready</span>
          <button class="btn-settings" id="btn-open-settings" title="配置 OJ Tracker">${gearSvg}</button>
        </div>

        <!-- 配置弹窗 -->
        <div class="modal-overlay" id="modal">
          <div class="modal-header">
            <div class="modal-title">
              ${serverSvg}
              <span>OJ Tracker 配置</span>
            </div>
            <button class="modal-close" id="btn-close-modal" title="关闭">${closeSvg}</button>
          </div>

          <div class="form-group">
            <label class="form-label">后端接收 API URL</label>
            <input type="text" class="form-input" id="input-backend-url" placeholder="http://localhost:8000/api/v1/submissions/push" />
          </div>

          <div class="form-group">
            <label class="form-label">个人认证 Token / 凭据 (Bearer)</label>
            <input type="password" class="form-input" id="input-user-token" placeholder="留空或输入 OIBoard 同步 Token / 用户名" />
            <div style="font-size: 10px; color: #94a3b8; margin-top: 4px; line-height: 1.4;">
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
      </div>
    `;

    this.bindEvents();
    this.bindDraggable();
  }

  /**
   * 绑定平滑拖拽功能（支持边界吸附与点击/拖拽防误触区分）
   */
  private static bindDraggable(): void {
    if (!this.shadowRoot || !this.hostElement) return;

    const capsule = this.shadowRoot.getElementById('capsule');
    if (!capsule) return;

    let isPointerDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;
    let draggedDistance = 0;

    const onPointerDown = (clientX: number, clientY: number) => {
      isPointerDown = true;
      isDragging = false;
      draggedDistance = 0;
      startX = clientX;
      startY = clientY;

      const rect = this.hostElement!.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
    };

    const onPointerMove = (clientX: number, clientY: number) => {
      if (!isPointerDown) return;

      const dx = clientX - startX;
      const dy = clientY - startY;
      draggedDistance = Math.hypot(dx, dy);

      if (draggedDistance > 5) {
        if (!isDragging) {
          isDragging = true;
          capsule.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
        }

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // 限制在视口边界内（保持至少 10px 边距）
        const rect = this.hostElement!.getBoundingClientRect();
        const badgeWidth = rect.width || 150;
        const badgeHeight = rect.height || 36;
        const minLeft = 10;
        const maxLeft = Math.max(minLeft, window.innerWidth - badgeWidth - 10);
        const minTop = 10;
        const maxTop = Math.max(minTop, window.innerHeight - badgeHeight - 10);

        newLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));
        newTop = Math.max(minTop, Math.min(newTop, maxTop));

        this.hostElement!.style.left = `${newLeft}px`;
        this.hostElement!.style.top = `${newTop}px`;
        this.hostElement!.style.right = 'auto';
        this.hostElement!.style.bottom = 'auto';
      }
    };

    const onPointerUp = () => {
      if (!isPointerDown) return;
      isPointerDown = false;
      document.body.style.userSelect = '';
      capsule.style.cursor = 'grab';

      if (isDragging) {
        const finalRect = this.hostElement!.getBoundingClientRect();
        Storage.setBadgePosition({
          left: Math.round(finalRect.left),
          top: Math.round(finalRect.top),
        });
        this.repositionModal();
      }
    };

    // 鼠标事件绑定
    capsule.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return; // 仅响应鼠标左键
      onPointerDown(e.clientX, e.clientY);

      const moveHandler = (moveEvent: MouseEvent) => {
        onPointerMove(moveEvent.clientX, moveEvent.clientY);
      };

      const upHandler = () => {
        document.removeEventListener('mousemove', moveHandler, true);
        document.removeEventListener('mouseup', upHandler, true);
        onPointerUp();
      };

      document.addEventListener('mousemove', moveHandler, true);
      document.addEventListener('mouseup', upHandler, true);
    });

    // 触屏手势支持
    capsule.addEventListener('touchstart', (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      onPointerDown(touch.clientX, touch.clientY);
    }, { passive: true });

    capsule.addEventListener('touchmove', (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      onPointerMove(touch.clientX, touch.clientY);
    }, { passive: true });

    capsule.addEventListener('touchend', () => {
      onPointerUp();
    });

    // 点击事件过滤：如果是拖拽结束产生的 click 则忽略，防止误开弹窗
    capsule.addEventListener('click', (e) => {
      if (draggedDistance > 5) {
        e.stopPropagation();
        e.preventDefault();
        draggedDistance = 0;
      }
    }, true);
  }

  /**
   * 根据当前胶囊位置智能调整配置弹窗的展开朝向（防止溢出视口）
   */
  private static repositionModal(): void {
    if (!this.shadowRoot || !this.hostElement) return;
    const modal = this.shadowRoot.getElementById('modal');
    if (!modal) return;

    const rect = this.hostElement.getBoundingClientRect();
    const modalHeight = 350;
    const modalWidth = 330;

    // 垂直方向判断：视口下半部分向上展开，上半部分向下展开
    if (rect.top > window.innerHeight / 2 && rect.top > modalHeight + 20) {
      modal.style.top = 'auto';
      modal.style.bottom = 'calc(100% + 10px)';
    } else {
      modal.style.top = 'calc(100% + 10px)';
      modal.style.bottom = 'auto';
    }

    // 水平方向判断：靠右时向左对齐，靠左时向右对齐
    if (rect.left + modalWidth > window.innerWidth - 20) {
      modal.style.left = 'auto';
      modal.style.right = '0px';
    } else {
      modal.style.left = '0px';
      modal.style.right = 'auto';
    }
  }

  private static bindEvents(): void {
    if (!this.shadowRoot) return;

    const capsule = this.shadowRoot.getElementById('capsule');
    const btnOpenSettings = this.shadowRoot.getElementById('btn-open-settings');
    const btnCloseModal = this.shadowRoot.getElementById('btn-close-modal');
    const btnSave = this.shadowRoot.getElementById('btn-save');
    const btnTest = this.shadowRoot.getElementById('btn-test-conn');
    const btnClearCache = this.shadowRoot.getElementById('btn-clear-cache');
    const inputUrl = this.shadowRoot.getElementById('input-backend-url') as HTMLInputElement;
    const inputToken = this.shadowRoot.getElementById('input-user-token') as HTMLInputElement;

    // 点击胶囊展开/收起配置
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

    // 保存配置
    btnSave?.addEventListener('click', () => {
      const url = inputUrl?.value || '';
      const token = inputToken?.value || '';
      Storage.setBackendUrl(url);
      Storage.setUserToken(token);
      this.showFeedback('配置已保存', '#059669');
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
              this.showFeedback(`连接成功 (HTTP ${res.status})`, '#059669');
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
        this.repositionModal();
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
        text.textContent = message || 'Synced';
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
