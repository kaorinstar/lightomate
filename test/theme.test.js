// 両画面に共通の見た目の指定（#137）を確かめます。規則は docs/design-guidelines.md にあります。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** @param {string} path */
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const base = read('extension/shared/base.css');
const fontCss = read('extension/vendor/noto-sans-jp/wght.css');
const pages = [
  'extension/options/options.html',
  'extension/sidepanel/sidepanel.html',
  // 記録中に許可がないサイトへ移動したときに開く窓です（#209）。
  'extension/sidepanel/allow-site.html',
];

test('OS で動きを減らす設定を選んだときは、すべての要素の動きを止める', () => {
  const media = base.slice(base.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(media.length < base.length, 'prefers-reduced-motion の指定がありません。');
  const block = media.slice(0, media.indexOf('\n}\n'));
  assert.match(block, /\*,\s*\*::before,\s*\*::after/);
  assert.match(block, /transition: none !important/);
  assert.match(block, /animation: none !important/);
});

test('両画面は、同梱した書体の CSS を読み込む', () => {
  for (const page of pages) {
    assert.match(
      read(page),
      /<link rel="stylesheet" href="\.\.\/vendor\/noto-sans-jp\/wght\.css" \/>/,
      page,
    );
  }
});

test('書体は、拡張機能の中のファイルだけから読み込む（CSP の範囲）', () => {
  const urls = [...fontCss.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.match(url, /^\.\/files\/[\w-]+\.woff2$/, url);
  }
});

test('本文の書体の先頭は、同梱した書体の名前である', () => {
  const family = fontCss.match(/font-family: '([^']+)'/)?.[1];
  assert.equal(family, 'Noto Sans JP Variable');
  assert.match(base, new RegExp(`--tblr-font-sans-serif:\\s*'${family}',`));
});

/**
 * 表示の色を決めるスクリプト（#148）を、OS の設定を指定して実行し、付けた属性の値を返します。
 * @param {boolean} dark 暗い表示の OS か
 */
function runColorScheme(dark) {
  /** @type {Map<string, string>} */
  const attributes = new Map();
  const context = {
    document: {
      documentElement: {
        /** @param {string} name @param {string} value */
        setAttribute: (name, value) => attributes.set(name, value),
      },
    },
    /** @param {string} query */
    matchMedia: (query) => ({ matches: query === '(prefers-color-scheme: dark)' && dark }),
  };
  runInNewContext(read('extension/shared/color-scheme.js'), context);
  return attributes.get('data-bs-theme');
}

test('表示の色を決めるスクリプトは、OS の設定に合わせて data-bs-theme を設定する', () => {
  assert.equal(runColorScheme(true), 'dark');
  assert.equal(runColorScheme(false), 'light');
});

test('両画面は、最初の描画より前に表示の色を決める', () => {
  for (const page of pages) {
    const html = read(page);
    const script = html.indexOf('<script src="../shared/color-scheme.js"></script>');
    assert.ok(script >= 0, `${page} が color-scheme.js を読み込んでいません。`);
    // スタイルシートより前に読み込みます。
    assert.ok(script < html.indexOf('<link rel="stylesheet"'), page);
    assert.ok(script < html.indexOf('</head>'), page);
    assert.match(html, /<meta name="color-scheme" content="light dark" \/>/, page);
  }
});
