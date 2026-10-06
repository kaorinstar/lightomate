// 拡張機能の記録と実行を、Chromium に読み込んで確かめる自動テストです（#21）。
// npm run test:e2e で実行します。ブラウザを起動するため、npm test（単体テスト）には含めません。

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

test('Shadow DOM：開いた部品と閉じた部品の中の入力とクリックを記録し、実行で再現する（#20）', async () => {
  const { extensionPage } = browser;
  const page = await browser.context.newPage();
  await page.goto(`${server.origin}/shadow-form.html`);
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, `${server.origin}/shadow-form.html`);

  const started = await extensionPage.evaluate(
    (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
    tabId,
  );
  assert.deepEqual(started, { ok: true });

  // 開いた部品の中の入力欄です。Playwright のセレクターは、開いた Shadow DOM の中を探せます。
  await page.click('input[name="name"]');
  await page.keyboard.type('山田 太郎');
  // 閉じた部品の中は、ページのスクリプトからも探せないため、位置を押します。
  /** @param {'note' | 'button'} which */
  const point = async (which) => {
    const found = await page.evaluate(
      (which) => /** @type {any} */ (globalThis).lmRect(which),
      which,
    );
    assert.ok(found, which);
    return /** @type {{ x: number, y: number }} */ (found);
  };
  const note = await point('note');
  await page.mouse.click(note.x, note.y);
  await page.keyboard.type('午前中');
  await page.keyboard.press('Tab');
  const button = await point('button');
  await Promise.all([page.waitForURL(/\/done\.html/), page.mouse.click(button.x, button.y)]);

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
    ['navigate', 'input', 'input', 'click', 'navigate'],
  );
  const [, name, memo, submit] = steps;
  assert.ok(name.type === 'input' && memo.type === 'input' && submit.type === 'click');
  assert.equal(name.value, '山田 太郎');
  assert.deepEqual(name.target.shadow, ['lm-card']);
  assert.equal(memo.value, '午前中');
  assert.deepEqual(memo.target.shadow, ['lm-card', 'lm-pay']);
  assert.deepEqual(submit.target.shadow, ['lm-card', 'lm-pay']);
  assert.equal(submit.target.tag, 'button');
  await page.close();

  const entry = await runFlow(extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  const [done] = pagesAt('/done.html');
  assert.ok(done, '送信後のページが開いていません。');
  const query = new URL(done.url()).searchParams;
  assert.equal(query.get('name'), '山田 太郎');
  assert.equal(query.get('note'), '午前中');
  await done.close();

  // 部品の中の文字が翻訳で置き換わっても、同じ要素を見つけて実行できます。
  const [opening, ...rest] = steps;
  assert.ok(opening.type === 'navigate');
  const translated = await runFlow(extensionPage, {
    ...flow,
    steps: [{ ...opening, url: `${opening.url}?translate=1` }, ...rest],
  });
  assert.equal(translated.status, 'done', translated.reason ?? '');
  const [again] = pagesAt('/done.html');
  assert.ok(again, '翻訳したページで、送信後のページが開いていません。');
  assert.equal(new URL(again.url()).searchParams.get('note'), '午前中');
  await again.close();
});

test('Shadow DOM：部品が見つからない場合は、見つからない部品を示して停止し、翻訳をやめる案内は付けない（#20）', async () => {
  const { extensionPage } = browser;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 17,
    name: '部品が見つからない',
    origin: server.origin,
    steps: [
      // 翻訳したページで実行します。部品の指定は翻訳で変わらないため、翻訳をやめる案内は誤りです。
      { type: 'navigate', url: `${server.origin}/shadow-form.html?translate=1`, cause: 'user' },
      {
        type: 'click',
        target: { ...target('button', 'button', '送信'), shadow: ['lm-card', 'lm-missing'] },
      },
    ],
  };
  const entry = await runFlow(extensionPage, flow);
  assert.equal(entry.status, 'failed');
  assert.match(entry.reason ?? '', /部品（lm-missing）が見つかりません/);
  assert.doesNotMatch(entry.reason ?? '', /翻訳/);
  for (const opened of pagesAt('/shadow-form.html')) {
    await opened.close();
  }
});

test('履歴のコピー：止まった時点の変数とフロー定義を含め、入力欄に入れた値は伏せる（#198）', async () => {
  const { extensionPage } = browser;
  const user = 'tanaka@example.com';
  /** @type {Flow} */
  const flow = {
    schemaVersion: 18,
    name: '履歴のコピー',
    origin: server.origin,
    params: [
      { name: 'user', label: 'ログイン ID', type: 'text' },
      { name: 'plan', label: 'プラン', type: 'select', options: ['a', 'b'] },
    ],
    steps: [
      { type: 'navigate', url: `${server.origin}/form.html?plan={{plan}}`, cause: 'user' },
      { type: 'input', target: target('#name', 'input', '名前'), value: '{{user}}' },
      { type: 'click', target: target('#missing', 'button', 'ない') },
    ],
  };
  const entry = await runFlow(extensionPage, flow, { user, plan: 'b' });
  assert.equal(entry.status, 'failed');
  assert.deepEqual(entry.variables, [
    { name: 'user', length: user.length },
    { name: 'plan', value: 'b' },
  ]);
  assert.match(entry.flowHash ?? '', /^[0-9a-f]{16}$/);
  for (const opened of pagesAt('/form.html')) {
    await opened.close();
  }

  // 管理画面の［実行履歴］の［コピー］で、クリップボードに書き込む内容を受け取ります。
  await extensionPage.reload();
  await extensionPage.evaluate(() => {
    const page = /** @type {any} */ (globalThis);
    page.navigator.clipboard.writeText = async (/** @type {string} */ text) => {
      page.copiedText = text;
    };
  });
  await extensionPage.locator('#tab-history').click();
  await extensionPage.getByRole('button', { name: /「履歴のコピー」の履歴をコピー/ }).click();
  const copied = await waitUntil(
    () => extensionPage.evaluate(() => /** @type {any} */ (globalThis).copiedText ?? ''),
    (text) => text !== '',
  );
  assert.match(copied, /結果：失敗/);
  assert.match(copied, /\n {2}user：＊＊＊（18 文字）\n {2}plan：b\n/);
  assert.doesNotMatch(copied, /実行の後に変更されています/);
  const json = JSON.parse(copied.slice(copied.indexOf('\n{\n') + 1));
  assert.equal(json.steps[1].value, '＊＊＊');
  assert.equal(json.steps[0].url, `${server.origin}/form.html?＊＊＊`);
  assert.equal(copied.includes(user), false);
  await extensionPage.reload();
});

test('翻訳の案内：翻訳で変わらない指定（id）の要素が見つからない場合は、翻訳をやめる案内を付けない（#206）', async () => {
  const { extensionPage } = browser;
  /**
   * @param {import('../extension/shared/flow.js').Target} missing
   * @returns {Flow}
   */
  const flow = (missing) => ({
    schemaVersion: 18,
    name: '翻訳の案内',
    origin: server.origin,
    steps: [
      { type: 'navigate', url: `${server.origin}/shadow-form.html?translate=1`, cause: 'user' },
      { type: 'click', target: missing },
    ],
  });
  const byId = await runFlow(
    extensionPage,
    flow(target('#lightomate-missing', 'button', '存在しないボタン')),
  );
  assert.equal(byId.status, 'failed');
  assert.match(byId.reason ?? '', /要素が見つかりません/);
  assert.doesNotMatch(byId.reason ?? '', /翻訳/);

  // 表示の文字を手がかりに持つ指定では、従来どおり案内を付けます。
  const byText = await runFlow(
    extensionPage,
    flow({ ...target('#lightomate-missing', 'button', '送信'), text: '送信' }),
  );
  assert.equal(byText.status, 'failed');
  assert.match(byText.reason ?? '', /翻訳をやめて原文の表示に戻して/);
  for (const opened of pagesAt('/shadow-form.html')) {
    await opened.close();
  }
});

test('ページの構造：要素が見つからずに止まった場合は、要素の数と骨組みを履歴に残し、表示の文字は残さない（#203）', async () => {
  const { extensionPage } = browser;
  const user = 'tanaka@example.com';
  /** @type {Flow} */
  const flow = {
    schemaVersion: 18,
    name: 'ページの構造',
    origin: server.origin,
    steps: [
      { type: 'navigate', url: `${server.origin}/form.html`, cause: 'user' },
      { type: 'input', target: target('#name', 'input', '名前'), value: user },
      // 記録した後にサイトの変更で id が変わった場面です。ページのボタンの id は submit です。
      { type: 'click', target: target('#submit-old', 'button', '送信') },
    ],
  };
  const entry = await runFlow(extensionPage, flow);
  assert.equal(entry.status, 'failed');
  assert.deepEqual(entry.structure, {
    counts: [{ selector: '#submit-old', count: 0 }],
    tag: 'button',
    total: 1,
    elements: [{ tag: 'button', id: 'submit', type: 'submit' }],
  });
  const stored = JSON.stringify(entry.structure);
  assert.equal(stored.includes('送信'), false);
  assert.equal(stored.includes(user), false);
  for (const opened of pagesAt('/form.html')) {
    await opened.close();
  }
});

