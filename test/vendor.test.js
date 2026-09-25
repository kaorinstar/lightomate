// 同梱したファイル（extension/vendor/）が、package.json で指定した版の node_modules と一致するかを確認します。
// Dependabot が版を上げたときに、`npm run vendor` の実行を忘れると失敗します。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VENDOR_FILES } from '../scripts/vendor.js';

const root = new URL('../', import.meta.url);

for (const { from, to } of VENDOR_FILES) {
  test(`${to} が node_modules/${from} と一致する`, () => {
    const vendored = readFileSync(new URL(to, root));
    const source = readFileSync(new URL(`node_modules/${from}`, root));
    assert.ok(
      vendored.equals(source),
      '`npm run vendor` を実行し、複写したファイルをコミットしてください。',
    );
  });
}
