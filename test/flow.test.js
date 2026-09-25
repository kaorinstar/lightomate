import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STEPS,
  SCHEMA_VERSION,
  orderFlow,
  replaceJsonName,
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

test('版 1 と版 2 のフローは、そのまま版 3 として検証を通る', () => {
  assert.equal(SCHEMA_VERSION, 3);
  assert.deepEqual(validateFlow({ ...validFlow, schemaVersion: 1 }), []);
  assert.deepEqual(validateFlow({ ...validFlow, schemaVersion: 2 }), []);
});

test('一時停止の手順は、説明を省略でき、説明は文字列に限る', () => {
  assert.deepEqual(validateStep({ type: 'pause' }), []);
  assert.deepEqual(validateStep({ type: 'pause', note: '確定の手前です。' }), []);
  assert.equal(validateStep({ type: 'pause', note: 1 }).length, 1);
  assert.deepEqual(
    validateFlow({ ...validFlow, steps: [...validFlow.steps, { type: 'pause' }] }),
    [],
  );
});

test('版 1 のフローに一時停止の手順がある場合は誤りを報告する', () => {
  const errors = validateFlow({
    ...validFlow,
    schemaVersion: 1,
    steps: [...validFlow.steps, { type: 'pause' }],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /schemaVersion が 2 以上/);
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

test('編集中の JSON の名前だけを書き換え、ほかの編集内容を残す', () => {
  const edited = JSON.stringify({
    schemaVersion: 1,
    name: '旧い名前',
    origin: 'https://www.example.com',
    steps: [{ type: 'navigate', cause: 'user', url: 'https://www.example.com/edited' }],
    note: '保存していない編集',
  });
  const renamed = replaceJsonName(edited, '新しい名前');
  assert.ok(renamed);
  assert.deepEqual(JSON.parse(renamed), { ...JSON.parse(edited), name: '新しい名前' });
  // 項目の順序は変えません。
  assert.deepEqual(Object.keys(JSON.parse(renamed)), Object.keys(JSON.parse(edited)));
});

test('JSON として読み取れない、または最上位がオブジェクトでない場合は書き換えない', () => {
  assert.equal(replaceJsonName('{ "name": "途中', '新しい名前'), null);
  assert.equal(replaceJsonName('[1, 2]', '新しい名前'), null);
  assert.equal(replaceJsonName('"文字列"', '新しい名前'), null);
  assert.equal(replaceJsonName('null', '新しい名前'), null);
});

// ---- PDF の保存（savePdf）と読み取り（extract）（#16） ----

const extractTarget = { selectors: ['#order-id'], tag: 'span', label: '注文番号' };

test('savePdf は path と onConflict を省略でき、値を検証する', () => {
  assert.deepEqual(validateStep({ type: 'savePdf' }), []);
  assert.deepEqual(
    validateStep({
      type: 'savePdf',
      path: 'Lightomate/領収書/{{run.yyyy}}.pdf',
      onConflict: 'overwrite',
    }),
    [],
  );
  assert.equal(validateStep({ type: 'savePdf', onConflict: 'skip' }).length, 1);
  assert.equal(validateStep({ type: 'savePdf', path: 1 }).length, 1);
  assert.ok(validateStep({ type: 'savePdf', path: '../外/a.pdf' }).length > 0);
  assert.ok(validateStep({ type: 'savePdf', path: '/etc/a.pdf' }).length > 0);
  assert.ok(validateStep({ type: 'savePdf', path: 'C:/Users/a.pdf' }).length > 0);
});

test('extract は要素と名前を持ち、組み込みの値の名前は使えない', () => {
  assert.deepEqual(
    validateStep({ type: 'extract', target: extractTarget, name: 'orderNumber' }),
    [],
  );
  assert.equal(
    validateStep({ type: 'extract', target: extractTarget, name: '注文番号' }).length,
    1,
  );
  assert.equal(validateStep({ type: 'extract', target: extractTarget, name: 'run' }).length, 1);
  assert.ok(validateStep({ type: 'extract', name: 'orderNumber' }).length > 0);
});

test('savePdf の path は、組み込みの値、パラメータ、前の手順で読み取った値を参照できる', () => {
  const flow = {
    ...validFlow,
    schemaVersion: 3,
    params: [{ name: 'month', label: '対象月', type: 'month' }],
    steps: [
      ...validFlow.steps,
      { type: 'extract', target: extractTarget, name: 'orderNumber' },
      {
        type: 'savePdf',
        path: 'Lightomate/{{site.host}}/{{month.year}}-{{month.mm}}/{{orderNumber}}_{{run.hhmmss}}.pdf',
      },
    ],
  };
  assert.deepEqual(validateFlow(flow), []);
});

test('savePdf の path が、後の手順で読み取る値や未定義の名前を参照する場合は誤りを報告する', () => {
  const errors = validateFlow({
    ...validFlow,
    schemaVersion: 3,
    steps: [
      ...validFlow.steps,
      { type: 'savePdf', path: 'Lightomate/{{orderNumber}}.pdf' },
      { type: 'extract', target: extractTarget, name: 'orderNumber' },
    ],
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /orderNumber/);
});

test('extract の名前がパラメータと同じ場合は誤りを報告する', () => {
  const errors = validateFlow({
    ...validFlow,
    schemaVersion: 3,
    params: [{ name: 'orderNumber', label: '注文番号', type: 'text' }],
    steps: [...validFlow.steps, { type: 'extract', target: extractTarget, name: 'orderNumber' }],
  });
  assert.equal(errors.length, 1);
});

test('版 2 以前のフローに savePdf と extract がある場合は誤りを報告する', () => {
  const errors = validateFlow({
    ...validFlow,
    schemaVersion: 2,
    steps: [
      ...validFlow.steps,
      { type: 'extract', target: extractTarget, name: 'a' },
      { type: 'savePdf' },
    ],
  });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /schemaVersion が 3 以上/);
});
