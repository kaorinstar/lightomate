// 拡張機能の記録と実行を、Chromium に読み込んで確かめる自動テストです（#21）。
// npm run test:e2e で実行します。ブラウザを起動するため、npm test（単体テスト）には含めません。

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launchBrowser, listFiles, runFlow, startServer, waitUntil } from './harness.js';

/** @typedef {import('../extension/shared/flow.js').Flow} Flow */
/** @typedef {import('../extension/shared/flow.js').Step} Step */
/** @typedef {import('../extension/shared/flow.js').Target} Target */

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {Awaited<ReturnType<typeof launchBrowser>>} */
let browser;

before(async () => {
  server = await startServer();
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * 手順の対象の要素の指定を作ります。
 * @param {string} selector
 * @param {string} tag
 * @param {string} label
 * @param {boolean} [inItem] 繰り返しの行の中で探すか
 * @returns {Target}
 */
function target(selector, tag, label, inItem = false) {
  return {
    selectors: [selector],
    tag,
    label,
    ...(inItem ? { scope: /** @type {const} */ ('item') } : {}),
  };
}

/**
 * 実行で開いたタブのうち、URL が指定したパスのものを返します。
 * @param {string} pathname
 */
function pagesAt(pathname) {
  return browser.context
    .pages()
    .filter((page) => page.url().startsWith(`${server.origin}${pathname}`));
}

test('クリック・入力・選択・ページの移動を記録し、実行で再現する', async () => {
  const { extensionPage } = browser;
  const page = await browser.context.newPage();
  await page.goto(`${server.origin}/form.html`);
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, `${server.origin}/form.html`);

  const started = await extensionPage.evaluate(
    (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
    tabId,
  );
  assert.deepEqual(started, { ok: true });

  await page.fill('#name', '山田 太郎');
  await page.press('#name', 'Tab');
  // selectOption が起こす変化は、利用者の操作（isTrusted）として扱われず、記録されません。
  // 記録は利用者の操作だけを対象とするため、キーボードで選びます。
  await page.focus('#plan');
  await page.keyboard.press('ArrowDown');
  await Promise.all([page.waitForURL(/\/done\.html/), page.click('#submit')]);

  // ページの移動は、移動が確定した時点で記録されます。
  await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[] }} */ (recording).steps;
      }),
    (steps) => steps.length >= 5,
  );
  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.equal(stopped.ok, true);
  assert.deepEqual(stopped.errors, []);
  /** @type {Flow} */
  const flow = stopped.flow;
  const steps = /** @type {Step[]} */ (flow.steps);
  assert.deepEqual(
    steps.map((step) => step.type),
    ['navigate', 'input', 'select', 'click', 'navigate'],
  );
  assert.equal(steps[1].type === 'input' && steps[1].value, '山田 太郎');
  assert.deepEqual(steps[2].type === 'select' && steps[2].values, ['b']);
  await page.close();

  const entry = await runFlow(extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  const [done] = pagesAt('/done.html');
  assert.ok(done, '送信後のページが開いていません。');
  const query = new URL(done.url()).searchParams;
  assert.equal(query.get('name'), '山田 太郎');
  assert.equal(query.get('plan'), 'b');
  await done.close();
});

test('新しいタブで開いた先で PDF を保存し、closeTab で元のタブに戻る', async () => {
  /** @type {Flow} */
  const flow = {
    schemaVersion: 11,
    name: '新しいタブ',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/orders.html` },
      {
        type: 'forEach',
        items: target('tr.order-row', 'tr', '注文の行'),
        steps: [
          {
            type: 'extract',
            target: target('.order-number', 'span', '注文番号', true),
            name: 'number',
          },
          { type: 'click', target: target('a.receipt', 'a', '領収書', true), newTab: true },
          { type: 'savePdf', path: 'Lightomate/領収書/{{number}}.pdf', onConflict: 'overwrite' },
          { type: 'closeTab' },
        ],
      },
    ],
  };

  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  assert.deepEqual(
    await waitUntil(
      async () => listFiles(browser.downloadDir).filter((file) => file.endsWith('.pdf')),
      (files) => files.length >= 2,
    ),
    ['Lightomate/領収書/A-001.pdf', 'Lightomate/領収書/A-002.pdf'],
  );
  assert.deepEqual(pagesAt('/receipt.html'), [], '領収書のタブが閉じられていません。');
  for (const page of pagesAt('/orders.html')) {
    await page.close();
  }
});

test('download を付けたクリックで、ファイルが指定した名前で保存される', async () => {
  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: 'ダウンロード',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/invoices.html` },
      {
        type: 'forEach',
        items: target('tr.row', 'tr', '明細の行'),
        steps: [
          { type: 'extract', target: target('.no', 'span', '明細番号', true), name: 'no' },
          {
            type: 'click',
            target: target('a.csv', 'a', 'CSV', true),
            download: { path: 'Lightomate/明細/{{no}}', onConflict: 'overwrite' },
          },
        ],
      },
    ],
  };

  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  assert.deepEqual(
    await waitUntil(
      async () => listFiles(browser.downloadDir).filter((file) => file.endsWith('.csv')),
      (files) => files.length >= 2,
    ),
    ['Lightomate/明細/B-001.csv', 'Lightomate/明細/B-002.csv'],
  );
  for (const page of pagesAt('/invoices.html')) {
    await page.close();
  }
});
