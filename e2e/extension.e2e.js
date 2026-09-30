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

test('定期実行：同じサイトの手動の実行が終わるまで待ち、終わった後に背景のタブで実行する（#22）', async () => {
  const { extensionPage } = browser;
  /**
   * @param {string} name
   * @param {Step[]} [extra]
   * @returns {Flow}
   */
  const flow = (name, extra = []) => ({
    schemaVersion: 12,
    name,
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [{ type: 'navigate', cause: 'user', url: `${server.origin}/done.html` }, ...extra],
  });
  const manual = flow('手動', [{ type: 'wait', ms: 5000 }]);
  const scheduled = flow('定期');
  const started = await extensionPage.evaluate(
    async ([manual, scheduled]) => {
      await chrome.storage.local.remove(['history', 'schedules']);
      await chrome.storage.local.set({
        flows: {
          manual: { id: 'manual', createdAt: '', updatedAt: '', flow: manual },
          scheduled: { id: 'scheduled', createdAt: '', updatedAt: '', flow: scheduled },
        },
      });
      return chrome.runtime.sendMessage({
        kind: 'runner/start',
        flowId: 'manual',
        params: {},
        secrets: {},
      });
    },
    [manual, scheduled],
  );
  assert.equal(started.ok, true);

  // 1 分前の時刻を毎日の予約として設定すると、その予約の日時を過ぎているため、すぐに実行の対象になります。
  const previous = new Date(Date.now() - 60_000);
  const time = [previous.getHours(), previous.getMinutes()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  await extensionPage.evaluate(
    (schedule) => chrome.storage.local.set({ schedules: { scheduled: schedule } }),
    {
      frequency: 'daily',
      time,
      catchUp: true,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
  );
  const waiting = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { scheduleWaiting } = await chrome.storage.session.get('scheduleWaiting');
        return /** @type {{ flowId: string }[]} */ (scheduleWaiting ?? []).map(
          (entry) => entry.flowId,
        );
      }),
    (ids) => ids.length > 0,
  );
  assert.deepEqual(waiting, ['scheduled']);

  const history = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { history } = await chrome.storage.local.get('history');
        return /** @type {import('../extension/shared/history.js').HistoryEntry[]} */ (
          history ?? []
        );
      }),
    (entries) => entries.length >= 2,
    60_000,
  );
  // 新しい順です。手動の実行が先に終わり、その後に定期実行が始まります。
  assert.deepEqual(
    history.map((entry) => [entry.flowName, entry.status, entry.trigger]),
    [
      ['定期', 'done', 'schedule'],
      ['手動', 'done', undefined],
    ],
  );
  assert.ok(
    history[0].startedAt >= history[1].endedAt,
    '手動の実行の終了前に定期実行が始まりました。',
  );
  for (const page of pagesAt('/done.html')) {
    await page.close();
  }
});

test('ブロックの編集画面：手順をブロックで表示し、値の変更を保存する。CSP の誤りを出さない（#9）', async () => {
  const { extensionPage: page } = browser;
  /** @type {string[]} */
  const problems = [];
  /** @param {import('playwright').ConsoleMessage} message */
  const onConsole = (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(message.text());
    }
  };
  page.on('console', onConsole);
  page.on('pageerror', (error) => problems.push(error.message));

  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: 'ブロック',
    origin: server.origin,
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/done.html` },
      { type: 'wait', ms: 1000 },
      {
        type: 'if',
        condition: { target: target('#done', 'h1', '完了'), exists: true },
        then: [{ type: 'pause', note: '確認' }],
      },
    ],
  };
  await page.evaluate(
    (flow) =>
      chrome.storage.local.set({
        flows: { blocks: { id: 'blocks', createdAt: '', updatedAt: '', flow } },
      }),
    flow,
  );
  const id = new URL(page.url()).host;
  // 同じ画面の # だけを変えた移動では読み込み直さないため、読み込み直して選んだフローを開きます。
  await page.goto(`chrome-extension://${id}/options/options.html#blocks`);
  await page.reload();
  await page.waitForFunction(
    () =>
      /** @type {any} */ (globalThis).Blockly?.getMainWorkspace()?.getAllBlocks(false).length > 0,
  );

  const count = await page.evaluate(
    () => /** @type {any} */ (globalThis).Blockly.getMainWorkspace().getAllBlocks(false).length,
  );
  assert.equal(count, 4);
  assert.equal(await page.locator('#blocks-save').isDisabled(), true);

  // 待機の秒数を変えて保存します。欄の編集と同じ変更を、Blockly の操作で行います。
  await page.evaluate(() => {
    const workspace = /** @type {any} */ (globalThis).Blockly.getMainWorkspace();
    const wait = workspace
      .getAllBlocks(false)
      .find((/** @type {any} */ block) => block.type === 'lm_wait');
    wait.setFieldValue(2.5, 'SECONDS');
  });
  await page.locator('#blocks-save').click();
  const saved = await waitUntil(
    () =>
      page.evaluate(async () => {
        const { flows } = await chrome.storage.local.get('flows');
        return /** @type {{ blocks: { flow: Flow } }} */ (flows).blocks.flow.steps;
      }),
    (steps) => /** @type {any} */ (steps[1]).ms === 2500,
  );
  assert.deepEqual(saved, [flow.steps[0], { type: 'wait', ms: 2500 }, flow.steps[2]]);
  assert.equal(await page.locator('#blocks-save').isDisabled(), true);

  // つながっていないブロックがある場合は、保存せずに理由を表示します。
  await page.evaluate(() => {
    const workspace = /** @type {any} */ (globalThis).Blockly.getMainWorkspace();
    const wait = workspace
      .getAllBlocks(false)
      .find((/** @type {any} */ block) => block.type === 'lm_wait');
    wait.unplug(true);
  });
  await page.locator('#blocks-save').click();
  await page.locator('#blocks-notice', { hasText: 'つながっていないブロック' }).waitFor();

  // ［変更を取り消す］で、保存済みの手順に戻ります。
  await page.locator('#blocks-revert').click();
  const restored = await page.evaluate(
    () => /** @type {any} */ (globalThis).Blockly.getMainWorkspace().getTopBlocks(false).length,
  );
  assert.equal(restored, 1);
  assert.equal(await page.locator('#blocks-save').isDisabled(), true);

  page.off('console', onConsole);
  assert.deepEqual(problems, []);
});

