// 拡張機能に同梱する外部のファイルを、node_modules から extension/vendor/ に複写します。
// 拡張機能の CSP は外部からの読み込みを禁止しているため、CDN ではなく同梱します。
// 依存パッケージの版を上げたら `npm run vendor` を実行し、複写したファイルをコミットします。
// 複写し忘れは test/vendor.test.js が検出します。

import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * 書体 Noto Sans JP（#137）です。太さを 1 つのファイルで変えられる形式（可変フォント）を使い、
 * 文字の範囲ごとに分かれたファイル（unicode-range）をすべて同梱します。画面は、表示する文字を含む
 * ファイルだけを読み込みます。
 */
const FONT_PACKAGE = '@fontsource-variable/noto-sans-jp';

/** 書体を複写する先のフォルダーです。リポジトリからの相対パスです。 */
export const FONT_DIR = 'extension/vendor/noto-sans-jp';

const fontFiles = readdirSync(`${root}node_modules/${FONT_PACKAGE}/files`)
  .filter((name) => name.endsWith('-wght-normal.woff2'))
  .sort();

/** 複写するファイルです。複写元は node_modules からの、複写先はリポジトリからの相対パスです。 */
export const VENDOR_FILES = [
  {
    from: '@tabler/core/dist/css/tabler.min.css',
    to: 'extension/vendor/tabler/tabler.min.css',
  },
  { from: `${FONT_PACKAGE}/wght.css`, to: `${FONT_DIR}/wght.css` },
  { from: `${FONT_PACKAGE}/LICENSE`, to: `${FONT_DIR}/LICENSE` },
  ...fontFiles.map((name) => ({
    from: `${FONT_PACKAGE}/files/${name}`,
    to: `${FONT_DIR}/files/${name}`,
  })),
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // 版が変わって不要になったファイルが残らないよう、書体のフォルダーは作り直します。
  rmSync(root + FONT_DIR, { recursive: true, force: true });
  for (const { from, to } of VENDOR_FILES) {
    mkdirSync(dirname(root + to), { recursive: true });
    copyFileSync(`${root}node_modules/${from}`, root + to);
  }
  console.log(`${VENDOR_FILES.length} 件のファイルを extension/vendor/ に複写しました。`);
}
