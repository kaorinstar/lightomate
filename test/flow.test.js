import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STEPS,
  SCHEMA_VERSION,
  flowOrigins,
  formatFlowJson,
  orderFlow,
  replaceJsonFields,
  replaceJsonName,
  stepOrigin,
  validateFlow,
  validateStep,
  withInterval,
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

test('版 1〜9 のフローは、そのまま版 10 として検証を通る', () => {
  assert.equal(SCHEMA_VERSION, 10);
  for (const schemaVersion of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    assert.deepEqual(validateFlow({ ...validFlow, schemaVersion }), []);
  }
});

test('手順の間隔（interval）は、0〜60,000 の整数で、min が max 以下の場合だけ通る（#15）', () => {
  assert.deepEqual(validateFlow({ ...validFlow, interval: { min: 0, max: 0 } }), []);
  assert.deepEqual(validateFlow({ ...validFlow, interval: { min: 1000, max: 60000 } }), []);
  for (const interval of [
    { min: -1, max: 1000 },
    { min: 1000, max: 60001 },
    { min: 1.5, max: 2000 },
    { min: 3000, max: 1000 },
    { min: '1000', max: 1000 },
    { min: 1000 },
    [1000, 2000],
    null,
  ]) {
    assert.equal(
      validateFlow({ ...validFlow, interval }).length,
      1,
      `値: ${JSON.stringify(interval)}`,
    );
  }
});

test('待機の手順（wait）は、1〜300,000 の整数のミリ秒だけ通る（#15）', () => {
  assert.deepEqual(validateStep({ type: 'wait', ms: 1 }), []);
  assert.deepEqual(validateStep({ type: 'wait', ms: 300000 }), []);
  for (const ms of [0, -1, 300001, 1.5, '3000', undefined]) {
    assert.equal(validateStep({ type: 'wait', ms }).length, 1, `値: ${String(ms)}`);
  }
});

test('版 3 以前のフローに interval と wait がある場合は、版 4 が必要である旨の誤りを報告する', () => {
  const errors = validateFlow({
    ...validFlow,
    schemaVersion: 3,
    interval: { min: 1000, max: 2000 },
    steps: [...validFlow.steps, { type: 'wait', ms: 3000 }],
  });
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.includes('4 以上')));
});

test('withInterval は間隔を加え、古い版は版 4 にし、undefined で削除する。元のフローは変えない', () => {
  const old = /** @type {import('../extension/shared/flow.js').Flow} */ ({
    ...validFlow,
    schemaVersion: 2,
  });
  const changed = withInterval(old, { min: 1000, max: 3000 });
  assert.equal(changed.schemaVersion, 4);
  assert.deepEqual(changed.interval, { min: 1000, max: 3000 });
  assert.deepEqual(validateFlow(changed), []);
  assert.equal('interval' in old, false);

  const cleared = withInterval(changed, undefined);
  assert.equal('interval' in cleared, false);
  assert.equal(cleared.schemaVersion, 4);
  assert.deepEqual(changed.interval, { min: 1000, max: 3000 });
});

