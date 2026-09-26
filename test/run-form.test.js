import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_FIRST_PAGE,
  firstPageParams,
  firstPageUrl,
  readRunFields,
  secretStepIndexes,
} from '../extension/shared/run-form.js';

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
    { type: 'input', target, value: '{{q}}' },
    { type: 'input', target: { ...target, label: 'パスワード' }, secret: true },
  ],
};

test('最初のページを開くときは、最初の手順の URL が参照するパラメータだけを尋ねる', () => {
  assert.deepEqual(
    firstPageParams(flow).map((param) => param.name),
    ['month'],
  );
});

test('最初の手順の URL にパラメータの値を当てはめる', () => {
  assert.deepEqual(firstPageUrl(flow, { month: '2026-07' }, new Date(2026, 8, 25)), {
    ok: true,
    url: 'https://www.example.com/orders?m=2026-07',
  });
});

test('値を入力しない場合は、既定値を当てはめる', () => {
  assert.deepEqual(firstPageUrl(flow, {}, new Date(2026, 8, 25)), {
    ok: true,
    url: 'https://www.example.com/orders?m=2026-08',
  });
});

test('最初の手順の URL が参照しないパラメータは、値がなくても開ける', () => {
  const simple = {
    ...flow,
    steps: [
      {
        type: /** @type {const} */ ('navigate'),
        cause: /** @type {const} */ ('user'),
        url: 'https://www.example.com/',
      },
      ...flow.steps.slice(1),
    ],
  };
  assert.deepEqual(firstPageParams(simple), []);
  assert.deepEqual(firstPageUrl(simple, {}, new Date()), {
    ok: true,
    url: 'https://www.example.com/',
  });
});

test('値の形式が誤っている場合は開かない', () => {
  const result = firstPageUrl(flow, { month: '7月' }, new Date());
  assert.equal(result.ok, false);
});

test('最初の手順がページを開く手順でない場合は、開くページが決まらない', () => {
  const clickFirst = { ...flow, steps: flow.steps.slice(1) };
  assert.deepEqual(firstPageParams(clickFirst), []);
  assert.deepEqual(firstPageUrl(clickFirst, {}, new Date()), { ok: false, error: NO_FIRST_PAGE });
});

test('パラメータで開くページが別のサイトになる場合は開かない', () => {
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
  const result = firstPageUrl(redirected, { u: 'https://evil.example.net/' }, new Date());
  assert.equal(result.ok, false);
});

test('値を記録していない入力欄の手順の番号を返す', () => {
  assert.deepEqual(secretStepIndexes(flow), [2]);
});

test('入力フォームの値を、パラメータと、値を記録していない欄の値に分ける', () => {
  assert.deepEqual(
    readRunFields([
      ['param:q', 'ねじ'],
      ['secret:2', 'pass'],
      ['other', 'x'],
      ['param:file', /** @type {unknown} */ ({})],
    ]),
    { params: { q: 'ねじ' }, secrets: { 2: 'pass' } },
  );
});

test('値を記録していない入力欄の番号は、if と forEach の内側を展開した通し番号にする（#6）', () => {
  const secret = {
    type: 'input',
    target: { selectors: ['#p'], tag: 'input', label: 'パスワード' },
    secret: true,
  };
  const nested = /** @type {import('../extension/shared/flow.js').Flow} */ ({
    ...flow,
    schemaVersion: 6,
    steps: [
      flow.steps[0],
      {
        type: 'if',
        condition: { target: secret.target, exists: true },
        then: [secret],
      },
      secret,
    ],
  });
  assert.deepEqual(secretStepIndexes(nested), [2, 3]);
});
