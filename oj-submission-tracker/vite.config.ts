import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'OJ Submission Tracker (多平台 OJ 提交采集与端云核实)',
        namespace: 'https://github.com/OIBoard/oj-tracker',
        version: '1.0.0',
        description: '实时截获力扣、洛谷、AcWing、Codeforces、AtCoder 的判题与提交记录，并秒级同步至后端对账核实',
        author: 'OIBoard',
        match: [
          'https://leetcode.cn/*',
          'https://www.luogu.com.cn/*',
          'https://www.acwing.com/*',
          'https://codeforces.com/*',
          'https://mirror.codeforces.com/*',
          'https://atcoder.jp/*',
        ],
        'run-at': 'document-start',
        grant: [
          'unsafeWindow',
          'GM_xmlhttpRequest',
          'GM_getValue',
          'GM_setValue',
          'GM_registerMenuCommand',
        ],
        connect: ['*'],
      },
      build: {
        fileName: 'oj-tracker.user.js',
      },
    }),
  ],
});