test('値の定義の編集：名前を変えて保存すると、手順の中の参照も変わる（#9）', async () => {
  const { extensionPage: page } = browser;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: '値の定義',
    origin: server.origin,
    params: [{ name: 'keyword', label: '検索語', type: 'text' }],
    steps: [{ type: 'navigate', cause: 'user', url: `${server.origin}/form.html?q={{keyword}}` }],
  };
  await page.evaluate(
    (flow) =>
      chrome.storage.local.set({
        flows: { params: { id: 'params', createdAt: '', updatedAt: '', flow } },
      }),
    flow,
  );
  const id = new URL(page.url()).host;
  await page.goto(`chrome-extension://${id}/options/options.html#params`);
  await page.reload();
  await page.locator('#params-edit').click();
  await page.locator('#params-rows [data-role="name"]').fill('word');
  await page.locator('#params-add').click();
  const added = page.locator('#params-rows fieldset').nth(1);
  await added.locator('[data-role="name"]').fill('size');
  await added.locator('[data-role="label"]').fill('サイズ');
  await added.locator('[data-role="type"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await added.locator('[data-role="options"]').fill('S、M、L');
  await added.locator('[data-role="default"]').fill('M');
  await page.locator('#params-save').click();

  const saved = await waitUntil(
    () =>
      page.evaluate(async () => {
        const { flows } = await chrome.storage.local.get('flows');
        return /** @type {{ params: { flow: Flow } }} */ (flows).params.flow;
      }),
    (flow) => flow.params?.[0]?.name === 'word',
  );
  assert.deepEqual(saved.params, [
    { name: 'word', label: '検索語', type: 'text' },
    { name: 'size', label: 'サイズ', type: 'select', options: ['S', 'M', 'L'], default: 'M' },
  ]);
  assert.equal(/** @type {any} */ (saved.steps[0]).url, `${server.origin}/form.html?q={{word}}`);
  assert.equal(await page.locator('#params-form').isHidden(), true);
});

test('保存したフロー：一覧で押したフローの画面に切り替わり、ボタンとブラウザーの［戻る］で一覧に戻る（#9）', async () => {
  const { extensionPage: page } = browser;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: '画面の切り替え',
    origin: server.origin,
    steps: [{ type: 'navigate', cause: 'user', url: `${server.origin}/form.html` }],
  };
  await page.evaluate(
    (flow) =>
      chrome.storage.local.set({
        flows: { view: { id: 'view', createdAt: '', updatedAt: '', flow } },
      }),
    flow,
  );
  const id = new URL(page.url()).host;
  await page.goto(`chrome-extension://${id}/options/options.html`);
  await page.reload();
  const list = page.locator('#flow-list');
  const editor = page.locator('#editor');
  await list.getByText('画面の切り替え').click();
  await editor.waitFor({ state: 'visible' });
  assert.equal(await list.isHidden(), true);
  assert.match(page.url(), /#view$/);

  // ［← フローの一覧に戻る］で一覧に戻り、開いていたフローの行にフォーカスが戻ります。
  await page.locator('#back-to-list').click();
  await list.waitFor({ state: 'visible' });
  assert.equal(await editor.isHidden(), true);
  await waitUntil(
    () => page.evaluate(() => globalThis.document.activeElement?.textContent ?? ''),
    (text) => text.includes('画面の切り替え'),
  );

  // ブラウザーの［戻る］でも一覧に戻ります。
  await list.getByText('画面の切り替え').click();
  await editor.waitFor({ state: 'visible' });
  await page.goBack();
  await list.waitFor({ state: 'visible' });
  assert.equal(await editor.isHidden(), true);
});

