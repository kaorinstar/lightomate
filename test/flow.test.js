import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STEPS,
  SCHEMA_VERSION,
  orderFlow,
  validateFlow,
  validateStep,
} from '../extension/shared/flow.js';

const target = { selectors: ['#login'], tag: 'button', label: 'ログイン', text: 'ログイン' };

/** 形式を満たすフロー定義です。各テストはこれを 1 か所だけ変えて使います。 */
const validFlow = {
  schemaVersion: SCHEMA_VERSION,
  name: '注文履歴を開く',
  origin: 'https://www.example.com',
  steps: [
    { type: 'navigate', url: 'https://www.example.com/', cause: 'user' },
    { type: 'input', target: { ...target, tag: 'input', label: 'メール' }, value: 'a@example.com' },
    { type: 'input', target: { ...target, tag: 'input', label: 'パスワード' }, secret: true },
    { type: 'select', target: { ...target, tag: 'select' }, values: ['2'], labels: ['2 個'] },
    { type: 'click', target },
    { type: 'navigate', url: 'https://www.example.com/orders?page=2', cause: 'page' },
  ],
};

test('形式を満たすフロー定義には誤りを報告しない', () => {
  assert.deepEqual(validateFlow(validFlow), []);
});

test('手順が 0 件でも形式は満たす', () => {
  assert.deepEqual(validateFlow({ ...validFlow, steps: [] }), []);
});

test('オブジェクト以外は、例外を投げずに誤りを報告する', () => {
  for (const value of [null, undefined, 'flow', 1, []]) {
    assert.equal(validateFlow(value).length, 1, `値: ${JSON.stringify(value)}`);
  }
});

test('版番号が異なる場合は誤りを報告する', () => {
  assert.equal(validateFlow({ ...validFlow, schemaVersion: SCHEMA_VERSION + 1 }).length, 1);
  assert.equal(validateFlow({ ...validFlow, schemaVersion: String(SCHEMA_VERSION) }).length, 1);
});

test('フロー名が空の場合は誤りを報告する', () => {
  assert.equal(validateFlow({ ...validFlow, name: '   ' }).length, 1);
});

test('オリジンそのものでない場合は誤りを報告する', () => {
  for (const origin of [
    'https://www.example.com/', // 末尾のスラッシュはパスにあたります
    'https://www.example.com/orders',
    'www.example.com',
    'javascript:alert(1)',
    'file:///C:/',
    'chrome://extensions',
  ]) {
    assert.equal(validateFlow({ ...validFlow, origin }).length, 1, `origin: ${origin}`);
  }
});

test('ポート番号付きの http のオリジンは受け付ける', () => {
  assert.deepEqual(validateFlow({ ...validFlow, origin: 'http://localhost:8080' }), []);
});

test('手順の誤りは、何番目の手順かを付けて報告する', () => {
  const errors = validateFlow({ ...validFlow, steps: [validFlow.steps[0], {}, null] });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^steps\[1\]/);
  assert.match(errors[1], /^steps\[2\]/);
});

test('手順が上限を超える場合は誤りを報告する', () => {
  const steps = Array.from({ length: MAX_STEPS + 1 }, () => validFlow.steps[0]);
  assert.equal(validateFlow({ ...validFlow, steps }).length, 1);
});

test('知らない種類の手順は受け付けない', () => {
  assert.equal(validateStep({ type: 'script', code: 'alert(1)' }).length, 1);
});

test('移動先は https:// または http:// の URL だけを受け付ける', () => {
  for (const url of ['javascript:alert(1)', 'file:///C:/', 'chrome://settings', '/orders']) {
    assert.equal(validateStep({ type: 'navigate', url, cause: 'user' }).length, 1, url);
  }
  assert.equal(
    validateStep({ type: 'navigate', url: 'https://www.example.com/', cause: 'other' }).length,
    1,
  );
});

test('値を記録しない入力欄に、値が含まれている場合は誤りを報告する', () => {
  assert.equal(validateStep({ type: 'input', target, secret: true, value: 'pass' }).length, 1);
  assert.equal(validateStep({ type: 'input', target, secret: false, value: 'pass' }).length, 1);
  assert.equal(validateStep({ type: 'input', target }).length, 1);
});

test('要素の指定にセレクターがない場合は誤りを報告する', () => {
  assert.equal(validateStep({ type: 'click', target: { ...target, selectors: [] } }).length, 1);
  assert.equal(validateStep({ type: 'click', target: { ...target, selectors: [''] } }).length, 1);
  assert.equal(validateStep({ type: 'click' }).length, 1);
});

test('長すぎる文字列は受け付けない', () => {
  const value = 'a'.repeat(2001);
  assert.equal(validateStep({ type: 'input', target, value }).length, 1);
});

test('項目を並べ直しても、内容は変わらず、type が先頭になる', () => {
  const sorted = JSON.parse(
    JSON.stringify(validFlow, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value,
    ),
  );
  const ordered = orderFlow(sorted);
  assert.deepEqual(ordered, validFlow);
  assert.deepEqual(Object.keys(ordered).slice(0, 3), ['schemaVersion', 'name', 'origin']);
  assert.equal(Object.keys(ordered.steps[0])[0], 'type');
});