/**
 * iframe の中の入力欄とボタンを持つお支払いの画面（#20）で、名義の入力と［確認へ］のクリックを記録し、記録した
 * フローを返します。
 * @param {string} frameUrl 埋め込む iframe のページの URL
 * @returns {Promise<Flow>}
 */
async function recordFramePayment(frameUrl) {
  const { extensionPage } = browser;
  const hostUrl = `${server.origin}/frame-host.html?frame=${encodeURIComponent(frameUrl)}`;
  const page = await browser.context.newPage();
  await page.goto(hostUrl);
  const card = page.frameLocator('iframe');
  await card.locator('input[name="holder"]').waitFor();
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, hostUrl);
  const started = await extensionPage.evaluate(
    (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
    tabId,
  );
  assert.deepEqual(started, { ok: true });

  await card.locator('input[name="holder"]').click();
  await page.keyboard.type('YAMADA TARO');
  await page.keyboard.press('Tab');
  await Promise.all([page.waitForURL(/\/done\.html/), card.locator('#confirm').click()]);

  await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[] }} */ (recording).steps;
      }),
    (steps) => steps.length >= 4,
  );
  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.equal(stopped.ok, true);
  assert.deepEqual(stopped.errors, []);
  await page.close();
  return stopped.flow;
}

/**
 * 記録したお支払いのフローの手順を確かめ、実行して、iframe に入力した名義が完了のページに届くことを確かめます。
 * @param {Flow} flow
 * @param {string} frameOrigin iframe のサイト
 */
async function assertFramePaymentRuns(flow, frameOrigin) {
  const steps = /** @type {Step[]} */ (flow.steps);
  assert.deepEqual(
    steps.map((step) => step.type),
    ['navigate', 'input', 'click', 'navigate'],
  );
  const [, holder, confirm] = steps;
  assert.ok(holder.type === 'input' && confirm.type === 'click');
  assert.equal(holder.value, 'YAMADA TARO');
  // iframe の指定には、読み込むたびに変わる ? 以降を含めません。
  assert.deepEqual(holder.target.frame, { url: `${frameOrigin}/frame-card.html` });
  assert.deepEqual(confirm.target.frame, { url: `${frameOrigin}/frame-card.html` });
  // 手順の origin は、最上位のページのサイトです。
  assert.equal('origin' in holder ? holder.origin : undefined, undefined);

  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  const [done] = pagesAt('/done.html');
  assert.ok(done, '完了のページが開いていません。');
  assert.equal(new URL(done.url()).searchParams.get('holder'), 'YAMADA TARO');
  await done.close();
}

test('iframe：同じサイトの iframe の中の入力とクリックを記録し、実行で再現する（#20）', async () => {
  const flow = await recordFramePayment(`${server.origin}/frame-card.html`);
  assert.equal(flow.extraOrigins, undefined);
  await assertFramePaymentRuns(flow, server.origin);
});

test('iframe：別のサイトの iframe の中の入力とクリックを記録し、iframe のサイトをフローのサイトに加える（#20）', async () => {
  const other = await startServer();
  try {
    const flow = await recordFramePayment(`${other.origin}/frame-card.html`);
    assert.deepEqual(flow.extraOrigins, [other.origin]);
    await assertFramePaymentRuns(flow, other.origin);
  } finally {
    await other.close();
  }
});

test('iframe：許可のないサイトの iframe は記録せず、そのサイトをサイドパネルに知らせる（#20）', async () => {
  const { extensionPage } = browser;
  // テスト用の拡張機能は 127.0.0.1 だけを許可しているため、localhost は許可のないサイトです。
  const port = new URL(server.origin).port;
  const blocked = `http://localhost:${port}`;
  const hostUrl = `${server.origin}/frame-host.html?frame=${encodeURIComponent(`${blocked}/frame-card.html`)}`;
  const page = await browser.context.newPage();
  await page.goto(hostUrl);
  await page.frameLocator('iframe').locator('input[name="holder"]').waitFor();
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, hostUrl);
  const started = await extensionPage.evaluate(
    (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
    tabId,
  );
  assert.deepEqual(started, { ok: true });
  const recordingPage = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const stored = await chrome.storage.session.get('recordingPage');
        return /** @type {{ blockedFrames?: string[] } | undefined} */ (stored.recordingPage);
      }),
    (value) => Array.isArray(value?.blockedFrames),
  );
  assert.deepEqual(recordingPage, {
    origin: server.origin,
    allowed: true,
    blockedFrames: [blocked],
  });

  // 許可のない iframe の中の操作は、記録しません。［確認へ］で起きた最上位のページの移動だけを記録します。
  await Promise.all([
    page.waitForURL(/\/done\.html/),
    page.frameLocator('iframe').locator('#confirm').click(),
  ]);
  await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[] }} */ (recording).steps;
      }),
    (steps) => steps.length >= 2,
  );
  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.deepEqual(
    /** @type {Step[]} */ (stopped.flow.steps).map((step) => step.type),
    ['navigate', 'navigate'],
  );
  await page.close();
});

test('iframe：一致する iframe が 2 つある場合は、どちらにも入力せずに停止する（#20）', async () => {
  /** @type {Flow} */
  const flow = {
    schemaVersion: 18,
    name: '一致する iframe が 2 つ',
    origin: server.origin,
    steps: [
      {
        type: 'navigate',
        url: `${server.origin}/frame-host.html?count=2`,
        cause: 'user',
      },
      {
        type: 'input',
        target: {
          ...target('input[name="holder"]', 'input', '名義'),
          frame: { url: `${server.origin}/frame-card.html` },
        },
        value: 'YAMADA TARO',
      },
    ],
  };
  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'failed');
  assert.match(entry.reason ?? '', /一致する iframe が 2 個あり/);
  // 原因を調べるため、ページの iframe の一覧を残します。URL の ? 以降は除きます（#203）。
  assert.deepEqual(entry.structure, {
    frameTotal: 2,
    frames: [
      { src: `${server.origin}/frame-card.html`, title: 'カード情報' },
      { src: `${server.origin}/frame-card.html`, title: 'カード情報' },
    ],
  });
  const [opened] = pagesAt('/frame-host.html');
  assert.ok(opened);
  const values = await Promise.all(
    opened
      .frames()
      .slice(1)
      .map((frame) => frame.locator('input[name="holder"]').inputValue()),
  );
  assert.deepEqual(values, ['', '']);
  await opened.close();
});

test('iframe：枠のページの名前のハッシュが記録時と異なっても、その枠の中で入力し、実行履歴に補足を残す（#191）', async () => {
  const recorded = `${server.origin}/frame-card-0123456789abcdef.html`;
  const current = `${server.origin}/frame-card-fedcba9876543210.html`;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 18,
    name: '名前の変わった枠',
    origin: server.origin,
    steps: [
      {
        type: 'navigate',
        url: `${server.origin}/frame-host.html?frame=${encodeURIComponent(current)}`,
        cause: 'user',
      },
      {
        type: 'input',
        target: { ...target('input[name="holder"]', 'input', '名義'), frame: { url: recorded } },
        value: 'YAMADA TARO',
      },
      {
        type: 'click',
        target: { ...target('#confirm', 'button', '確認へ'), frame: { url: recorded } },
      },
      {
        type: 'navigate',
        url: `${server.origin}/done.html?holder=YAMADA+TARO`,
        cause: 'page',
      },
    ],
  };
  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  // 同じ枠を 2 つの手順で探しますが、補足は 1 件だけ残します。
  assert.deepEqual(entry.notes, [
    `枠のページの名前が記録時と異なるため、名前のうち更新で変わる部分を除いて見つけました（記録時：${recorded}、実行時：${current}）。`,
  ]);
  const [done] = pagesAt('/done.html');
  assert.ok(done, '完了のページが開いていません。');
  assert.equal(new URL(done.url()).searchParams.get('holder'), 'YAMADA TARO');
  await done.close();
});

/**
 * 確定ボタンの自動検出（#47）の設定を変えます。無効にした記録は chrome.storage.local の confirmDetection と、
 * 定期実行の confirmDetectionSchedule です。有効に戻す場合は、両方を消します。
 * @param {boolean} enabled
 * @param {boolean} [schedule] 定期実行でも検出するか。enabled が false の場合だけ使います
 */
async function setConfirmDetection(enabled, schedule = true) {
  await browser.extensionPage.evaluate(
    ({ enabled, schedule }) =>
      enabled
        ? chrome.storage.local.remove(['confirmDetection', 'confirmDetectionSchedule'])
        : chrome.storage.local.set({
            confirmDetection: false,
            ...(schedule ? {} : { confirmDetectionSchedule: false }),
          }),
    { enabled, schedule },
  );
}