test('必ず止まる場所：一覧で押したサイトの入力欄に切り替わり、ボタンとブラウザーの［戻る］で一覧に戻る（#9）', async () => {
  const { extensionPage: page } = browser;
  await page.evaluate(() =>
    chrome.storage.local.set({
      stopRules: { 'https://shop.example.com': { selectors: ['#buy'], paths: [] } },
    }),
  );
  const id = new URL(page.url()).host;
  await page.goto(`chrome-extension://${id}/options/options.html?tab=stop-rules`);
  await page.reload();
  const list = page.locator('#stop-list');
  const form = page.locator('#stop-form');
  await list.getByText('https://shop.example.com').click();
  await form.waitFor({ state: 'visible' });
  assert.equal(await list.isHidden(), true);
  assert.equal(await page.locator('#stop-selectors').inputValue(), '#buy');
  assert.equal(
    await page.locator('#stop-form-heading').innerText(),
    'https://shop.example.com の指定',
  );

  await page.locator('#stop-back').click();
  await list.waitFor({ state: 'visible' });
  assert.equal(await form.isHidden(), true);

  await page.locator('#stop-clear').click();
  await form.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#stop-form-heading').innerText(), '新しいサイトの指定');
  await page.goBack();
  await list.waitFor({ state: 'visible' });
  assert.equal(await form.isHidden(), true);
});

