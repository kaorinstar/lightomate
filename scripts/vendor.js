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

/**
 * ブロックの編集画面（#9）の Blockly です。本体、日本語の文言、画像と音のファイル、ライセンスを同梱します。
 * 基本のブロック（blocks_compressed.js）は使わないため、同梱しません。手順ごとのブロックは
 * extension/shared/blocks.js で定めます。
 */
const BLOCKLY_PACKAGE = 'blockly';

/** Blockly を複写する先のフォルダーです。リポジトリからの相対パスです。 */
export const BLOCKLY_DIR = 'extension/vendor/blockly';

/** 作り直すフォルダーです。版が変わって不要になったファイルが残らないようにします。 */
export const REBUILT_DIRS = [FONT_DIR, BLOCKLY_DIR];

const blocklyMedia = readdirSync(`${root}node_modules/${BLOCKLY_PACKAGE}/media`).sort();

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
  {
    from: `${BLOCKLY_PACKAGE}/blockly_compressed.js`,
    to: `${BLOCKLY_DIR}/blockly_compressed.js`,
  },
  { from: `${BLOCKLY_PACKAGE}/msg/ja.js`, to: `${BLOCKLY_DIR}/msg/ja.js` },
  { from: `${BLOCKLY_PACKAGE}/LICENSE`, to: `${BLOCKLY_DIR}/LICENSE` },
  ...blocklyMedia.map((name) => ({
    from: `${BLOCKLY_PACKAGE}/media/${name}`,
    to: `${BLOCKLY_DIR}/media/${name}`,
  })),
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const dir of REBUILT_DIRS) {
    rmSync(root + dir, { recursive: true, force: true });
  }
  for (const { from, to } of VENDOR_FILES) {
    mkdirSync(dirname(root + to), { recursive: true });
    copyFileSync(`${root}node_modules/${from}`, root + to);
  }
  console.log(`${VENDOR_FILES.length} 件のファイルを extension/vendor/ に複写しました。`);
}