/** 確定ボタンのページで、［注文を確定する］を押すフローです（#47）。 */
function confirmOrderFlow() {
  return /** @type {Flow} */ ({
    schemaVersion: 18,
    name: '注文を確定する',
    origin: server.origin,
    steps: [
      { type: 'navigate', url: `${server.origin}/confirm-order.html`, cause: 'user' },
      {
        type: 'click',
        target: { ...target('#place-order', 'button', '注文を確定する'), text: '注文を確定する' },
      },
      { type: 'navigate', url: `${server.origin}/done.html?ordered=1`, cause: 'page' },
    ],
  });
}

test('確定ボタンの自動検出：無効の間は、確定ボタンのクリックを記録し、実行でも押して、補足を残す（#47）', async () => {
  const { extensionPage } = browser;
  await setConfirmDetection(false);
  try {
    const page = await browser.context.newPage();
    await page.goto(`${server.origin}/confirm-order.html`);
    const tabId = await extensionPage.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      return tab.id;
    }, `${server.origin}/confirm-order.html`);
    const started = await extensionPage.evaluate(
      (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
      tabId,
    );
    assert.deepEqual(started, { ok: true });
    await Promise.all([page.waitForURL(/\/done\.html/), page.click('#place-order')]);
    await waitUntil(
      () =>
        extensionPage.evaluate(async () => {
          const { recording } = await chrome.storage.session.get('recording');
          return /** @type {{ steps: Step[] }} */ (recording).steps;
        }),
      (steps) => steps.length >= 3,
    );
    const stopped = await extensionPage.evaluate(() =>
      chrome.runtime.sendMessage({ kind: 'recording/stop' }),
    );
    await page.close();
    // 一時停止に置き換えず、クリックのまま記録します。
    assert.deepEqual(
      /** @type {Step[]} */ (stopped.flow.steps).map((step) => step.type),
      ['navigate', 'click', 'navigate'],
    );

    const entry = await runFlow(extensionPage, stopped.flow);
    assert.equal(entry.status, 'done', entry.reason ?? '');
    assert.deepEqual(entry.notes, ['確定ボタンの自動検出を無効にして実行しました。']);
    const [done] = pagesAt('/done.html');
    assert.ok(done, '確定ボタンを押した後のページが開いていません。');
    await done.close();
  } finally {
    await setConfirmDetection(true);
  }

  // 有効に戻すと、同じフローでも確定ボタンの手前で止まります。
  const entry = await runFlow(extensionPage, confirmOrderFlow());
  assert.equal(entry.status, 'halted', entry.reason ?? '');
  assert.match(entry.reason ?? '', /確定ボタン「注文を確定する」の手前/);
  assert.equal(entry.notes, undefined);
  for (const opened of pagesAt('/confirm-order.html')) {
    await opened.close();
  }
});

/**
 * 確定ボタンのフローを、定期実行で 1 回実行し、実行履歴の項目を返します（#47）。
 * @returns {Promise<import('../extension/shared/history.js').HistoryEntry>}
 */