test('replaceJsonFields は指定した項目だけを書き換え、undefined の項目は削除する', () => {
  const text = JSON.stringify({ schemaVersion: 3, name: 'a', interval: { min: 1, max: 2 } });
  assert.equal(
    replaceJsonFields(text, { schemaVersion: 4, interval: undefined }),
    JSON.stringify({ schemaVersion: 4, name: 'a' }, null, 2),
  );
  assert.equal(replaceJsonFields('{', { name: 'b' }), null);
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

// ---- JSON の整形（#50） ----

test('1 行に詰まった JSON を、字下げ 2 文字で整形する', () => {
  const result = formatFlowJson(JSON.stringify(validFlow));
  assert.ok(result.ok);
  assert.equal(result.text, JSON.stringify(validFlow, null, 2));
  assert.match(result.text, /^\{\n {2}"schemaVersion"/);
});

test('形式を満たすフローは、表示を開き直したときと同じ順序に並べ直す', () => {
  // chrome.storage から読み込んだ場合と同じく、項目を名前の順に並べた JSON です。
  const sorted = JSON.stringify(validFlow, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
  const result = formatFlowJson(sorted);
  assert.ok(result.ok);
  const formatted = JSON.parse(result.text);
  // 並び順以外は変えません。
  assert.deepEqual(formatted, validFlow);
  assert.deepEqual(Object.keys(formatted).slice(0, 3), ['schemaVersion', 'name', 'origin']);
  for (const step of formatted.steps) {
    assert.equal(Object.keys(step)[0], 'type');
  }
});

test('形式に誤りがあるフローは、順序を変えずに字下げだけを直す', () => {
  const invalid = { steps: 'まだ書いていない', name: '', note: '編集中' };
  const result = formatFlowJson(JSON.stringify(invalid));
  assert.ok(result.ok);
  assert.equal(result.text, JSON.stringify(invalid, null, 2));
  // 最上位がオブジェクトでない値も、そのまま整形します。
  assert.deepEqual(formatFlowJson('[1,2]'), { ok: true, text: '[\n  1,\n  2\n]' });
});

test('JSON として読み取れない場合は、整形結果を返さず誤りを返す', () => {
  const result = formatFlowJson('{ "name": "途中');
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.startsWith('JSON として読み取れません。'));
  assert.equal('text' in result, false);
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

test('savePdf の mode は省略でき、print か screen だけを受け付ける（#73）', () => {
  assert.deepEqual(validateStep({ type: 'savePdf', mode: 'print' }), []);
  assert.deepEqual(validateStep({ type: 'savePdf', mode: 'screen' }), []);
  for (const mode of ['SCREEN', 'pdf', '', 1, null, true]) {
    assert.deepEqual(
      validateStep({ type: 'savePdf', mode }),
      ['mode が print または screen ではありません。'],
      `mode: ${JSON.stringify(mode)}`,
    );
  }
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

test('追加のサイト（extraOrigins）を検証する（#41）', () => {
  const origin = validFlow.origin;
  const extra = 'https://login.example.net';
  assert.deepEqual(validateFlow({ ...validFlow, extraOrigins: [extra] }), []);
  assert.deepEqual(validateFlow({ ...validFlow, extraOrigins: [] }), []);
  /** @type {Array<[unknown, RegExp]>} */
  const cases = [
    ['https://a.example', /配列ではありません/],
    [['https://a.example/path'], /オリジンではありません/],
    [['ftp://a.example'], /オリジンではありません/],
    [[origin], /フローの origin と同じ/],
    [[extra, extra], /重複/],
    [Array.from({ length: 11 }, (_, i) => `https://s${i}.example`), /上限の 10 件/],
  ];
  for (const [extraOrigins, message] of cases) {
    const errors = validateFlow({ ...validFlow, extraOrigins });
    assert.equal(errors.length, 1, JSON.stringify(extraOrigins));
    assert.match(errors[0], message);
  }
  const old = validateFlow({ ...validFlow, schemaVersion: 4, extraOrigins: [extra] });
  assert.equal(old.length, 1);
  assert.match(old[0], /schemaVersion が 5 以上/);
});

test('手順の origin は、フローの origin か extraOrigins のサイトだけを受け付ける（#41）', () => {
  const extra = 'https://login.example.net';
  const target = { selectors: ['#id'], tag: 'input', label: 'ID' };
  const step = { type: 'input', target, value: 'a', origin: extra };
  const flow = { ...validFlow, extraOrigins: [extra], steps: [...validFlow.steps, step] };
  assert.deepEqual(validateFlow(flow), []);
  assert.deepEqual(
    validateFlow({ ...flow, steps: [...validFlow.steps, { ...step, origin: validFlow.origin }] }),
    [],
  );

  const outside = validateFlow({ ...validFlow, steps: [...validFlow.steps, step] });
  assert.equal(outside.length, 1);
  assert.match(outside[0], /extraOrigins にもありません/);

  const old = validateFlow({ ...flow, schemaVersion: 4, extraOrigins: undefined });
  assert.equal(old.length, 1);
  assert.match(old[0], /origin は、schemaVersion が 5 以上/);

  assert.match(
    validateFlow({
      ...flow,
      steps: [...validFlow.steps, { type: 'wait', ms: 1, origin: extra }],
    })[0],
    /click、input、select、extract の手順にだけ/,
  );
  assert.match(
    validateFlow({ ...flow, steps: [...validFlow.steps, { ...step, origin: 'login' }] })[0],
    /オリジンではありません/,
  );
});

test('フローが操作するサイトと、手順を実行してよいサイトを返す（#41）', () => {
  const flow = { origin: 'https://a.example', extraOrigins: ['https://b.example'] };
  assert.deepEqual(flowOrigins(flow), ['https://a.example', 'https://b.example']);
  assert.deepEqual(flowOrigins({ origin: 'https://a.example' }), ['https://a.example']);
  const target = { selectors: ['#a'], tag: 'button', label: 'a' };
  assert.equal(stepOrigin(flow, { type: 'click', target }), 'https://a.example');
  assert.equal(
    stepOrigin(flow, { type: 'click', target, origin: 'https://b.example' }),
    'https://b.example',
  );
});

// 条件分岐と繰り返し（#6）の検証です。
const rowTarget = { selectors: ['tr.order'], tag: 'tr', label: '注文の行' };
const inRow = { selectors: ['.number'], tag: 'span', label: '注文番号', scope: 'item' };

/**
 * 版 6 のフローです。
 * @param {unknown[]} steps
 */
const v6 = (steps) => ({ ...validFlow, schemaVersion: 6, steps });

test('if と forEach を含むフローは、形式を満たす（#6）', () => {
  const flow = v6([
    {
      type: 'if',
      condition: { target, exists: true },
      then: [{ type: 'click', target }],
      else: [{ type: 'wait', ms: 1000 }],
    },
    {
      type: 'forEach',
      items: rowTarget,
      max: 500,
      steps: [
        { type: 'extract', target: inRow, name: 'orderNumber' },
        {
          type: 'if',
          condition: { target: { ...inRow, label: '領収書' }, exists: true },
          then: [{ type: 'click', target: { ...inRow, label: '領収書' } }],
        },
        { type: 'savePdf', path: '{{orderNumber}}.pdf' },
      ],
    },
  ]);
  assert.deepEqual(validateFlow(flow), []);
});

test('if と forEach は、版 6 より古いフローには書けない（#6）', () => {
  const steps = [{ type: 'if', condition: { target, exists: true }, then: [] }];
  assert.equal(validateFlow({ ...validFlow, schemaVersion: 5, steps }).length, 1);
});

test('if の必須項目がない場合は誤りを報告する（#6）', () => {
  for (const step of [
    { type: 'if', then: [] },
    { type: 'if', condition: { target, exists: 'yes' }, then: [] },
    { type: 'if', condition: { target: {}, exists: true }, then: [] },
    { type: 'if', condition: { target, exists: true } },
    { type: 'if', condition: { target, exists: true }, then: [], else: {} },
  ]) {
    assert.ok(validateFlow(v6([step])).length > 0, JSON.stringify(step));
  }
});

test('forEach の max は、1 以上 500 以下の整数だけを受け付ける（#6）', () => {
  const forEach = (/** @type {unknown} */ max) => ({
    type: 'forEach',
    items: rowTarget,
    ...(max === undefined ? {} : { max }),
    steps: [],
  });
  assert.deepEqual(validateFlow(v6([forEach(undefined)])), []);
  assert.deepEqual(validateFlow(v6([forEach(1)])), []);
  assert.deepEqual(validateFlow(v6([forEach(500)])), []);
  for (const max of [0, 501, 1.5, '10']) {
    assert.equal(validateFlow(v6([forEach(max)])).length, 1, `値: ${String(max)}`);
  }
  assert.ok(validateFlow(v6([{ type: 'forEach', items: rowTarget }])).length > 0);
  assert.ok(validateFlow(v6([{ type: 'forEach', steps: [] }])).length > 0);
});

test('内側の手順の誤りは、位置を付けて報告する（#6）', () => {
  const errors = validateFlow(
    v6([
      {
        type: 'if',
        condition: { target, exists: true },
        then: [{ type: 'click' }],
      },
    ]),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^steps\[0\]\.then\[0\]: /);
});

test('if と forEach の入れ子は 3 段まで（#6）', () => {
  /** @param {unknown[]} steps */
  const nest = (steps) => ({ type: 'if', condition: { target, exists: true }, then: steps });
  assert.deepEqual(validateFlow(v6([nest([nest([nest([{ type: 'click', target }])])])])), []);
  const errors = validateFlow(v6([nest([nest([nest([nest([])])])])]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /3 段まで/);
});

test('手順の件数の上限は、内側の手順も数える（#6）', () => {
  const click = { type: 'click', target };
  const half = Array.from({ length: MAX_STEPS / 2 }, () => click);
  const loop = { type: 'forEach', items: rowTarget, steps: half };
  // forEach 自身の 1 件と内側の 500 件、外側の 500 件で、上限を 1 件超えます。
  assert.equal(validateFlow(v6([loop, ...half])).length, 1);
  assert.deepEqual(validateFlow(v6([loop, ...half.slice(1)])), []);
});

test('scope: item は、forEach の内側の手順にだけ書ける（#6）', () => {
  assert.equal(validateFlow(v6([{ type: 'click', target: inRow }])).length, 1);
  assert.equal(
    validateFlow(v6([{ type: 'if', condition: { target: inRow, exists: true }, then: [] }])).length,
    1,
  );
  // 外側に繰り返しがない forEach の items にも書けません。
  assert.equal(
    validateFlow(v6([{ type: 'forEach', items: { ...rowTarget, scope: 'item' }, steps: [] }]))
      .length,
    1,
  );
  // 入れ子の forEach の items には書けます。外側の行の内側で探します。
  assert.deepEqual(
    validateFlow(
      v6([
        {
          type: 'forEach',
          items: rowTarget,
          steps: [{ type: 'forEach', items: { ...inRow, label: '商品' }, steps: [] }],
        },
      ]),
    ),
    [],
  );
  assert.equal(
    validateFlow(
      v6([
        {
          type: 'forEach',
          items: rowTarget,
          steps: [{ type: 'click', target: { ...inRow, scope: 'row' } }],
        },
      ]),
    ).length,
    1,
  );
  assert.equal(
    validateFlow({ ...validFlow, schemaVersion: 5, steps: [{ type: 'click', target: inRow }] })
      .length,
    1,
  );
});

test('forEach の内側には navigate の手順を書けない（#6）', () => {
  const errors = validateFlow(
    v6([
      {
        type: 'forEach',
        items: rowTarget,
        steps: [
          {
            type: 'if',
            condition: { target, exists: true },
            then: [{ type: 'navigate', cause: 'page', url: 'https://www.example.com/a' }],
          },
        ],
      },
    ]),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /navigate/);
  // if の中の移動は書けます。
  assert.deepEqual(
    validateFlow(
      v6([
        {
          type: 'if',
          condition: { target, exists: true },
          then: [{ type: 'navigate', cause: 'page', url: 'https://www.example.com/a' }],
        },
      ]),
    ),
    [],
  );
});

// 繰り返しの中でのページの移動と、ページ送り（#95）の検証です。
const nextTarget = { selectors: ['a.next'], tag: 'a', label: '次へ' };

/**
 * 版 7 のフローです。
 * @param {unknown[]} steps
 */
const v7 = (steps) => ({ ...validFlow, schemaVersion: 7, steps });

test('版 7 では、forEach の内側にページの操作による移動（cause: page）を書ける（#95）', () => {
  const loop = (/** @type {string} */ cause) => ({
    type: 'forEach',
    items: rowTarget,
    steps: [
      { type: 'click', target: { ...inRow, tag: 'a', label: '領収書' } },
      { type: 'navigate', cause, url: 'https://www.example.com/receipt' },
      { type: 'savePdf' },
    ],
  });
  assert.deepEqual(validateFlow(v7([loop('page')])), []);
  // 一覧のページへは自動で戻るため、利用者の操作による移動は書けません。
  const errors = validateFlow(v7([loop('user')]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^steps\[0\]\.steps\[1\]: .*cause が user/);
  // 版 6 以前のフローでは、これまでどおり誤りです。
  const old = validateFlow(v6([loop('page')]));
  assert.equal(old.length, 1);
  assert.match(old[0], /schemaVersion が 7 以上/);
});

test('nextPage と maxPages を書いた forEach は、形式を満たす（#95）', () => {
  const flow = v7([
    { type: 'forEach', items: rowTarget, nextPage: nextTarget, maxPages: 50, steps: [] },
    { type: 'forEach', items: rowTarget, nextPage: nextTarget, steps: [] },
  ]);
  assert.deepEqual(validateFlow(flow), []);
});

test('maxPages は、1 以上 50 以下の整数だけを受け付ける（#95）', () => {
  const loop = (/** @type {unknown} */ maxPages) => ({
    type: 'forEach',
    items: rowTarget,
    nextPage: nextTarget,
    maxPages,
    steps: [],
  });
  assert.deepEqual(validateFlow(v7([loop(1)])), []);
  assert.deepEqual(validateFlow(v7([loop(50)])), []);
  for (const maxPages of [0, 51, 1.5, '10', null]) {
    assert.equal(validateFlow(v7([loop(maxPages)])).length, 1, `値: ${String(maxPages)}`);
  }
});

test('nextPage は要素の指定として検証し、scope は書けない（#95）', () => {
  assert.ok(
    validateFlow(v7([{ type: 'forEach', items: rowTarget, nextPage: { tag: 'a' }, steps: [] }]))
      .length > 0,
  );
  const errors = validateFlow(
    v7([
      {
        type: 'forEach',
        items: rowTarget,
        nextPage: { ...nextTarget, scope: 'item' },
        steps: [],
      },
    ]),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nextPage\.scope/);
});

test('nextPage と maxPages は、外側に forEach がない forEach にだけ書ける（#95）', () => {
  const inner = { type: 'forEach', items: inRow, nextPage: nextTarget, steps: [] };
  const errors = validateFlow(v7([{ type: 'forEach', items: rowTarget, steps: [inner] }]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^steps\[0\]\.steps\[0\]: .*外側に forEach がない/);
  // if の中の forEach には書けます。
  assert.deepEqual(
    validateFlow(
      v7([
        {
          type: 'if',
          condition: { target, exists: true },
          then: [{ type: 'forEach', items: rowTarget, nextPage: nextTarget, steps: [] }],
        },
      ]),
    ),
    [],
  );
});

test('nextPage と maxPages は、版 6 以前のフローには書けない（#95）', () => {
  const errors = validateFlow(
    v6([{ type: 'forEach', items: rowTarget, nextPage: nextTarget, maxPages: 5, steps: [] }]),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /schemaVersion が 7 以上/);
});

test('整形すると、forEach の nextPage と maxPages は max の後、steps の前に並ぶ（#95）', () => {
  const flow = /** @type {import('../extension/shared/flow.js').Flow} */ (
    v7([
      { steps: [], maxPages: 3, nextPage: nextTarget, items: rowTarget, type: 'forEach', max: 9 },
    ])
  );
  assert.deepEqual(Object.keys(orderFlow(flow).steps[0]), [
    'type',
    'items',
    'max',
    'nextPage',
    'maxPages',
    'steps',
  ]);
});

test('内側の手順のパラメータの参照と、読み取った名前の参照も検証する（#6）', () => {
  const errors = validateFlow(
    v6([
      {
        type: 'forEach',
        items: rowTarget,
        steps: [
          { type: 'input', target, value: '{{unknown}}' },
          { type: 'savePdf', path: '{{missing}}.pdf' },
        ],
      },
    ]),
  );
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^steps\[0\]\.steps\[0\]: /);
  assert.match(errors[1], /^steps\[0\]\.steps\[1\]: /);
});

test('整形すると、内側の手順も type が先頭に来る（#6）', () => {
  const flow = /** @type {import('../extension/shared/flow.js').Flow} */ (
    v6([
      {
        then: [{ target, type: 'click' }],
        condition: { target, exists: true },
        type: 'if',
      },
    ])
  );
  const ordered = orderFlow(flow);
  assert.deepEqual(Object.keys(ordered.steps[0]), ['type', 'condition', 'then']);
  const inner = /** @type {import('../extension/shared/flow.js').IfStep} */ (ordered.steps[0]);
  assert.deepEqual(Object.keys(inner.then[0]), ['type', 'target']);
});

// 記録したときにページが翻訳されていたこと（#99）の検証です。

test('版 8 では、click・input・select・extract の手順に translated: true を書ける（#99）', () => {
  const steps = [
    { type: 'click', target, translated: true },
    { type: 'input', target: { ...target, tag: 'input' }, value: 'a', translated: true },
    { type: 'select', target, values: ['1'], labels: ['1 個'], translated: true },
    { type: 'extract', target, name: 'title', translated: true },
  ];
  assert.deepEqual(validateFlow({ ...validFlow, schemaVersion: 8, steps }), []);
  // 版 7 以前のフローでは誤りです。
  const errors = validateFlow({ ...validFlow, schemaVersion: 7, steps });
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^steps\[0\]: translated は、schemaVersion が 8 以上/);
});

test('translated は true だけを受け付け、ページを操作しない手順には書けない（#99）', () => {
  for (const translated of [false, 'true', 1, null]) {
    assert.deepEqual(validateStep({ type: 'click', target, translated }), [
      'translated が true ではありません。',
    ]);
  }
  for (const step of [
    { type: 'navigate', url: 'https://www.example.com/', cause: 'user' },
    { type: 'pause' },
    { type: 'savePdf' },
  ]) {
    assert.deepEqual(validateStep({ ...step, translated: true }), [
      'translated は、click、input、select、extract の手順にだけ書けます。',
    ]);
  }
});

// 条件を満たす間の繰り返し（while）と、文字・日付による条件（#103）の検証です。

/**
 * 版 9 のフローです。
 * @param {unknown[]} steps
 * @param {object} [extra]
 */
const v9 = (steps, extra = {}) => ({ ...validFlow, schemaVersion: 9, steps, ...extra });
const moreButton = { selectors: ['button.more'], tag: 'button', label: 'もっと見る' };
const dateCell = { selectors: ['.date'], tag: 'span', label: '注文日' };

test('版 9 では、while と文字・日付の条件を書ける（#103）', () => {
  const flow = v9(
    [
      {
        type: 'while',
        condition: { target: moreButton, exists: true },
        max: 500,
        steps: [{ type: 'click', target: moreButton }],
      },
      {
        type: 'forEach',
        items: rowTarget,
        steps: [
          {
            type: 'if',
            condition: { target: { ...dateCell, scope: 'item' }, month: '{{month}}' },
            then: [{ type: 'click', target: { ...inRow, tag: 'a' } }],
          },
          { type: 'if', condition: { target: inRow, contains: '発送済み' }, then: [] },
          { type: 'if', condition: { target: inRow, equals: '{{status}}' }, then: [] },
          {
            type: 'if',
            condition: { target: dateCell, from: '2026-09-01', to: '2026-09-30' },
            then: [],
          },
          { type: 'if', condition: { target: dateCell, from: '2026-09-01' }, then: [] },
          { type: 'if', condition: { target: dateCell, to: '2026-09-30' }, then: [] },
          { type: 'if', condition: { target: dateCell, month: '2026-09' }, then: [] },
        ],
      },
    ],
    {
      params: [
        { name: 'month', label: '対象の月', type: 'month' },
        { name: 'status', label: '状態', type: 'text' },
      ],
    },
  );
  assert.deepEqual(validateFlow(flow), []);
});

test('while と文字・日付の条件は、版 8 以前のフローには書けない（#103）', () => {
  const steps = [
    { type: 'while', condition: { target: moreButton, exists: true }, steps: [] },
    { type: 'if', condition: { target: dateCell, contains: 'a' }, then: [] },
  ];
  const errors = validateFlow({ ...validFlow, schemaVersion: 8, steps });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^steps\[0\]: while の手順は、schemaVersion が 9 以上/);
  assert.match(errors[1], /^steps\[1\]: 文字と日付の条件.*schemaVersion が 9 以上/);
});

test('条件には、種類を 1 つだけ書ける（#103）', () => {
  for (const condition of [
    { target: inRow },
    { target: inRow, exists: true, contains: 'a' },
    { target: inRow, month: '2026-09', from: '2026-09-01' },
    { target: inRow, contains: 'a', equals: 'a' },
  ]) {
    assert.ok(
      validateStep({ type: 'if', condition, then: [] }).some((error) =>
        error.includes('1 種類だけ'),
      ),
      JSON.stringify(condition),
    );
  }
  assert.deepEqual(
    validateStep({ type: 'if', condition: { target: inRow, contain: 'a' }, then: [] }),
    [
      'condition に、使えない項目（contain）があります。',
      'condition には、exists、contains、equals、month、from と to のどれか 1 種類だけを書いてください。',
    ],
  );
});

test('文字と日付の条件の値の形式を検証する（#103）', () => {
  const check = (/** @type {object} */ fields) =>
    validateStep({ type: 'if', condition: { target: inRow, ...fields }, then: [] });
  assert.deepEqual(check({ contains: '' }), ['condition.contains が空か、文字列ではありません。']);
  assert.deepEqual(check({ equals: 1 }), ['condition.equals が空か、文字列ではありません。']);
  for (const month of ['2026-9', '2026-13', '202609', 9]) {
    assert.equal(check({ month }).length, 1, String(month));
  }
  for (const from of ['2026-9-1', '2026-02-30', '2026/09/01']) {
    assert.equal(check({ from }).length, 1, from);
  }
  assert.deepEqual(check({ from: '2026-10-01', to: '2026-09-30' }), [
    'condition.from が、condition.to より後の日付です。',
  ]);
  // パラメータの参照は、実行時に形式を確かめます。
  assert.deepEqual(check({ month: '{{month}}' }), []);
  assert.deepEqual(check({ from: '{{month}}-01' }), []);
});

test('条件の値のパラメータの参照は、定義されたパラメータだけを使える（#103）', () => {
  const errors = validateFlow(
    v9([{ type: 'if', condition: { target: dateCell, month: '{{missing}}' }, then: [] }]),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing/);
});

test('while の max は 1 以上 500 以下の整数で、steps は配列（#103）', () => {
  const loop = (/** @type {unknown} */ max) => ({
    type: 'while',
    condition: { target: moreButton, exists: true },
    max,
    steps: [],
  });
  assert.deepEqual(validateStep(loop(1)), []);
  assert.deepEqual(validateStep(loop(500)), []);
  for (const max of [0, 501, 1.5, '10']) {
    assert.deepEqual(validateStep(loop(max)), ['max が 1 以上 500 以下の整数ではありません。']);
  }
  assert.deepEqual(
    validateStep({ type: 'while', condition: { target: moreButton, exists: true } }),
    ['steps が配列ではありません。'],
  );
});

test('while の内側では、forEach の外なら scope は書けず、forEach の中なら書ける（#103）', () => {
  const inner = [{ type: 'click', target: inRow }];
  const outside = validateFlow(
    v9([{ type: 'while', condition: { target: moreButton, exists: true }, steps: inner }]),
  );
  assert.equal(outside.length, 1);
  assert.match(outside[0], /scope は、forEach の内側の手順にだけ書けます/);
  const inside = validateFlow(
    v9([
      {
        type: 'forEach',
        items: rowTarget,
        steps: [{ type: 'while', condition: { target: inRow, exists: true }, steps: inner }],
      },
    ]),
  );
  assert.deepEqual(inside, []);
});

test('while も入れ子の段数と手順の件数に数える（#103）', () => {
  const deep = { type: 'while', condition: { target: moreButton, exists: true }, steps: [] };
  const nested = [
    { ...deep, steps: [{ ...deep, steps: [{ ...deep, steps: [{ ...deep, steps: [] }] }] }] },
  ];
  const errors = validateFlow(v9(nested));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /入れ子は 3 段まで/);
  const many = Array.from({ length: MAX_STEPS }, () => ({ type: 'wait', ms: 1 }));
  const over = validateFlow(
    v9([{ type: 'while', condition: { target: moreButton, exists: true }, steps: many }]),
  );
  assert.match(over[0], /上限の 1000 件を超えています/);
});

test('orderFlow は、while の項目を type、condition、max、steps の順に並べる（#103）', () => {
  const flow = v9([
    {
      steps: [{ ms: 1, type: 'wait' }],
      max: 5,
      condition: { target: moreButton, exists: true },
      type: 'while',
    },
  ]);
  const ordered = orderFlow(/** @type {any} */ (flow));
  assert.deepEqual(Object.keys(ordered.steps[0]), ['type', 'condition', 'max', 'steps']);
  assert.deepEqual(Object.keys(/** @type {any} */ (ordered.steps[0]).steps[0]), ['type', 'ms']);
});

// 手順の後に開いたダイアログへの応答（#88）の検証です。

test('版 10 では、click・input・select・navigate の手順に dialog を書ける（#88）', () => {
  const steps = [
    { type: 'navigate', url: 'https://www.example.com/', cause: 'user', dialog: ['accept'] },
    { type: 'click', target, dialog: ['accept', 'dismiss'] },
    { type: 'input', target: { ...target, tag: 'input' }, value: 'a', dialog: ['dismiss'] },
    {
      type: 'select',
      target,
      values: ['1'],
      labels: ['1 個'],
      dialog: ['accept', 'accept', 'accept', 'accept', 'accept'],
    },
  ];
  assert.deepEqual(validateFlow({ ...validFlow, schemaVersion: 10, steps }), []);
  // 版 9 以前のフローでは誤りです。
  const errors = validateFlow({ ...validFlow, schemaVersion: 9, steps });
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^steps\[0\]: dialog は、schemaVersion が 10 以上/);
});

test('dialog は accept と dismiss を 1〜5 個並べた配列だけを受け付け、対象の手順にだけ書ける（#88）', () => {
  for (const dialog of [
    [],
    ['ok'],
    ['accept', 'yes'],
    ['accept', 'accept', 'accept', 'accept', 'accept', 'accept'],
    'accept',
    true,
    null,
  ]) {
    assert.deepEqual(validateStep({ type: 'click', target, dialog }), [
      'dialog が、"accept" または "dismiss" を 1〜5 個並べた配列ではありません。',
    ]);
  }
  for (const step of [
    { type: 'extract', target, name: 'title' },
    { type: 'pause' },
    { type: 'savePdf' },
    { type: 'wait', ms: 1000 },
  ]) {
    assert.deepEqual(validateStep({ ...step, dialog: ['accept'] }), [
      'dialog は、click、input、select、navigate の手順にだけ書けます。',
    ]);
  }
});
