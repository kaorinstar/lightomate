import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveSteps, samePage } from '../extension/background/runner.js';

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