async function runConfirmOrderScheduled() {
  const { extensionPage } = browser;
  try {
    await extensionPage.evaluate(async (flow) => {
      await chrome.storage.local.remove(['history', 'schedules']);
      await chrome.storage.local.set({
        flows: { confirm: { id: 'confirm', createdAt: '', updatedAt: '', flow } },
      });
    }, confirmOrderFlow());
    // 1 分前の時刻を毎日の予約として設定すると、すぐに実行の対象になります。
    const previous = new Date(Date.now() - 60_000);
    const time = [previous.getHours(), previous.getMinutes()]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
    await extensionPage.evaluate(
      (schedule) => chrome.storage.local.set({ schedules: { confirm: schedule } }),
      {
        frequency: 'daily',
        time,
        catchUp: true,
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    );
    const [entry] = await waitUntil(
      () =>
        extensionPage.evaluate(async () => {
          const { history } = await chrome.storage.local.get('history');
          return /** @type {import('../extension/shared/history.js').HistoryEntry[]} */ (
            history ?? []
          );
        }),
      (entries) => entries.length >= 1,
      30_000,
    );
    assert.equal(entry.trigger, 'schedule');
    return entry;
  } finally {
    await extensionPage.evaluate(() => chrome.storage.local.remove('schedules'));
    for (const opened of [...pagesAt('/confirm-order.html'), ...pagesAt('/done.html')]) {
      await opened.close();
    }
  }
}

test('確定ボタンの自動検出：1 段目だけ無効の間は、定期実行では確定ボタンの手前で止まる（#47）', async () => {
  await setConfirmDetection(false);
  try {
    const entry = await runConfirmOrderScheduled();
    assert.equal(entry.status, 'halted', entry.reason ?? '');
    assert.match(entry.reason ?? '', /確定ボタン「注文を確定する」の手前/);
    assert.equal(entry.notes, undefined);
  } finally {
    await setConfirmDetection(true);
  }
});

test('確定ボタンの自動検出：［定期実行でも止めない］の間は、定期実行でも確定ボタンを押して補足を残す（#47）', async () => {
  await setConfirmDetection(false, false);
  try {
    const entry = await runConfirmOrderScheduled();
    assert.equal(entry.status, 'done', entry.reason ?? '');
    assert.deepEqual(entry.notes, ['確定ボタンの自動検出を無効にして実行しました。']);
  } finally {
    await setConfirmDetection(true);
  }
});

test('確定ボタンの自動検出：設定画面で［確定ボタンの手前で止めない］を選ぶとリスクを含む確認が出て、その間はサイドパネルに表示する（#47）', async () => {
  const { extensionPage: page } = browser;
  await page.reload();
  await page.click('#tab-settings');
  // 2 つの欄は、どちらも「止めない」の向きです。初期値はどちらもチェックなしです。
  const toggle = page.locator('#confirm-detection');
  assert.equal(await toggle.isChecked(), false);
  await page.getByText('止めない場合のリスク').waitFor();
  // 1 段目がチェックなしの間は、［定期実行でも止めない］を選べません。
  assert.equal(await page.locator('#confirm-detection-schedule').isDisabled(), true);

  // ［キャンセル］ではチェックなしのままです。
  await toggle.click();
  const confirm = page.locator('#confirm-detection-confirm');
  await confirm.getByText('誤って確定した場合の損害は、利用者の責任になります。').waitFor();
  assert.equal(await toggle.isChecked(), false);
  await confirm.getByRole('button', { name: 'キャンセル' }).click();
  assert.equal(await toggle.isChecked(), false);
  assert.equal(
    await page.evaluate(
      async () => (await chrome.storage.local.get('confirmDetection')).confirmDetection,
    ),
    undefined,
  );

  // ［リスクを理解して設定する］でチェックが入り、止めない設定になります。
  await toggle.click();
  await confirm.getByRole('button', { name: 'リスクを理解して設定する' }).click();
  await waitUntil(
    () => toggle.isChecked(),
    (checked) => checked,
  );
  assert.equal(
    await page.evaluate(
      async () => (await chrome.storage.local.get('confirmDetection')).confirmDetection,
    ),
    false,
  );

  const panel = await browser.context.newPage();
  await panel.goto(page.url().replace('options/options.html', 'sidepanel/sidepanel.html'));
  const banner = panel.locator('#confirm-detection-off');
  await banner.getByText('確定ボタンの手前で止めない設定です').waitFor();
  const scheduleBanner = panel.locator('#confirm-detection-schedule-off');
  assert.equal(await scheduleBanner.isHidden(), true);

  // 1 段目にチェックを入れると、［定期実行でも止めない］を選べます。選ぶ前にも、別の確認を出します。
  const schedule = page.locator('#confirm-detection-schedule');
  await waitUntil(
    () => schedule.isEnabled(),
    (enabled) => enabled,
  );
  assert.equal(await schedule.isChecked(), false);
  await schedule.click();
  await confirm.getByText('気付くのは実行の後になります').waitFor();
  await confirm.getByRole('button', { name: 'キャンセル' }).click();
  assert.equal(await schedule.isChecked(), false);
  await schedule.click();
  await confirm.getByRole('button', { name: 'リスクを理解して設定する' }).click();
  await waitUntil(
    () => schedule.isChecked(),
    (checked) => checked,
  );
  assert.equal(
    await page.evaluate(
      async () =>
        (await chrome.storage.local.get('confirmDetectionSchedule')).confirmDetectionSchedule,
    ),
    false,
  );
  await scheduleBanner.getByText('定期実行でも、確定ボタンの手前で止まりません。').waitFor();

  // 1 段目のチェックを外す操作では確認を出さず、［定期実行でも止めない］も外れ、サイドパネルの表示も消えます。
  await toggle.click();
  assert.equal(await toggle.isChecked(), false);
  assert.equal(await confirm.isHidden(), true);
  await waitUntil(
    () => schedule.isChecked(),
    (checked) => !checked,
  );
  assert.equal(await schedule.isDisabled(), true);
  assert.deepEqual(
    await page.evaluate(() =>
      chrome.storage.local.get(['confirmDetection', 'confirmDetectionSchedule']),
    ),
    {},
  );
  await waitUntil(
    () => banner.isHidden(),
    (hidden) => hidden,
  );
  await panel.close();
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

test('繰り返しを終える：対象月より前の行で繰り返しを終え、次のページを開かずに次の手順へ進む（#162）', async () => {
  const date = target('.order-date', 'span', '注文日', true);
  /** @type {Flow} */
  const flow = {
    schemaVersion: 13,
    name: '繰り返しを終える',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/dated-orders.html` },
      {
        type: 'forEach',
        items: target('tr.order-row', 'tr', '注文の行'),
        nextPage: target('a.next', 'a', '次へ'),
        // 2 ページ目を開こうとすると、ページ送りの上限で停止します。
        maxPages: 1,
        steps: [
          { type: 'if', condition: { target: date, before: '2026-09' }, then: [{ type: 'break' }] },
          {
            type: 'if',
            condition: { target: date, month: '2026-09' },
            then: [
              {
                type: 'extract',
                target: target('.order-number', 'span', '注文番号', true),
                name: 'number',
              },
              {
                type: 'savePdf',
                path: 'Lightomate/前の月で終える/{{number}}.pdf',
                onConflict: 'overwrite',
              },
            ],
          },
        ],
      },
      { type: 'savePdf', path: 'Lightomate/前の月で終える/後.pdf', onConflict: 'overwrite' },
    ],
  };

  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  assert.deepEqual(
    await waitUntil(
      async () =>
        listFiles(browser.downloadDir).filter((file) =>
          file.startsWith('Lightomate/前の月で終える/'),
        ),
      (files) => files.length >= 3,
    ),
    [
      'Lightomate/前の月で終える/C-002.pdf',
      'Lightomate/前の月で終える/C-003.pdf',
      'Lightomate/前の月で終える/後.pdf',
    ],
  );
  assert.deepEqual(pagesAt('/dated-orders-2.html'), [], '次のページが開かれています。');
  for (const page of pagesAt('/dated-orders.html')) {
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
    // 手動の実行（約 7 秒）と定期実行（約 2 秒）が終わるまでの時間です。待っている定期実行は、手動の実行の
    // 終了の知らせで始めます。1 分ごとの alarm に頼ると、この時間を超えます（#146）。
    30_000,
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
  // 手動の実行の終了から、数秒以内に定期実行が始まります（#146）。
  const gap = Date.parse(history[0].startedAt) - Date.parse(String(history[1].endedAt));
  assert.ok(gap < 10_000, `手動の実行の終了から定期実行の開始まで ${gap} ミリ秒かかりました。`);
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
   * ブロックを右クリックし、メニューの［ページで選ぶ］を押して、テスト用のページで選択モードが始まるのを待ちます。
   * keyboard を指定した場合は、利用者がキーボードで操作する場合と同じく、ブロックを押して選んだ後、
   * Ctrl + Enter キーでメニューを開き、Enter キーで先頭の［ページで選ぶ］を押します。
   * @param {string} blockId
   * @param {{ keyboard?: boolean }} [options]
   */
  const startPick = async (blockId, { keyboard = false } = {}) => {
    await page.bringToFront();
    await page.locator('#blocks').scrollIntoViewIfNeeded();
    const point = await page.evaluate((blockId) => {
      const Blockly = /** @type {any} */ (globalThis).Blockly;
      const rect = Blockly.getMainWorkspace()
        .getBlockById(blockId)
        .getSvgRoot()
        .getBoundingClientRect();
      return { x: rect.x + 12, y: rect.y + 10 };
    }, blockId);
    if (keyboard) {
      await page.mouse.click(point.x, point.y);
      await page.keyboard.press('Control+Enter');
      await page.getByRole('menuitem', { name: /^ページで選ぶ/ }).waitFor();
      await page.keyboard.press('Enter');
    } else {
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.getByRole('menuitem', { name: /^ページで選ぶ/ }).click();
    }
    await site.waitForFunction(
      () => globalThis.document.querySelector('lightomate-picker') !== null,
    );
  };

  // 要素をまだ選んでいないブロックの説明（マウスを重ねると出る文）は、選ぶ方法を示します。右クリックのメニューには
  // ［複製］があり、1 行にまとめる切り替え（インライン入力）はありません。メニューの項目の名前は、後ろにキーの組み合わせ（例：「複製 D」）が
  // 付くため、先頭の一致で探します。
  const tooltip = await page.evaluate((blockId) => {
    const block = /** @type {any} */ (globalThis).Blockly.getMainWorkspace().getBlockById(blockId);
    return typeof block.tooltip === 'function' ? block.tooltip() : block.tooltip;
  }, ids.loop);
  assert.match(tooltip, /右クリックして［ページで選ぶ］を押し/);
  await page.locator('#blocks').scrollIntoViewIfNeeded();
  const loopBox = await page.evaluate((blockId) => {
    const rect = /** @type {any} */ (globalThis).Blockly.getMainWorkspace()
      .getBlockById(blockId)
      .getSvgRoot()
      .getBoundingClientRect();
    return { x: rect.x + 12, y: rect.y + 10 };
  }, ids.loop);
  await page.mouse.click(loopBox.x, loopBox.y, { button: 'right' });
  await page.getByRole('menuitem', { name: /^複製/ }).waitFor();
  assert.equal(
    await page.evaluate(() =>
      Boolean(
        /** @type {any} */ (globalThis).Blockly.ContextMenuRegistry.registry.getItem('blockInline'),
      ),
    ),
    false,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: /^複製/ }).waitFor({ state: 'hidden' });

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

  // 4. Esc キーでは、何も選ばずに終わります。キーボードでメニューを開いて始めます。
  await startPick(ids.click, { keyboard: true });
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

test('値を入れる：右クリックのメニューから、キーボードだけで保存先に読み取りの名前を入れて保存する（#147）', async () => {
  const { extensionPage: page } = browser;
  const target = { selectors: ['#order-id'], tag: 'span', label: '注文番号' };
  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: '値を入れる',
    origin: server.origin,
    params: [{ name: 'month', label: '対象月', type: 'month' }],
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/picker.html` },
      { type: 'extract', target, name: 'orderNo' },
      { type: 'savePdf', path: 'Lightomate/invoice_.pdf' },
    ],
  };
  await page.evaluate(
    (flow) =>
      chrome.storage.local.set({
        flows: { values: { id: 'values', createdAt: '', updatedAt: '', flow } },
      }),
    flow,
  );
  const id = new URL(page.url()).host;
  await page.bringToFront();
  await page.goto(`chrome-extension://${id}/options/options.html#values`);
  await page.reload();
  await page.waitForFunction(
    () =>
      /** @type {any} */ (globalThis).Blockly?.getMainWorkspace()?.getAllBlocks(false).length > 0,
  );

  // PDF の保存のブロックを選び、Ctrl + Enter キーでメニューを開いて、先頭の［値を入れる］を Enter キーで押します。
  await page.locator('#blocks').scrollIntoViewIfNeeded();
  const point = await page.evaluate(() => {
    const workspace = /** @type {any} */ (globalThis).Blockly.getMainWorkspace();
    const block = workspace
      .getAllBlocks(true)
      .find((/** @type {any} */ b) => b.type === 'lm_savePdf');
    const rect = block.getSvgRoot().getBoundingClientRect();
    return { x: rect.x + 12, y: rect.y + 10 };
  });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Control+Enter');
  await page.getByRole('menuitem', { name: /^値を入れる/ }).waitFor();
  await page.keyboard.press('Enter');

  // 一覧には、パラメータ、前の読み取りの名前、決まった値が出て、最初の値にフォーカスが移ります。
  const panel = page.locator('#blocks-values');
  await panel.waitFor();
  assert.equal(
    await page.evaluate(() =>
      globalThis.document.activeElement?.textContent?.startsWith('{{month}}'),
    ),
    true,
  );
  for (const text of ['{{month.year}}', '{{orderNo}}', '{{run.yyyy}}']) {
    assert.equal(
      await panel
        .getByRole('button', { name: new RegExp(`^${text.replace(/[{}.]/g, '\\$&')}`) })
        .count(),
      1,
      text,
    );
  }

  // Tab キーで「{{orderNo}}」まで移り、Enter キーで入れます。
  for (let i = 0; i < 10; i += 1) {
    const focused = await page.evaluate(() => globalThis.document.activeElement?.textContent ?? '');
    if (focused.startsWith('{{orderNo}}')) {
      break;
    }
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Enter');
  await panel.waitFor({ state: 'hidden' });
  await page
    .locator('.lm-toast')
    .getByText('「{{orderNo}}」を保存先の拡張子の前に入れました')
    .waitFor();

  await page.locator('#blocks-save').click();
  const saved = await waitUntil(
    () =>
      page.evaluate(async () => {
        const { flows } = await chrome.storage.local.get('flows');
        return /** @type {{ values: { flow: Flow } }} */ (flows).values.flow;
      }),
    (flow) => /** @type {any} */ (flow.steps[2]).path !== 'Lightomate/invoice_.pdf',
  );
  assert.equal(/** @type {any} */ (saved.steps[2]).path, 'Lightomate/invoice_{{orderNo}}.pdf');
});

test('実行中の枠：ページの移動の直後の「待つ」の間も、ページに実行中の枠を表示する（#154）', async () => {
  const { extensionPage } = browser;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: '枠',
    origin: server.origin,
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/done.html` },
      { type: 'wait', ms: 3000 },
      { type: 'navigate', cause: 'user', url: `${server.origin}/picker.html` },
      { type: 'wait', ms: 3000 },
    ],
  };
  const run = runFlow(extensionPage, flow);

  /**
   * 実行のタブが、パスのページを表示し、そのページに実行中の枠があるまで待ちます。
   * @param {string} pathname
   */
  const frameShownAt = (pathname) =>
    waitUntil(
      async () => {
        const [page] = pagesAt(pathname);
        return page
          ? page
              .evaluate(() => globalThis.document.querySelectorAll('lightomate-status').length)
              .catch(() => 0)
          : 0;
      },
      (count) => count > 0,
    );
  // 最初のページを開いた後の「待つ」の間と、次のページへ移動した後の「待つ」の間の両方で、枠を表示します。
  assert.equal(await frameShownAt('/done.html'), 1);
  assert.equal(await frameShownAt('/picker.html'), 1);

  const entry = await run;
  assert.equal(entry.status, 'done');
  // 実行が終わると、枠を消します。
  const [page] = pagesAt('/picker.html');
  assert.equal(
    await page.evaluate(() => globalThis.document.querySelectorAll('lightomate-status').length),
    0,
  );
  await page.close();
});

/**
 * ページの実行中の枠（lightomate-status）の文字を返します。枠は閉じた Shadow DOM の中にあり、ページのスクリプトからは
 * 読めないため、Chrome DevTools Protocol の DOM.getDocument（pierce）で読みます。
 * @param {import('playwright').Page} page
 * @returns {Promise<string>}
 */
async function statusOverlayText(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    /** @type {string[]} */
    const texts = [];
    /**
     * @param {any} node
     * @param {boolean} inside
     */
    const visit = (node, inside) => {
      const here = inside || node.nodeName === 'LIGHTOMATE-STATUS';
      if (here && node.nodeType === 3) {
        texts.push(node.nodeValue);
      }
      for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
        visit(child, here);
      }
    };
    visit(root, false);
    return texts.join(' ');
  } finally {
    await session.detach();
  }
}

test('実行中の枠：枠の文字の下に、今行っている手順を表示する。入力する値や URL は表示しない（#156）', async () => {
  const { extensionPage } = browser;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: '手順の表示',
    origin: server.origin,
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/picker.html` },
      { type: 'wait', ms: 3000 },
      { type: 'extract', target: target('#clicked', 'p', '押した結果'), name: 'clicked' },
      { type: 'wait', ms: 3000 },
    ],
  };
  const run = runFlow(extensionPage, flow);

  /**
   * 実行のタブの枠の文字が、条件を満たすまで待ちます。
   * @param {(text: string) => boolean} done
   */
  const overlayText = (done) =>
    waitUntil(async () => {
      const [page] = pagesAt('/picker.html');
      return page ? statusOverlayText(page).catch(() => '') : '';
    }, done);

  // ページを開いた直後の「待つ」と、ページを操作した後の「待つ」の両方で、手順を表示します。
  const first = await overlayText((text) => text.includes('手順 2 / 4'));
  assert.match(first, /▶ 実行中（Lightomate）/);
  assert.match(first, /手順 2 \/ 4：3 秒待つ/);
  assert.ok(!first.includes(server.origin), first);
  const second = await overlayText((text) => text.includes('手順 4 / 4'));
  assert.match(second, /手順 4 \/ 4：3 秒待つ/);

  const entry = await run;
  assert.equal(entry.status, 'done');
  for (const page of pagesAt('/picker.html')) {
    await page.close();
  }
});

