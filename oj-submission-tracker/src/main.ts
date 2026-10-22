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

  // 1. 在 document-start 阶段初始化网络与路由拦截总线
  NetworkHookBus.init(pageWindow);
  RouterHookBus.init(pageWindow);

  // 2. 注册各平台适配器
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
    Logger.info(`Matched platform adapter: [${activeAdapter.platform}] for ${currentHostname}`);
    activeAdapter.init();
    StatusBadge.init(activeAdapter.platform.toUpperCase());
  } else {
    Logger.info(`No specific platform adapter matched for ${currentHostname}. Tracker is in passive mode.`);
  }

  // 3. 页面就绪后尝试补发之前可能离线暂存的提交
  setTimeout(() => {
    Transport.flushOfflineQueue();
  }, 3000);
}

// 立即在 document-start 执行
bootstrap();
