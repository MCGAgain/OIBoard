import { pageWindow, Logger } from './core/sandbox';
import { NetworkHookBus } from './core/network-hook';
import { RouterHookBus } from './core/router-hook';
import { Transport } from './core/transport';
import { StatusBadge } from './ui/status-badge';

import { BaseAdapter } from './adapters/base-adapter';
import { LeetCodeAdapter } from './adapters/leetcode-adapter';
import { LuoguAdapter } from './adapters/luogu-adapter';
import { AcWingAdapter } from './adapters/acwing-adapter';
import { CodeforcesAdapter } from './adapters/codeforces-adapter';
import { AtCoderAdapter } from './adapters/atcoder-adapter';

function bootstrap(): void {
  Logger.info('Starting OJ Submission Tracker bootstrap...');

  // 1. 先匹配当前站点对应的平台适配器，按需启用 Hook（避免对 AtCoder/CF 等站点注入不必要的全局劫持）
  const adapters: BaseAdapter[] = [
    new LeetCodeAdapter(),
    new LuoguAdapter(),
    new AcWingAdapter(),
    new CodeforcesAdapter(),
    new AtCoderAdapter(),
  ];

  const currentHostname = window.location.hostname;
  let activeAdapter: BaseAdapter | null = null;

  for (const adapter of adapters) {
    if (adapter.matchDomain(currentHostname)) {
      activeAdapter = adapter;
      break;
    }
  }

  if (activeAdapter) {
    const hooks = activeAdapter.requiredHooks || {};
    if (hooks.fetch || hooks.xhr || hooks.ws) {
      NetworkHookBus.init(pageWindow, {
        fetch: !!hooks.fetch,
        xhr: !!hooks.xhr,
        ws: !!hooks.ws,
      });
    }
    if (hooks.router) {
      RouterHookBus.init(pageWindow);
    }

    Logger.info(`Matched platform adapter: [${activeAdapter.platform}] for ${currentHostname}`);
    activeAdapter.init();
    StatusBadge.init(activeAdapter.platform.toUpperCase());
  } else {
    Logger.info(`No specific platform adapter matched for ${currentHostname}. Tracker is in passive mode.`);
  }

  // 2. 页面就绪后尝试补发之前可能离线暂存的提交
  setTimeout(() => {
    Transport.flushOfflineQueue();
  }, 3000);
}

// 立即在 document-start 执行
bootstrap();