test('一時停止：「待つ」の途中で［一時停止］を押すと、その場で一時停止し、［再開］で残りの時間を待ってから完了する（#160）', async () => {
  const { extensionPage } = browser;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 12,
    name: '待つの途中の一時停止',
    origin: server.origin,
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/done.html` },
      { type: 'wait', ms: 4000 },
    ],
  };
  const started = await extensionPage.evaluate(async (flow) => {
    await chrome.storage.local.remove('history');
    await chrome.storage.local.set({
      flows: { last: { id: 'last', createdAt: '', updatedAt: '', flow } },
    });
    return chrome.runtime.sendMessage({
      kind: 'runner/start',
      flowId: 'last',
      params: {},
      secrets: {},
    });
  }, flow);
  assert.equal(started.ok, true);
  /** @returns {Promise<{ status?: string, stepIndex?: number, midStep?: boolean } | undefined>} */
  const state = () =>
    extensionPage.evaluate(
      async (key) =>
        /** @type {{ status?: string, stepIndex?: number, midStep?: boolean } | undefined} */ (
          (await chrome.storage.session.get(key))[key]
        ),
      `run/${started.runId}`,
    );

  // 最後の手順（4 秒待つ）の途中で［一時停止］を押します。
  await waitUntil(state, (value) => value?.status === 'running' && value.stepIndex === 1);
  await extensionPage.evaluate(
    (runId) => chrome.runtime.sendMessage({ kind: 'runner/pause', runId }),
    started.runId,
  );
  // 完了せずに「待つ」の手順の途中で一時停止し、その状態が続きます。
  const paused = await waitUntil(state, (value) => value?.status === 'paused');
  assert.equal(paused?.stepIndex, 1);
  assert.equal(paused?.midStep, true);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  assert.equal((await state())?.status, 'paused');

  // ［再開］を押すと、残りの時間を待ってから完了します。すぐには完了しません。
  const resumedAt = Date.now();
  await extensionPage.evaluate(
    (runId) => chrome.runtime.sendMessage({ kind: 'runner/resume', runId }),
    started.runId,
  );
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const running = await state();
  assert.equal(running?.status, 'running');
  assert.equal(running?.midStep, undefined);
  const history = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { history } = await chrome.storage.local.get('history');
        return /** @type {import('../extension/shared/history.js').HistoryEntry[]} */ (
          history ?? []
        );
      }),
    (entries) => entries.length > 0,
  );
  assert.equal(history[0].status, 'done');
  assert.ok(Date.now() - resumedAt >= 1500, '再開の後、残りの時間を待たずに完了しました。');
  for (const page of pagesAt('/done.html')) {
    await page.close();
  }
});

/**
 * 記録から繰り返しを作る確認（#167）です。1 件目の操作を記録し、サイドパネルで範囲を選んで繰り返しにし、実行します。
 * @param {boolean} translate 記録と実行の両方で、ページの文字を翻訳と同じく置き換えるか
 */
async function recordLoop(translate) {
  const { extensionPage } = browser;
  const id = new URL(extensionPage.url()).host;
  const site = await browser.context.newPage();
  const listUrl = `${server.origin}/popover-orders.html${translate ? '?translate=1' : ''}`;
  await site.goto(listUrl);
  if (translate) {
    await site.waitForSelector('.receipt-menu font');
  }
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, listUrl);
  const started = await extensionPage.evaluate(
    (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
    tabId,
  );
  assert.deepEqual(started, { ok: true });

  // 1 件目の注文だけを操作します。小さな枠は、行の外（ページの末尾）にあります。
  // 翻訳した場合は、翻訳が差し込んだ font 要素を押します。
  const inside = translate ? ' font font' : '';
  await site.click(`.order:nth-child(1) .order-date${inside}`);
  await site.click(`.order:nth-child(1) .receipt-menu${inside}`);
  await Promise.all([
    site.waitForURL(/\/invoice\.html/),
    site.click(`#popover-A-001 a[href^="invoice"]${inside}`),
  ]);
  await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[] }} */ (recording).steps.length;
      }),
    (count) => count >= 5,
  );
  // 一覧のページへ戻ります。戻る操作は、ページを開く手順（利用者の操作による移動）として記録されます。
  await site.goBack();
  await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[] }} */ (recording).steps.length;
      }),
    (count) => count >= 6,
  );

  // サイドパネルの記録中の区画で、範囲を選んで繰り返しにします。
  const panel = await browser.context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel/sidepanel.html`);
  await panel.click('#recording-loop');
  const form = panel.locator('#recording-loop-form');
  // 既定の範囲は、行の中を操作した最初の手順（2 番目）から、一覧のページへ戻った手順の前までです。
  // ページを開く手順（1 番目と 6 番目）には、印を付けられません。
  // 手順の印だけを数えます。日付の手順の下の「この日付が対象の月の行だけ行う」（#183）などは含めません。
  const boxes = form.locator('.lm-loop-pick > li > input[type="checkbox"]');
  assert.equal(await boxes.count(), 6);
  for (const index of [0, 5]) {
    assert.equal(await boxes.nth(index).isDisabled(), true, `${index + 1} 番目の手順`);
    assert.equal(await boxes.nth(index).isChecked(), false, `${index + 1} 番目の手順`);
  }
  for (const index of [1, 2, 3, 4]) {
    assert.equal(await boxes.nth(index).isChecked(), true, `${index + 1} 番目の手順`);
  }
  // 行の中の手順と、行の外（小さな枠）の手順を見分ける印を表示します。
  assert.deepEqual(await form.locator('.lm-loop-scope').allInnerTexts(), [
    '1 件の中',
    '1 件の中',
    'ページ全体',
  ]);
  assert.match(await form.locator('.alert').innerText(), /このページの一覧 3 件 で、手順 2〜5/);
  // 一覧の行は CSS セレクターではなく件数で示します。候補が 1 つの場合は、選ぶ欄を出しません。
  assert.equal(await form.locator('select').isVisible(), false);
  // 範囲の印を外すと、範囲が縮みます。
  await boxes.nth(4).uncheck();
  assert.match(await form.locator('.alert').innerText(), /手順 2〜4/);
  await boxes.nth(4).check();
  await form.getByRole('button', { name: '3 件で繰り返す' }).click();
  await waitUntil(
    () => panel.locator('#steps > li').count(),
    (count) => count === 3,
  );
  assert.equal(await panel.locator('#steps .lm-steps-inner > li').count(), 4);

  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.equal(stopped.ok, true);
  assert.deepEqual(stopped.errors, []);
  /** @type {Flow} */
  const flow = stopped.flow;
  const loop = flow.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.deepEqual(
    flow.steps.map((step) => step.type),
    ['navigate', 'forEach', 'navigate'],
  );
  assert.deepEqual(
    loop.steps.map((step) =>
      'target' in step ? `${step.type}:${step.target.scope ?? 'page'}` : step.type,
    ),
    ['click:item', 'click:item', 'click:page', 'navigate'],
  );
  await panel.close();
  await site.evaluate(() => localStorage.removeItem('invoices'));
  await site.close();

  const entry = await runFlow(extensionPage, { ...flow, interval: { min: 1000, max: 1000 } });
  assert.equal(entry.status, 'done', entry.reason ?? '');
  const [opened] = pagesAt('/');
  const invoices = await opened.evaluate(() =>
    JSON.parse(localStorage.getItem('invoices') ?? '[]'),
  );
  assert.deepEqual(invoices, ['A-001', 'A-002', 'A-003']);
  for (const page of [...pagesAt('/popover-orders.html'), ...pagesAt('/invoice.html')]) {
    await page.close();
  }
}

test('記録から繰り返しを作る：1 件目の操作を記録し、サイドパネルで範囲を選ぶと、全行で同じ操作を行う（#167）', () =>
  recordLoop(false));

test('記録から繰り返しを作る：翻訳したページで記録し、翻訳したページで実行しても、全行で同じ操作を行う（#167）', () =>
  recordLoop(true));

test('リンク先のファイルを保存：PDF のリンクのクリックを記録すると保存の指定になり、全行の PDF をログインの Cookie 付きで保存する（#172）', async () => {
  const { extensionPage } = browser;
  const site = await browser.context.newPage();
  const listUrl = `${server.origin}/link-orders.html`;
  await site.goto(listUrl);
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, listUrl);
  const started = await extensionPage.evaluate(
    (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
    tabId,
  );
  assert.deepEqual(started, { ok: true });

  // 1 件目の明細書のリンクを押します。PDF への移動は記録せず、クリックが保存の指定に変わります。
  await site.click('.order:nth-child(1) a.invoice');
  const recorded = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[], rowHints: any[] }} */ (recording);
      }),
    (recording) =>
      recording.steps.length >= 2 &&
      recording.steps[1].type === 'click' &&
      recording.steps[1].download?.from === 'link',
  );
  assert.deepEqual(
    recorded.steps.map((step) => step.type),
    ['navigate', 'click'],
  );

  // 記録した手順を、一覧の各行で繰り返す手順にします（#167）。
  const key = JSON.stringify(recorded.rowHints[1][0].items.selectors);
  const looped = await extensionPage.evaluate(
    (key) =>
      chrome.runtime.sendMessage({ kind: 'recording/makeLoop', from: 1, to: 1, key, count: 2 }),
    key,
  );
  assert.deepEqual(looped, { ok: true });
  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.equal(stopped.ok, true);
  assert.deepEqual(stopped.errors, []);
  await site.close();

  /** @type {Flow} */
  const flow = { ...stopped.flow, name: 'リンク先の保存', interval: { min: 1000, max: 1000 } };
  const entry = await runFlow(extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  const files = await waitUntil(
    async () =>
      listFiles(browser.downloadDir).filter((file) =>
        file.startsWith('Lightomate/リンク先の保存/'),
      ),
    (list) => list.length >= 3,
  );
  assert.equal(files.length, 3);
  const contents = files
    .map((file) => fs.readFileSync(path.join(browser.downloadDir, file), 'latin1'))
    .map((text) => /\((A-\d{3})\) Tj/.exec(text)?.[1])
    .sort();
  assert.deepEqual(contents, ['A-001', 'A-002', 'A-003']);
  // 実行中は、PDF の表示画面へ移動しません。
  assert.deepEqual(pagesAt('/auth/invoice.pdf'), []);
  for (const page of pagesAt('/link-orders.html')) {
    await page.close();
  }
});

test('リンク先のファイルを保存：リンクがフローのサイト以外を指す場合は、保存せずに停止する（#172）', async () => {
  const before = listFiles(browser.downloadDir);
  /** @type {Flow} */
  const flow = {
    schemaVersion: 14,
    name: '別のサイトのリンク',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/link-orders.html` },
      {
        type: 'click',
        target: target('#external', 'a', '別のサイトの明細書'),
        download: { path: 'Lightomate/別のサイト/明細書', from: 'link' },
      },
    ],
  };
  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'failed');
  assert.match(entry.reason ?? '', /フローのサイト.*ではないため、保存せずに停止しました/);
  assert.deepEqual(listFiles(browser.downloadDir), before);
  for (const page of pagesAt('/link-orders.html')) {
    await page.close();
  }
});

