import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isNewPageLoaded,
  lastPageNavigationIndex,
  resolveSteps,
  samePage,
} from '../extension/background/runner.js';

const target = { selectors: ['#q'], tag: 'input', label: '検索' };

/** @type {import('../extension/shared/flow.js').Flow} */
const flow = {
  schemaVersion: 1,
  name: '注文を探す',
  origin: 'https://www.example.com',
  params: [
    { name: 'q', label: '検索語', type: 'text' },
    { name: 'month', label: '対象月', type: 'month', default: '@previous-month' },
  ],
  steps: [
    { type: 'navigate', cause: 'user', url: 'https://www.example.com/orders?m={{month}}' },
    { type: 'input', target, value: '{{q}} {{month.year}}年{{month.month}}月' },
    { type: 'input', target: { ...target, label: 'パスワード' }, secret: true },
    {
      type: 'select',
      target: { ...target, tag: 'select' },
      values: ['{{month.mm}}'],
      labels: ['月'],
    },
  ],
};

test('パラメータと、値を記録していない欄の値を手順に当てはめる', () => {
  const result = resolveSteps(flow, { q: 'ねじ' }, { 2: 'pass' }, new Date(2026, 8, 24));
  assert.ok(result.ok);
  assert.deepEqual(result.steps, [
    { type: 'navigate', cause: 'user', url: 'https://www.example.com/orders?m=2026-08' },
    { type: 'input', target, value: 'ねじ 2026年8月' },
    { type: 'input', target: { ...target, label: 'パスワード' }, value: 'pass' },
    { type: 'select', target: { ...target, tag: 'select' }, values: ['08'], labels: ['月'] },
  ]);
});

test('値を記録していない欄の値がない場合は実行しない', () => {
  const result = resolveSteps(flow, { q: 'ねじ' }, {}, new Date(2026, 8, 24));
  assert.equal(result.ok, false);
});

test('パラメータで移動先が別のサイトになる場合は実行しない', () => {
  const redirected = {
    ...flow,
    params: [{ name: 'u', label: 'URL', type: /** @type {const} */ ('text') }],
    steps: [
      {
        type: /** @type {const} */ ('navigate'),
        cause: /** @type {const} */ ('user'),
        url: '{{u}}',
      },
    ],
  };
  const result = resolveSteps(redirected, { u: 'https://evil.example/' }, {}, new Date());
  assert.equal(result.ok, false);
});

test('同じページかは、クエリ文字列とページ内の位置を除いて比べる', () => {
  assert.ok(samePage('https://a.example/p?x=1#top', 'https://a.example/p?x=2'));
  assert.ok(!samePage('https://a.example/p', 'https://a.example/q'));
  assert.ok(!samePage('https://a.example/p', 'https://b.example/p'));
  assert.ok(!samePage('', 'https://a.example/p'));
});

test('続けて記録されたページの移動は、最後の移動の手順までまとめる', () => {
  const click = { type: 'click', target };
  const page = (/** @type {string} */ path) => ({
    type: 'navigate',
    cause: 'page',
    url: `https://www.example.com${path}`,
  });
  const steps = /** @type {import('../extension/shared/flow.js').Step[]} */ ([
    click,
    page('/cart/add-to-cart'),
    page('/cart/view'),
    click,
    page('/checkout'),
  ]);
  assert.equal(lastPageNavigationIndex(steps, 1), 2);
  assert.equal(lastPageNavigationIndex(steps, 4), 4);
});

test('利用者の操作による移動は、まとめる対象に含めない', () => {
  const steps = /** @type {import('../extension/shared/flow.js').Step[]} */ ([
    { type: 'navigate', cause: 'page', url: 'https://www.example.com/a' },
    { type: 'navigate', cause: 'user', url: 'https://www.example.com/b' },
  ]);
  assert.equal(lastPageNavigationIndex(steps, 0), 0);
});

test('移動の前と異なるページの読み込みが完了した時点で、移動が終わったと判定する', () => {
  // 記録時と移動先の URL が異なっても、新しいページであれば移動が終わったと判定します（#51）。
  assert.ok(isNewPageLoaded('doc-a', { documentId: 'doc-b', status: 'complete' }));
  assert.ok(isNewPageLoaded(undefined, { documentId: 'doc-b', status: 'complete' }));
});

test('同じページのままの場合と、読み込み中の場合は、移動が終わったと判定しない', () => {
  assert.ok(!isNewPageLoaded('doc-a', { documentId: 'doc-a', status: 'complete' }));
  assert.ok(!isNewPageLoaded('doc-a', { documentId: 'doc-b', status: 'loading' }));
  assert.ok(!isNewPageLoaded('doc-a', { documentId: undefined, status: 'complete' }));
});

test('ページの操作による移動は、行き先のサイトを問わない（#41）', () => {
  // 楽天市場の例です。商品ページから、買い物かご、ログインの画面、注文確認へ転送されます。
  /** @type {import('../extension/shared/flow.js').Flow} */
  const rakuten = {
    schemaVersion: 5,
    name: '楽天',
    origin: 'https://item.rakuten.co.jp',
    steps: [
      { type: 'navigate', cause: 'user', url: 'https://item.rakuten.co.jp/shop/1/' },
      { type: 'click', target },
      { type: 'navigate', cause: 'page', url: 'https://cart.step.rakuten.co.jp/cart' },
      { type: 'navigate', cause: 'page', url: 'https://login.account.rakuten.com/sso/authorize' },
      { type: 'navigate', cause: 'page', url: 'https://cart.step.rakuten.co.jp/order' },
    ],
  };
  const result = resolveSteps(rakuten, {}, {}, new Date());
  assert.ok(result.ok);
  assert.equal(result.steps.length, 5);
});

test('利用者の操作による移動は、フローのサイトと追加のサイトだけを受け付ける（#41）', () => {
  /** @type {import('../extension/shared/flow.js').Flow} */
  const base = {
    schemaVersion: 5,
    name: 'ログイン',
    origin: 'https://www.example.com',
    steps: [{ type: 'navigate', cause: 'user', url: 'https://login.example.com/' }],
  };
  assert.equal(resolveSteps(base, {}, {}, new Date()).ok, false);
  assert.ok(
    resolveSteps({ ...base, extraOrigins: ['https://login.example.com'] }, {}, {}, new Date()).ok,
  );
});

test('値を記録していない欄の手順も、手順を記録したサイトを残す（#41）', () => {
  /** @type {import('../extension/shared/flow.js').Flow} */
  const login = {
    schemaVersion: 5,
    name: 'ログイン',
    origin: 'https://www.example.com',
    extraOrigins: ['https://login.example.com'],
    steps: [
      { type: 'navigate', cause: 'user', url: 'https://www.example.com/' },
      { type: 'input', target, secret: true, origin: 'https://login.example.com' },
    ],
  };
  const result = resolveSteps(login, {}, { 1: 'pass' }, new Date());
  assert.ok(result.ok);
  assert.deepEqual(result.steps[1], {
    type: 'input',
    target,
    value: 'pass',
    origin: 'https://login.example.com',
  });
});
