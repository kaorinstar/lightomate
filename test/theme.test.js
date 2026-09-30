// 両画面に共通の見た目の指定（#137）を確かめます。規則は docs/design-guidelines.md にあります。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** @param {string} path */
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const base = read('extension/shared/base.css');
const fontCss = read('extension/vendor/noto-sans-jp/wght.css');
const pages = ['extension/options/options.html', 'extension/sidepanel/sidepanel.html'];

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