test('要素がない行は飛ばす：行の中の要素が見つからない行を飛ばして最後の行まで進み、飛ばした行を実行履歴に残す（#174）', async () => {
  /** @type {Flow} */
  const flow = {
    schemaVersion: 15,
    name: '飛ばす行',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/skip-orders.html` },
      {
        type: 'forEach',
        items: target('div.order', 'div', '注文の行'),
        onMissing: 'skip',
        steps: [
          {
            type: 'click',
            target: target('a.invoice', 'a', '明細書', true),
            download: { path: 'Lightomate/飛ばす行/明細書', from: 'link' },
          },
        ],
      },
    ],
  };
  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  assert.deepEqual(
    entry.skipped?.map((row) => row.items),
    [[2], [4]],
  );
  assert.equal(entry.skipped?.[0].step, 'リンク先のファイルを保存：明細書');
  const files = await waitUntil(
    async () =>
      listFiles(browser.downloadDir).filter((file) => file.startsWith('Lightomate/飛ばす行/')),
    (list) => list.length >= 2,
  );
  assert.equal(files.length, 2);
  for (const page of pagesAt('/skip-orders.html')) {
    await page.close();
  }
});

test('要素がない行は飛ばす：すべての行を飛ばした場合は「失敗」にする（#174）', async () => {
  /** @type {Flow} */
  const flow = {
    schemaVersion: 15,
    name: 'すべて飛ばす',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/skip-orders.html` },
      {
        type: 'forEach',
        items: target('div.order.canceled', 'div', 'キャンセル済みの行'),
        onMissing: 'skip',
        steps: [{ type: 'click', target: target('a.invoice', 'a', '明細書', true) }],
      },
    ],
  };
  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'failed');
  assert.match(entry.reason ?? '', /2 件すべてで、行の中の要素が見つからなかった/);
  assert.equal(entry.skipped?.length, 2);
  for (const page of pagesAt('/skip-orders.html')) {
    await page.close();
  }
});

test('接続できないページ：PDF の表示画面のように接続が切れるページへ移動しても止まらず、一覧へ戻った後も続けられる（#171）', async () => {
  const { extensionPage } = browser;
  const listUrl = `${server.origin}/link-orders.html`;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 15,
    name: '接続できないページ',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: listUrl },
      { type: 'pause', note: '別のページへ移動して戻ります。' },
      {
        type: 'extract',
        target: target('.order:nth-child(2) .order-number', 'span', '注文番号'),
        name: 'number',
      },
    ],
  };
  const started = await extensionPage.evaluate(async (flow) => {
    await chrome.storage.local.remove('history');
    await chrome.storage.local.set({
      flows: { unreachable: { id: 'unreachable', createdAt: '', updatedAt: '', flow } },
    });
    return chrome.runtime.sendMessage({
      kind: 'runner/start',
      flowId: 'unreachable',
      params: {},
      secrets: {},
    });
  }, flow);
  assert.equal(started.ok, true);
  /** @returns {Promise<{ status?: string, tabId?: number } | undefined>} */
  const state = () =>
    extensionPage.evaluate(
      async (key) =>
        /** @type {{ status?: string, tabId?: number } | undefined} */ (
          (await chrome.storage.session.get(key))[key]
        ),
      `run/${started.runId}`,
    );
  const paused = await waitUntil(state, (value) => value?.status === 'paused');

  // Chrome の PDF の表示画面と同じく、拡張機能が接続できないページ（chrome://）へ移動します。タブは開いたまま、
  // ダイアログを受け取る接続（chrome.debugger）が target_closed で切れます。その後、一覧のページへ戻ります。
  await extensionPage.evaluate(
    async ({ tabId, listUrl }) => {
      await chrome.tabs.update(tabId, { url: 'chrome://version' });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await chrome.tabs.update(tabId, { url: listUrl });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    },
    { tabId: paused?.tabId, listUrl },
  );
  // 接続が切れても、タブが開いているため止まりません。
  assert.equal((await state())?.status, 'paused');

  await extensionPage.evaluate(
    (runId) => chrome.runtime.sendMessage({ kind: 'runner/resume', runId }),
    started.runId,
  );
  const [entry] = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { history } = await chrome.storage.local.get('history');
        return /** @type {import('../extension/shared/history.js').HistoryEntry[]} */ (
          history ?? []
        );
      }),
    (entries) => entries.length > 0,
    30_000,
  );
  assert.equal(entry.status, 'done', entry.reason ?? '');
  for (const page of pagesAt('/link-orders.html')) {
    await page.close();
  }
});

