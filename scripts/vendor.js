// 拡張機能に同梱する外部のファイルを、node_modules から extension/vendor/ に複写します。
// 拡張機能の CSP は外部からの読み込みを禁止しているため、CDN ではなく同梱します。
// 依存パッケージの版を上げたら `npm run vendor` を実行し、複写したファイルをコミットします。
// 複写し忘れは test/vendor.test.js が検出します。

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 複写するファイルです。複写元は node_modules からの、複写先はリポジトリからの相対パスです。 */
export const VENDOR_FILES = [
  {
    from: '@tabler/core/dist/css/tabler.min.css',
    to: 'extension/vendor/tabler/tabler.min.css',
  },
];

const root = fileURLToPath(new URL('../', import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { from, to } of VENDOR_FILES) {
    mkdirSync(dirname(root + to), { recursive: true });
    copyFileSync(`${root}node_modules/${from}`, root + to);
    console.log(`${from} → ${to}`);
  }
}
