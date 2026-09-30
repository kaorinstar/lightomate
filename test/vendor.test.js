// 同梱したファイル（extension/vendor/）が、package.json で指定した版の node_modules と一致するかを確認します。
// Dependabot が版を上げたときに、`npm run vendor` の実行を忘れると失敗します。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_DIR, VENDOR_FILES } from '../scripts/vendor.js';

const root = new URL('../', import.meta.url);

test('同梱したファイルが、node_modules の同じ版のファイルと一致する', () => {
  const differences = VENDOR_FILES.filter(({ from, to }) => {
    const vendored = readFileSync(new URL(to, root));
    const source = readFileSync(new URL(`node_modules/${from}`, root));
    return !vendored.equals(source);
  }).map(({ to }) => to);
  assert.deepEqual(
    differences,
    [],
    '`npm run vendor` を実行し、複写したファイルをコミットしてください。',
  );
});

test('書体のフォルダーに、複写する一覧にないファイルが残っていない', () => {
  const expected = VENDOR_FILES.filter(({ to }) => to.startsWith(`${FONT_DIR}/`))
    .map(({ to }) => to.slice(FONT_DIR.length + 1))
    .sort();
  const actual = readdirSync(new URL(`${FONT_DIR}/`, root), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(fileURLToPath(new URL(FONT_DIR, root)), join(entry.parentPath, entry.name)),
    )
    .sort();
  assert.deepEqual(
    actual,
    expected,
    '`npm run vendor` を実行し、複写したファイルをコミットしてください。',
  );
});

test('書体の CSS が参照するファイルは、すべて同梱している', () => {
  const css = readFileSync(new URL(`${FONT_DIR}/wght.css`, root), 'utf8');
  const urls = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(urls.length > 0);
  const bundled = new Set(VENDOR_FILES.map(({ to }) => to));
  for (const url of urls) {
    assert.ok(bundled.has(`${FONT_DIR}/${url}`), `${url} を同梱していません。`);
  }
});