test('接続できないページ：実行中のタブを本当に閉じた場合は、これまでどおり停止する（#171）', async () => {
  const { extensionPage } = browser;
  /** @type {Flow} */
  const flow = {
    schemaVersion: 15,
    name: 'タブを閉じる',
    origin: server.origin,
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/link-orders.html` },
      { type: 'pause', note: 'タブを閉じます。' },
      { type: 'wait', ms: 1000 },
    ],
  };
  const started = await extensionPage.evaluate(async (flow) => {
    await chrome.storage.local.remove('history');
    await chrome.storage.local.set({
      flows: { closing: { id: 'closing', createdAt: '', updatedAt: '', flow } },
    });
    return chrome.runtime.sendMessage({
      kind: 'runner/start',
      flowId: 'closing',
      params: {},
      secrets: {},
    });
  }, flow);
  assert.equal(started.ok, true);
  const paused = await waitUntil(
    () =>
      extensionPage.evaluate(
        async (key) =>
          /** @type {{ status?: string, tabId?: number } | undefined} */ (
            (await chrome.storage.session.get(key))[key]
          ),
        `run/${started.runId}`,
      ),
    (value) => value?.status === 'paused',
  );
  await extensionPage.evaluate(
    (tabId) => chrome.tabs.remove(/** @type {number} */ (tabId)),
    paused?.tabId,
  );
  const [entry] = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { history } = await chrome.storage.local.get('history');
        return /** @type {import('../extension/shared/history.js').HistoryEntry[]} */ (
          history ?? []
        );
      }),
    (entries) => entries.length > 0,
    30_000,
  );
  assert.equal(entry.status, 'failed');
  assert.match(entry.reason ?? '', /実行中のタブが閉じられたため、停止しました。/);
});

test('一覧へ戻る：行に読み込むたびに変わるリンクがあっても、同じ一覧として最後の行まで進む（#177）', async () => {
  /** @type {Flow} */
  const flow = {
    schemaVersion: 15,
    name: '変わるリンク',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/volatile-orders.html` },
      {
        type: 'forEach',
        items: target('div.order', 'div', '注文の行'),
        steps: [
          { type: 'click', target: target('a.detail', 'a', '詳細', true) },
          { type: 'navigate', cause: 'page', url: `${server.origin}/receipt.html?n=V-001` },
          {
            type: 'extract',
            target: target('#number', 'p', '注文番号'),
            name: 'number',
          },
        ],
      },
    ],
  };
  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  for (const page of [...pagesAt('/volatile-orders.html'), ...pagesAt('/receipt.html')]) {
    await page.close();
  }
});

test('ファイル名：注文番号の文字を押して記録し、ファイル名に使うと、注文番号の名前で保存する（#179）', async () => {
  const { extensionPage } = browser;
  const site = await browser.context.newPage();
  const listUrl = `${server.origin}/link-orders.html`;
  await site.goto(listUrl);
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, listUrl);
  assert.deepEqual(
    await extensionPage.evaluate(
      (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
      tabId,
    ),
    { ok: true },
  );
  // 1 件目の注文番号の文字を押してから、明細書のリンクを押します。
  await site.click('.order:nth-child(1) .order-number');
  await site.click('.order:nth-child(1) a.invoice');
  const recorded = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[], rowHints: any[] }} */ (recording);
      }),
    (recording) =>
      recording.steps.length >= 3 &&
      recording.steps[2].type === 'click' &&
      recording.steps[2].download?.from === 'link',
  );
  const key = JSON.stringify(recorded.rowHints[2][0].items.selectors);
  const looped = await extensionPage.evaluate(
    (key) =>
      chrome.runtime.sendMessage({
        kind: 'recording/makeLoop',
        from: 1,
        to: 2,
        key,
        count: 3,
        names: [1],
        withSite: true,
      }),
    key,
  );
  assert.deepEqual(looped, { ok: true });
  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.deepEqual(stopped.errors, []);
  await site.close();

  /** @type {Flow} */
  const flow = { ...stopped.flow, name: 'ファイル名', interval: { min: 1000, max: 1000 } };
  const entry = await runFlow(extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  const files = await waitUntil(
    async () =>
      listFiles(browser.downloadDir).filter((file) => file.startsWith('Lightomate/ファイル名/')),
    (list) => list.length >= 3,
  );
  // サイト名（{{site.host}}）は、ポートを含まないホスト名です。
  assert.deepEqual(files, [
    'Lightomate/ファイル名/127.0.0.1_A-001.pdf',
    'Lightomate/ファイル名/127.0.0.1_A-002.pdf',
    'Lightomate/ファイル名/127.0.0.1_A-003.pdf',
  ]);
  for (const page of pagesAt('/link-orders.html')) {
    await page.close();
  }
});

