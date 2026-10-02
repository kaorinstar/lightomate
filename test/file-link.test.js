// 記録中に、リンクのクリックでファイルへ移動した場合に、クリックをリンク先のファイルを保存する指定に変える処理
// （extension/shared/file-link.js、#172）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LINK_DOWNLOAD_PATH,
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
    download: { path: DEFAULT_LINK_DOWNLOAD_PATH, onConflict: 'rename', from: 'link' },
  });
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