test('要素の選択モード：ページで行と行の内側の要素を選ぶとブロックに入り、リンクの移動もページの処理も起きない（#139）', async () => {
  const { extensionPage: page } = browser;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: '要素の選択',
    origin: server.origin,
    steps: [{ type: 'navigate', cause: 'user', url: `${server.origin}/picker.html` }],
  };
  await page.evaluate(
    (flow) =>
      chrome.storage.local.set({
        flows: { picker: { id: 'picker', createdAt: '', updatedAt: '', flow } },
      }),
    flow,
  );
  // 選択モードは、サイトのタブのうち最後に使ったタブで始めます。前のテストのタブが残っていると、そのタブで
  // 始まるため、サイトのタブを閉じてから、テスト用のページを開いておきます。
  for (const other of browser.context.pages()) {
    if (other.url().startsWith(server.origin)) {
      await other.close();
    }
  }
  const site = await browser.context.newPage();
  await site.goto(`${server.origin}/picker.html`);

  const id = new URL(page.url()).host;
  await page.bringToFront();
  await page.goto(`chrome-extension://${id}/options/options.html#picker`);
  await page.reload();
  await page.waitForFunction(
    () =>
      /** @type {any} */ (globalThis).Blockly?.getMainWorkspace()?.getAllBlocks(false).length > 0,
  );

  // ブロックの一覧から置いたのと同じ、要素をまだ選んでいない繰り返しとクリックのブロックをつなぎます。
  const ids = await page.evaluate(() => {
    const Blockly = /** @type {any} */ (globalThis).Blockly;
    const workspace = Blockly.getMainWorkspace();
    const [navigate] = workspace.getTopBlocks(true);
    const loop = Blockly.serialization.blocks.append(
      { type: 'lm_forEach', fields: { TARGET: '（ページで選ぶ）', MAX: 100 } },
      workspace,
    );
    const click = Blockly.serialization.blocks.append(
      { type: 'lm_click', fields: { TARGET: '（ページで選ぶ）' } },
      workspace,
    );
    const extract = Blockly.serialization.blocks.append(
      { type: 'lm_extract', fields: { TARGET: '（ページで選ぶ）', NAME: 'no' } },
      workspace,
    );
    navigate.nextConnection.connect(loop.previousConnection);
    loop.getInput('STEPS').connection.connect(click.previousConnection);
    click.nextConnection.connect(extract.previousConnection);
    return { loop: loop.id, click: click.id, extract: extract.id };
  });

  // 要素を選ぶ前に保存すると、選んでいないブロックがあることを知らせます。
  await page.locator('#blocks-save').click();
  await page.locator('#blocks-notice').getByText('要素をまだ選んでいないブロック').waitFor();

  /**
   * ブロックを選び、［ページで選ぶ］を押して、テスト用のページで選択モードが始まるのを待ちます。
   * @param {string} blockId
   */
  const startPick = async (blockId) => {
    await page.bringToFront();
    // 利用者と同じく、マウスでブロックを押して選びます。
    // ［ページで選ぶ］とブロックの両方が画面に入るよう、ボタンの並びを画面の上端に合わせます。
    await page.locator('#blocks-pick-buttons').evaluate((element) => element.scrollIntoView());
    const point = await page.evaluate((blockId) => {
      const Blockly = /** @type {any} */ (globalThis).Blockly;
      const rect = Blockly.getMainWorkspace()
        .getBlockById(blockId)
        .getSvgRoot()
        .getBoundingClientRect();
      return { x: rect.x + 12, y: rect.y + 10 };
    }, blockId);
    await page.mouse.click(point.x, point.y);
    // ブロックにフォーカスが移ると、ページが動く場合があります。ボタンを画面に戻してから押します。
    await page.locator('#blocks-pick').scrollIntoViewIfNeeded();
    // ［ページで選ぶ］は、押し下げてから離すまで間を置きます。押し下げた時点でブロックの編集画面から
    // フォーカスが外れ、ブロックの選択が外れても、押せるままであることを確かめるためです（#139）。
    const button = await page.locator('#blocks-pick').boundingBox();
    assert.ok(button);
    await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();
    await site.waitForFunction(
      () => globalThis.document.querySelector('lightomate-picker') !== null,
    );
  };

  // 1. 繰り返しの行：2 行目のセルを押し、行の確認で Enter を押して「はい」を選びます。
  await startPick(ids.loop);
  await site.locator('tbody tr:nth-child(2) .no').click();
  await site.keyboard.press('Enter');
  const loopState = await waitUntil(
    () =>
      page.evaluate(
        (blockId) =>
          /** @type {any} */ (globalThis).Blockly.getMainWorkspace().getBlockById(blockId).lmState,
        ids.loop,
      ),
    (state) => state?.step?.items !== undefined,
  );
  assert.deepEqual(loopState.step.items.selectors, [
    'tr.invoice-row',
    '#invoices > tbody > tr.invoice-row',
  ]);

  // 2. 行の内側のリンク：押してもリンクの移動も、ページのスクリプトの処理も起きません。
  await startPick(ids.click);
  await site.locator('tbody tr:nth-child(3) a.receipt').click();
  const clickState = await waitUntil(
    () =>
      page.evaluate(
        (blockId) =>
          /** @type {any} */ (globalThis).Blockly.getMainWorkspace().getBlockById(blockId).lmState,
        ids.click,
      ),
    (state) => state?.step?.target !== undefined,
  );
  assert.equal(clickState.step.target.scope, 'item');
  assert.equal(clickState.step.target.selectors[0], 'a.receipt');
  assert.equal(new URL(site.url()).pathname, '/picker.html');
  assert.equal(await site.locator('#clicked').textContent(), '押されていません');
  assert.equal(
    await site.evaluate(() => globalThis.document.querySelector('lightomate-picker')),
    null,
  );

  // 3. 翻訳が差し込んだ font 要素を押しても、翻訳していないページにもある要素（td.no）を選びます。
  await site.waitForFunction(() => globalThis.document.querySelector('td.no font font') !== null);
  await startPick(ids.extract);
  await site.locator('tbody tr:nth-child(1) td.no font font').click();
  const extractState = await waitUntil(
    () =>
      page.evaluate(
        (blockId) =>
          /** @type {any} */ (globalThis).Blockly.getMainWorkspace().getBlockById(blockId).lmState,
        ids.extract,
      ),
    (state) => state?.step?.target !== undefined,
  );
  assert.equal(extractState.step.target.tag, 'td');
  assert.equal(extractState.step.target.selectors[0], 'td.no');
  assert.ok(
    extractState.step.target.selectors.every(
      (/** @type {string} */ selector) => !selector.includes('font'),
    ),
  );

  // 4. Esc キーでは、何も選ばずに終わります。
  await startPick(ids.click);
  await site.keyboard.press('Escape');
  await page.locator('#blocks-pick-notice').getByText('要素の選択を取り消しました。').waitFor();

  // 5. 保存すると、選んだ要素がフローに入ります。
  await page.bringToFront();
  await page.locator('#blocks-save').click();
  const saved = await waitUntil(
    () =>
      page.evaluate(async () => {
        const { flows } = await chrome.storage.local.get('flows');
        return /** @type {{ picker: { flow: Flow } }} */ (flows).picker.flow;
      }),
    (flow) => flow.steps.length === 2,
  );
  const loop = /** @type {any} */ (saved.steps[1]);
  assert.equal(loop.type, 'forEach');
  assert.equal(loop.items.selectors[0], 'tr.invoice-row');
  assert.equal(loop.steps[0].type, 'click');
  assert.equal(loop.steps[0].target.scope, 'item');
  await site.close();
});
