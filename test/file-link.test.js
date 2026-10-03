// 記録中に、リンクのクリックでファイルへ移動した場合に、クリックをリンク先のファイルを保存する指定に変える処理
// （extension/shared/file-link.js、#172）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LINK_DOWNLOAD_PATH,
  hrefPatternSelector,
  isFileUrl,
  toLinkDownload,
} from '../extension/shared/file-link.js';
import { SCHEMA_VERSION, validateFlow } from '../extension/shared/flow.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */

/** @type {Step} */
const linkClick = {
  type: 'click',
  target: { selectors: ['a.invoice'], tag: 'a', label: '明細書／適格請求書' },
};
const pdf = 'https://www.example.com/documents/download/0123/invoice.pdf';

test('URL のパスが PDF などのファイルの拡張子で終わる場合だけ、ファイルとみなす', () => {
  assert.equal(isFileUrl(pdf), true);
  assert.equal(isFileUrl('https://www.example.com/a/report.CSV?x=1'), true);
  assert.equal(isFileUrl('https://www.example.com/a/data.xlsx#top'), true);
  assert.equal(isFileUrl('https://www.example.com/orders'), false);
  assert.equal(isFileUrl('https://www.example.com/orders.html'), false);
  assert.equal(isFileUrl('https://www.example.com/view?file=a.pdf'), false);
  assert.equal(isFileUrl('not a url'), false);
});

test('リンクのクリックの直後にファイルへ移動した場合は、クリックをリンク先を保存する指定に変える', () => {
  assert.deepEqual(toLinkDownload(linkClick, pdf, 'page'), {
    ...linkClick,
    target: {
      ...linkClick.target,
      selectors: ['a[href*="/documents/download/"][href*="/invoice.pdf"]', 'a.invoice'],
    },
    download: { path: DEFAULT_LINK_DOWNLOAD_PATH, onConflict: 'rename', from: 'link', all: true },
  });
});

test('押したリンクの href から、注文ごとに変わる部分を除いた、同じ種類のリンクを探す指定を作る（#185）', () => {
  const amazon =
    'https://www.amazon.co.jp/documents/download/59183340-a13f-4750-9b15-b6b280429a13/invoice.pdf';
  assert.equal(
    hrefPatternSelector(amazon),
    'a[href*="/documents/download/"][href*="/invoice.pdf"]',
  );
  // 押したリンクの href を、移動先の URL より優先します（転送で URL が変わる場合に備えます）。
  const converted = toLinkDownload(linkClick, 'https://cdn.example.com/x/1234.pdf', 'page', amazon);
  assert.ok(converted?.type === 'click');
  assert.equal(
    converted.target.selectors[0],
    'a[href*="/documents/download/"][href*="/invoice.pdf"]',
  );
  // 変わる部分がない場合はパス全体、末尾が変わる場合は前の部分だけを使います。クエリは使いません。
  assert.equal(
    hrefPatternSelector('https://www.example.com/auth/invoice.pdf?n=A-001'),
    'a[href*="/auth/invoice.pdf"]',
  );
  assert.equal(
    hrefPatternSelector('https://www.example.com/receipts/20260801-1234.pdf'),
    'a[href*="/receipts/"]',
  );
  // 変わらない部分が短すぎる場合は作りません。リンクを保存する指定にはしますが、すべて保存にはしません。
  assert.equal(hrefPatternSelector('https://www.example.com/12345.pdf'), null);
  assert.deepEqual(toLinkDownload(linkClick, 'https://www.example.com/12345.pdf', 'page'), {
    ...linkClick,
    download: { path: DEFAULT_LINK_DOWNLOAD_PATH, onConflict: 'rename', from: 'link' },
  });
  assert.equal(hrefPatternSelector('not a url'), null);
});

test('変えた手順は、フロー定義の検証を通る', () => {
  const converted = /** @type {Step} */ (toLinkDownload(linkClick, pdf, 'page'));
  assert.deepEqual(
    validateFlow({
      schemaVersion: SCHEMA_VERSION,
      name: '記録',
      origin: 'https://www.example.com',
      steps: [
        { type: 'navigate', url: 'https://www.example.com/orders', cause: 'user' },
        converted,
      ],
    }),
    [],
  );
});

test('利用者の操作による移動、ファイル以外への移動、リンク以外のクリックは変えない', () => {
  assert.equal(toLinkDownload(linkClick, pdf, 'user'), null);
  assert.equal(toLinkDownload(linkClick, 'https://www.example.com/orders', 'page'), null);
  assert.equal(
    toLinkDownload({ ...linkClick, target: { ...linkClick.target, tag: 'button' } }, pdf, 'page'),
    null,
  );
  assert.equal(toLinkDownload({ type: 'pause', note: '確定' }, pdf, 'page'), null);
  assert.equal(toLinkDownload(undefined, pdf, 'page'), null);
});

test('保存先を指定済みのクリックと、新しいタブで開くクリックは変えない', () => {
  assert.equal(toLinkDownload({ ...linkClick, download: { path: 'L/a' } }, pdf, 'page'), null);
  assert.equal(toLinkDownload({ ...linkClick, newTab: true }, pdf, 'page'), null);
});
