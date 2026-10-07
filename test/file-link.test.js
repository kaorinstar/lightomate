// 記録中に、リンクのクリックでファイルへ移動した場合に、クリックをリンク先のファイルを保存する指定に変える処理
// （extension/shared/file-link.js、#172）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLICK_DOWNLOAD_WINDOW_MS,
  DEFAULT_LINK_DOWNLOAD_PATH,
  hrefPatternSelector,
  isFileUrl,
  toClickDownload,
  toLinkDownload,
} from '../extension/shared/file-link.js';
import { SCHEMA_VERSION, validateFlow } from '../extension/shared/flow.js';
import { makeLoop, nameableSteps } from '../extension/shared/record-loop.js';

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

// 楽天市場の［発行する］のように、ボタンのクリックでサイトがファイルのダウンロードを始める場合です（#223）。
/** @type {Step} */
const issueClick = {
  type: 'click',
  origin: 'https://order.my.rakuten.co.jp',
  target: { selectors: ['div.issue'], tag: 'div', label: '発行する', text: '発行する' },
};
const site = 'https://order.my.rakuten.co.jp';
const receipt = {
  url: 'https://order.my.rakuten.co.jp/receipt/download?id=1',
  referrer: 'https://order.my.rakuten.co.jp/purchase-history/?order_number=1',
};

test('クリックの直後に、そのサイトのダウンロードが始まった場合は、クリックをダウンロードを保存する指定に変える', () => {
  const converted = toClickDownload(issueClick, receipt, site, 1500);
  assert.deepEqual(converted, {
    ...issueClick,
    download: { path: DEFAULT_LINK_DOWNLOAD_PATH, onConflict: 'rename' },
  });
  const flow = {
    schemaVersion: SCHEMA_VERSION,
    name: '領収書',
    origin: 'https://www.rakuten.co.jp',
    extraOrigins: [site],
    steps: [/** @type {Step} */ (converted)],
  };
  assert.deepEqual(validateFlow(flow), []);
});

test('ページが作った blob: のファイルと、参照元だけがそのサイトのファイルも、クリックに結び付ける', () => {
  const blob = { url: `blob:${site}/0f1e2d3c` };
  assert.notEqual(toClickDownload(issueClick, blob, site, 0), null);
  const cdn = { url: 'https://cdn.example.net/r.pdf', referrer: `${site}/purchase-history/` };
  assert.notEqual(toClickDownload(issueClick, cdn, site, CLICK_DOWNLOAD_WINDOW_MS), null);
});

test('時間が離れたダウンロード、ほかのサイトのダウンロード、拡張機能が始めたダウンロードは結び付けない', () => {
  assert.equal(toClickDownload(issueClick, receipt, site, CLICK_DOWNLOAD_WINDOW_MS + 1), null);
  assert.equal(toClickDownload(issueClick, receipt, site, -1), null);
  assert.equal(
    toClickDownload(issueClick, { url: 'https://other.example.com/a.pdf' }, site, 10),
    null,
  );
  assert.equal(
    toClickDownload(issueClick, { url: 'data:application/pdf;base64,AA==' }, site, 10),
    null,
  );
  assert.equal(toClickDownload(issueClick, { ...receipt, byExtensionId: 'abc' }, site, 10), null);
});

test('クリック以外の手順、保存先を指定済みのクリック、新しいタブで開くクリックは変えない', () => {
  assert.equal(toClickDownload({ type: 'pause', note: '確定' }, receipt, site, 10), null);
  assert.equal(toClickDownload(undefined, receipt, site, 10), null);
  assert.equal(
    toClickDownload({ ...issueClick, download: { path: 'L/a' } }, receipt, site, 10),
    null,
  );
  assert.equal(toClickDownload({ ...issueClick, newTab: true }, receipt, site, 10), null);
});

test('ダウンロードに変えたクリックがあると、一覧の注文日と注文番号をファイル名に使え、その名前で保存する', () => {
  const rows = { selectors: ['div.order'], tag: 'div', label: '一覧の行（div.order）' };
  /** @param {string} selector @param {string} tag @param {string} text */
  const inRow = (selector, tag, text) => ({
    type: /** @type {const} */ ('click'),
    target: { selectors: [selector], tag, label: text, text },
  });
  /** @type {Step[]} */
  const steps = [
    { type: 'navigate', cause: 'user', url: `${site}/purchase-history/order-list` },
    inRow('span.date', 'span', '2026/09/25(金)'),
    inRow('span.number', 'span', '203694-20260925-0203206625'),
    inRow('a.detail', 'a', '注文詳細'),
    { type: 'navigate', cause: 'page', url: `${site}/purchase-history/?order_number=1` },
    { type: 'click', target: { selectors: ['button.issue'], tag: 'button', label: '発行する' } },
    /** @type {Step} */ (toClickDownload(issueClick, receipt, site, 800)),
  ];
  const hint = (/** @type {string} */ selector, /** @type {string} */ tag) => [
    {
      items: rows,
      count: 25,
      inner: { selectors: [selector], tag, label: selector, scope: /** @type {const} */ ('item') },
    },
  ];
  const hints = [
    null,
    hint('span.date', 'span'),
    hint('span.number', 'span'),
    hint('a.detail', 'a'),
    null,
    null,
    null,
  ];
  assert.deepEqual(nameableSteps(steps, 1, 6), [1, 2]);

  const result = makeLoop(steps, hints, 1, 6, JSON.stringify(rows.selectors), [1, 2]);
  assert.equal(result.ok, true);
  const loop = /** @type {any} */ (result.ok && result.steps[1]);
  assert.equal(loop.type, 'forEach');
  assert.deepEqual(loop.steps.at(-1).download, {
    path: 'Lightomate/{{flow.name}}/{{fileName1}}_{{fileName2}}',
    onConflict: 'overwrite',
  });
});