test('ページ送り：記録で押した「次へ」をページ送りにすると、位置が変わる「次へ」でも最後のページまで保存する（#182）', async () => {
  const { extensionPage } = browser;
  const site = await browser.context.newPage();
  const listUrl = `${server.origin}/paged-orders.html`;
  await site.goto(listUrl);
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, listUrl);
  assert.deepEqual(
    await extensionPage.evaluate(
      (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
      tabId,
    ),
    { ok: true },
  );
  // 1 件目の注文番号の文字と明細書を押し、［戻る］で一覧へ戻ってから「次へ」を押します（Amazon と同じ流れ）。
  // 「次へ」の前に、ページ送りと関係のない場所（ほかの拡張機能のアイコンなど）も押します。
  await site.click('.order:nth-child(1) .order-number');
  await site.click('.order:nth-child(1) a.invoice');
  await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[] }} */ (recording).steps;
      }),
    (steps) => steps.length >= 3 && steps[2].type === 'click' && steps[2].download?.from === 'link',
  );
  await site.goBack();
  await site.waitForURL(listUrl);
  await site.click('#other-icon');
  await site.click('li.next > a');
  const recorded = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[], rowHints: any[], pagerHints: any[] }} */ (recording);
      }),
    (recording) => recording.steps.length >= 7,
  );
  assert.deepEqual(
    recorded.steps.map((step) => step.type),
    ['navigate', 'click', 'click', 'navigate', 'click', 'click', 'navigate'],
  );
  // 記録の指定は何番目の li かをたどるため、2 ページ目では「次へ」を指しません。ページ送りの指定は位置に頼りません。
  assert.ok(recorded.pagerHints[5].includes('li.next > a'), JSON.stringify(recorded.pagerHints[5]));
  await site.waitForURL(`${listUrl}?p=2`);
  const structural =
    recorded.steps[5].type === 'click' && recorded.steps[5].target.selectors.at(-1);
  assert.equal(await site.locator(String(structural)).count(), 0, String(structural));

  // サイドパネルで、注文番号をファイル名に使い、「次へ」のクリックで次のページへ送る繰り返しにします。
  const id = new URL(extensionPage.url()).host;
  const panel = await browser.context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel/sidepanel.html`);
  await panel.click('#recording-loop');
  const form = panel.locator('#recording-loop-form');
  await form.getByLabel('この文字をファイル名に使う').check();
  // 「次へ」は［戻る］（範囲に含められない手順）とほかのクリックの後にありますが、次のページへ送るクリックに
  // 選べます。
  const pager = form.getByLabel('このクリックで次のページへ送る');
  assert.equal(await pager.count(), 1);
  await pager.check();
  assert.match(
    await form.locator('.alert').innerText(),
    /手順 6 のクリックで次のページへ送り、最後のページまで（最大 10 ページ）繰り返します。/,
  );
  // ［戻る］、ほかの場所のクリック、「次へ」の後の移動は、ページ送りに置き換えるため除くことを示します。
  assert.equal(await form.getByText('→ ページ送りに置き換えるため、手順から除きます').count(), 3);
  await form.getByRole('button', { name: '全ページで繰り返す' }).click();
  await waitUntil(
    () => panel.locator('#steps > li').count(),
    (count) => count === 2,
  );
  await panel.close();
  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.deepEqual(stopped.errors, []);
  assert.deepEqual(
    stopped.flow.steps.map((/** @type {Step} */ step) => step.type),
    ['navigate', 'forEach'],
  );
  await site.close();

  /** @type {Flow} */
  const flow = { ...stopped.flow, name: 'ページ送り', interval: { min: 500, max: 500 } };
  const entry = await runFlow(extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  const files = await waitUntil(
    async () =>
      listFiles(browser.downloadDir).filter((file) => file.startsWith('Lightomate/ページ送り/')),
    (list) => list.length >= 6,
  );
  assert.deepEqual(
    files,
    ['P1-1', 'P1-2', 'P2-1', 'P2-2', 'P3-1', 'P3-2'].map(
      (number) => `Lightomate/ページ送り/${number}.pdf`,
    ),
  );
  for (const page of pagesAt('/paged-orders.html')) {
    await page.close();
  }
});

test('対象の月：記録で押した注文日を条件にすると、対象の月の注文だけを保存し、古い月の行で終える（#183）', async () => {
  const { extensionPage } = browser;
  const site = await browser.context.newPage();
  const listUrl = `${server.origin}/paged-orders.html`;
  await site.goto(listUrl);
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, listUrl);
  assert.deepEqual(
    await extensionPage.evaluate(
      (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
      tabId,
    ),
    { ok: true },
  );
  // 1 件目の注文日、注文番号、明細書を押し、［戻る］で一覧へ戻ってから「次へ」を押します。
  await site.click('.order:nth-child(1) .order-date');
  await site.click('.order:nth-child(1) .order-number');
  await site.click('.order:nth-child(1) a.invoice');
  await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[] }} */ (recording).steps;
      }),
    (steps) => steps.length >= 4 && steps[3].type === 'click' && steps[3].download?.from === 'link',
  );
  await site.goBack();
  await site.waitForURL(listUrl);
  await site.click('li.next > a');
  await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[] }} */ (recording).steps.length;
      }),
    (count) => count >= 7,
  );

  // サイドパネルで、注文番号をファイル名に使い、注文日を対象の月の条件にし、「次へ」で次のページへ送ります。
  const id = new URL(extensionPage.url()).host;
  const panel = await browser.context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel/sidepanel.html`);
  await panel.click('#recording-loop');
  const form = panel.locator('#recording-loop-form');
  await form.getByLabel('この文字をファイル名に使う').nth(1).check();
  // 日付として読める注文日の手順にだけ、条件の印が出ます。
  const dateToggle = form.getByLabel('この日付が対象の月の行だけ行う');
  assert.equal(await dateToggle.count(), 1);
  await dateToggle.check();
  assert.match(
    await form.locator('.alert').innerText(),
    /手順 2 の日付が、実行するときに入力する対象の月（既定は前月）の行だけ行います。/,
  );
  // 古い行で終える印は、既定で付いています。
  assert.equal(await form.getByLabel(/対象の月より古い行に達したら/).isChecked(), true);
  await form.getByLabel('このクリックで次のページへ送る').check();
  await form.getByRole('button', { name: '全ページで繰り返す' }).click();
  await waitUntil(
    () => panel.locator('#steps > li').count(),
    (count) => count === 2,
  );
  await panel.close();
  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.deepEqual(stopped.errors, []);
  await site.close();

  /** @type {Flow} */
  const recordedFlow = stopped.flow;
  assert.equal(recordedFlow.params?.[0].type, 'month');
  // 実行した日に左右されないよう、対象の月に 2026 年 8 月を入力して実行します。
  /** @type {Flow} */
  const flow = { ...recordedFlow, name: '対象の月', interval: { min: 500, max: 500 } };
  const entry = await runFlow(extensionPage, flow, { month: '2026-08' });
  assert.equal(entry.status, 'done', entry.reason ?? '');
  // 9 月の行は条件を満たさないため保存せず、7 月の行（3 ページ目の 1 行目）で終えます。終えたため、その後の
  // 8 月の行（3 ページ目の 2 行目、P3-2）も保存しません。
  assert.deepEqual(
    await waitUntil(
      async () =>
        listFiles(browser.downloadDir).filter((file) => file.startsWith('Lightomate/対象の月/')),
      (list) => list.length >= 2,
    ),
    ['Lightomate/対象の月/P2-1.pdf', 'Lightomate/対象の月/P2-2.pdf'],
  );
  for (const page of pagesAt('/paged-orders.html')) {
    await page.close();
  }
});

test('明細書が複数ある注文：一致するリンクをすべて保存し、2 件目以降の名前に番号を付ける（#185）', async () => {
  const { extensionPage } = browser;
  const site = await browser.context.newPage();
  const listUrl = `${server.origin}/multi-invoices.html`;
  await site.goto(listUrl);
  const tabId = await extensionPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return tab.id;
  }, listUrl);
  assert.deepEqual(
    await extensionPage.evaluate(
      (tabId) => chrome.runtime.sendMessage({ kind: 'recording/start', tabId }),
      tabId,
    ),
    { ok: true },
  );
  // 1 件目の注文番号の文字、［領収書等］、小さな枠の明細書を押します。
  await site.click('.order:nth-child(1) .order-number');
  await site.click('.order:nth-child(1) .receipt-menu');
  await site.click('#popover-content-1 a[href$="invoice.pdf"]');
  const recorded = await waitUntil(
    () =>
      extensionPage.evaluate(async () => {
        const { recording } = await chrome.storage.session.get('recording');
        return /** @type {{ steps: Step[], rowHints: any[] }} */ (recording);
      }),
    (recording) =>
      recording.steps.length >= 4 &&
      recording.steps[3].type === 'click' &&
      recording.steps[3].download?.from === 'link',
  );
  const link = recorded.steps[3];
  assert.ok(link.type === 'click');
  assert.equal(link.download?.all, true);
  // 枠の id と表示の文字ではなく、リンク先の形で探します。
  assert.equal(link.target.selectors[0], 'a[href*="/documents/download/"][href*="/invoice.pdf"]');
  const key = JSON.stringify(recorded.rowHints[1][0].items.selectors);
  assert.deepEqual(
    await extensionPage.evaluate(
      (key) =>
        chrome.runtime.sendMessage({
          kind: 'recording/makeLoop',
          from: 1,
          to: 3,
          key,
          count: 4,
          names: [1],
          withSite: false,
        }),
      key,
    ),
    { ok: true },
  );
  const stopped = await extensionPage.evaluate(() =>
    chrome.runtime.sendMessage({ kind: 'recording/stop' }),
  );
  assert.deepEqual(stopped.errors, []);
  await site.close();

  /** @type {Flow} */
  const flow = { ...stopped.flow, name: '複数の明細書', interval: { min: 500, max: 500 } };
  const expected = ['M-001', 'M-002', 'M-002_2', 'M-003'].map(
    (name) => `Lightomate/複数の明細書/${name}.pdf`,
  );
  // もう一度実行しても同じ名前で上書きするため、ファイルは増えません。2 回目は、Chrome の翻訳と同じく表示の文字を
  // 置き換えたページで実行します。リンクは表示の文字ではなくリンク先の形で探すため、同じ明細書を保存します。
  for (const round of [1, 2]) {
    const steps = flow.steps.map((step, index) =>
      round === 2 && index === 0 && step.type === 'navigate'
        ? { ...step, url: `${step.url}?translate=1` }
        : step,
    );
    const entry = await runFlow(extensionPage, { ...flow, steps });
    assert.equal(entry.status, 'done', `${round} 回目：${entry.reason ?? ''}`);
    assert.deepEqual(
      await waitUntil(
        async () =>
          listFiles(browser.downloadDir).filter((file) =>
            file.startsWith('Lightomate/複数の明細書/'),
          ),
        (list) => list.length >= 4,
      ),
      expected,
      `${round} 回目`,
    );
  }
  for (const page of pagesAt('/multi-invoices.html')) {
    await page.close();
  }
});

test('ファイル名：同じ実行の中で同じ名前を 2 回保存した場合は、上書きせずに別名で保存する（#179）', async () => {
  /** @type {Flow} */
  const flow = {
    schemaVersion: 15,
    name: '同じ名前',
    origin: server.origin,
    interval: { min: 1000, max: 1000 },
    steps: [
      { type: 'navigate', cause: 'user', url: `${server.origin}/done.html` },
      { type: 'savePdf', path: 'Lightomate/同じ名前/領収書', onConflict: 'overwrite' },
      { type: 'savePdf', path: 'Lightomate/同じ名前/領収書', onConflict: 'overwrite' },
    ],
  };
  const entry = await runFlow(browser.extensionPage, flow);
  assert.equal(entry.status, 'done', entry.reason ?? '');
  assert.deepEqual(
    await waitUntil(
      async () =>
        listFiles(browser.downloadDir).filter((file) => file.startsWith('Lightomate/同じ名前/')),
      (list) => list.length >= 2,
    ),
    ['Lightomate/同じ名前/領収書 (1).pdf', 'Lightomate/同じ名前/領収書.pdf'],
  );
  for (const page of pagesAt('/done.html')) {
    await page.close();
  }
});
