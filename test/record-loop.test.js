// 記録した手順の範囲を、一覧の各行で繰り返す手順に変える処理（extension/shared/record-loop.js、#167）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  candidateKey,
  defaultLoopRange,
  excludedReason,
  loopOptionLabel,
  loopOptions,
  makeLoop,
  sanitizeRowHint,
  stepScopes,
  toggleRange,
} from '../extension/shared/record-loop.js';
import { SCHEMA_VERSION, validateFlow } from '../extension/shared/flow.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */
/** @typedef {import('../extension/shared/record-loop.js').RowHint} RowHint */

const orderRow = { selectors: ['div.order'], tag: 'div', label: '一覧の行（div.order）' };
const headCell = { selectors: ['div.head > span'], tag: 'span', label: '一覧の行（span）' };

/**
 * @param {string} selector
 * @param {string} label
 * @returns {import('../extension/shared/flow.js').Target}
 */
const pageTarget = (selector, label) => ({ selectors: [selector], tag: 'a', label });

/** @type {Step[]} */
const steps = [
  { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
  { type: 'click', target: pageTarget('#date-1', '2026年9月1日') },
  { type: 'click', target: pageTarget('#receipt-1', '領収書等') },
  { type: 'click', target: pageTarget('#popover-3 a', '明細書') },
  { type: 'navigate', url: 'https://shop.example.com/invoice/1.pdf', cause: 'page' },
];

/** @type {RowHint[]} */
const hints = [
  null,
  [
    {
      items: headCell,
      count: 2,
      inner: { selectors: [':scope > span.date'], tag: 'span', label: '日付', scope: 'item' },
    },
    {
      items: orderRow,
      count: 10,
      inner: { selectors: ['span.date'], tag: 'span', label: '日付', scope: 'item' },
    },
  ],
  [
    {
      items: orderRow,
      count: 10,
      inner: { selectors: ['a.receipt'], tag: 'a', label: '領収書等', scope: 'item' },
    },
  ],
  // 行の外（ページの末尾）に作られた小さな枠の中の要素です。一覧の行とは別の候補を持ちます。
  [
    {
      items: { selectors: ['ul.menu > li'], tag: 'li', label: '一覧の行（li）' },
      count: 3,
      inner: { selectors: ['a'], tag: 'a', label: '明細書', scope: 'item' },
    },
  ],
  null,
];

test('既定の範囲は、行の候補がある最初の手順から最後の手順までにする', () => {
  assert.deepEqual(defaultLoopRange(steps, hints), { from: 1, to: 4 });
  assert.equal(
    defaultLoopRange(
      steps,
      steps.map(() => null),
    ),
    null,
  );
});

test('行の候補は、範囲の中で多くの手順が操作した行を先にする', () => {
  const options = loopOptions(steps, hints, 1, 4);
  assert.deepEqual(
    options.map((option) => [option.items.label, option.used, option.count]),
    [
      ['一覧の行（div.order）', 2, 10],
      ['一覧の行（li）', 1, 3],
      ['一覧の行（span）', 1, 2],
    ],
  );
});

test('範囲を各行で繰り返す手順に変え、行の中の要素だけを scope: item にする', () => {
  const result = makeLoop(steps, hints, 1, 4, candidateKey(orderRow));
  assert.ok(result.ok);
  assert.equal(result.steps.length, 2);
  assert.deepEqual(result.steps[0], steps[0]);
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.deepEqual(loop.items, orderRow);
  assert.deepEqual(loop.steps, [
    {
      type: 'click',
      target: { selectors: ['span.date'], tag: 'span', label: '日付', scope: 'item' },
    },
    {
      type: 'click',
      target: { selectors: ['a.receipt'], tag: 'a', label: '領収書等', scope: 'item' },
    },
    // 行の外の要素と、ページの移動は、そのまま繰り返しの中に置きます。
    steps[3],
    steps[4],
  ]);
  assert.deepEqual(result.hints, [null, null]);
  // 変えた手順は、フロー定義の検証を通ります。
  assert.deepEqual(
    validateFlow({
      schemaVersion: SCHEMA_VERSION,
      name: '記録',
      origin: 'https://shop.example.com',
      steps: result.steps,
    }),
    [],
  );
});

test('範囲の前後の手順と、ほかの値（入力の値など）はそのまま残す', () => {
  /** @type {Step[]} */
  const withInput = [
    ...steps.slice(0, 2),
    { type: 'input', target: pageTarget('#memo-1', 'メモ'), value: 'abc', translated: true },
    { type: 'click', target: pageTarget('#logout', 'ログアウト') },
  ];
  /** @type {RowHint[]} */
  const inputHints = [
    null,
    hints[1],
    [
      {
        items: orderRow,
        count: 10,
        inner: { selectors: ['input.memo'], tag: 'input', label: 'メモ', scope: 'item' },
      },
    ],
    null,
  ];
  const result = makeLoop(withInput, inputHints, 1, 2, candidateKey(orderRow));
  assert.ok(result.ok);
  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.steps[2], withInput[3]);
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.deepEqual(loop.steps[1], {
    type: 'input',
    target: { selectors: ['input.memo'], tag: 'input', label: 'メモ', scope: 'item' },
    value: 'abc',
    translated: true,
  });
  assert.deepEqual(result.hints, [null, null, null]);
});

test('ページを開く手順（利用者の操作による移動）を含む範囲は、繰り返しにしない', () => {
  const result = makeLoop(steps, hints, 0, 2, candidateKey(orderRow));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /1 番目の手順は、一覧のページを開く手順のため/);
});

test('繰り返しの手順を含む範囲は、繰り返しにしない', () => {
  const first = makeLoop(steps, hints, 1, 2, candidateKey(orderRow));
  assert.ok(first.ok);
  const second = makeLoop(first.steps, first.hints, 1, 2, candidateKey(orderRow));
  assert.equal(second.ok, false);
  assert.match(!second.ok ? second.error : '', /繰り返しや条件の手順のため/);
});

test('範囲の誤りと、範囲にない行の候補は、繰り返しにしない', () => {
  for (const [from, to] of [
    [2, 1],
    [-1, 2],
    [1, 5],
    [1.5, 2],
  ]) {
    assert.equal(
      makeLoop(steps, hints, from, to, candidateKey(orderRow)).ok,
      false,
      `${from}-${to}`,
    );
  }
  const result = makeLoop(steps, hints, 4, 4, candidateKey(orderRow));
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.error : '', /一覧の行の中を操作した手順がありません/);
});

test('一時停止に変えた手順は、行の候補があっても行の中の手順として扱わない', () => {
  /** @type {Step[]} */
  const paused = [steps[0], { type: 'pause', note: '確定' }];
  assert.equal(defaultLoopRange(paused, [null, hints[2]]), null);
});

test('候補の数が手順より少ない記録（候補を持たない記録）も扱える', () => {
  assert.equal(defaultLoopRange(steps, []), null);
  assert.deepEqual(loopOptions(steps, [], 1, 4), []);
});

test('ページから届いた行の候補は、形を確かめて必要な項目だけを写す', () => {
  const valid = [
    {
      items: { ...orderRow, extra: 'x' },
      count: 10,
      inner: {
        selectors: ['a.receipt'],
        tag: 'a',
        label: '領収書等',
        scope: 'item',
        text: '領収書等',
      },
      other: true,
    },
  ];
  assert.deepEqual(sanitizeRowHint(valid), [
    {
      items: orderRow,
      count: 10,
      inner: {
        selectors: ['a.receipt'],
        tag: 'a',
        label: '領収書等',
        text: '領収書等',
        scope: 'item',
      },
    },
  ]);
  for (const invalid of [
    undefined,
    null,
    'x',
    [],
    [{ ...valid[0], count: 1 }],
    [{ ...valid[0], count: 2.5 }],
    [{ ...valid[0], items: { ...orderRow, scope: 'item' } }],
    [{ ...valid[0], inner: { ...valid[0].inner, scope: undefined } }],
    [{ ...valid[0], items: { selectors: [], tag: 'div', label: '' } }],
    Array.from({ length: 6 }, () => valid[0]),
  ]) {
    assert.equal(sanitizeRowHint(invalid), null, JSON.stringify(invalid));
  }
});

// ---- 範囲を選ぶ欄（チェックボックス）の処理 ----

test('ページを開く手順と、繰り返し・条件の手順は、印を付けられない理由を返す', () => {
  assert.match(String(excludedReason(steps[0])), /一覧のページを開く手順/);
  assert.equal(excludedReason(steps[1]), null);
  assert.equal(excludedReason(steps[4]), null);
  assert.match(
    String(excludedReason({ type: 'forEach', items: orderRow, steps: [] })),
    /繰り返しや条件/,
  );
});

test('印を付けると、範囲とその手順の間を含む続いた範囲になる', () => {
  assert.deepEqual(toggleRange(steps, null, 2, true), { from: 2, to: 2 });
  assert.deepEqual(toggleRange(steps, { from: 2, to: 2 }, 4, true), { from: 2, to: 4 });
  assert.deepEqual(toggleRange(steps, { from: 3, to: 4 }, 1, true), { from: 1, to: 4 });
  // 印を付けられない手順には付けません。
  assert.deepEqual(toggleRange(steps, { from: 1, to: 4 }, 0, true), { from: 1, to: 4 });
});

test('含められない手順をまたいで印を付けると、その手順だけの範囲になる', () => {
  /** @type {Step[]} */
  const split = [...steps.slice(0, 3), steps[0], ...steps.slice(3)];
  assert.deepEqual(toggleRange(split, { from: 1, to: 2 }, 4, true), { from: 4, to: 4 });
});

test('印を外すと、端なら 1 つ縮め、途中ならその手順の前までにし、最後の 1 件なら範囲をなくす', () => {
  assert.deepEqual(toggleRange(steps, { from: 1, to: 4 }, 1, false), { from: 2, to: 4 });
  assert.deepEqual(toggleRange(steps, { from: 1, to: 4 }, 4, false), { from: 1, to: 3 });
  assert.deepEqual(toggleRange(steps, { from: 1, to: 4 }, 3, false), { from: 1, to: 2 });
  assert.equal(toggleRange(steps, { from: 2, to: 2 }, 2, false), null);
  assert.deepEqual(toggleRange(steps, { from: 2, to: 3 }, 4, false), { from: 2, to: 3 });
});

test('範囲の各手順を、1 件の中・ページ全体・要素を操作しない手順に分ける', () => {
  assert.deepEqual(stepScopes(steps, hints, 1, 4, candidateKey(orderRow)), [
    'item',
    'item',
    'page',
    null,
  ]);
});

test('一覧の行の名前は CSS セレクターを含まず件数で示し、件数が同じ候補は操作した手順の数を添える', () => {
  const options = loopOptions(steps, hints, 1, 4);
  assert.equal(loopOptionLabel(options[0], options), 'このページに 10 件ある枠');
  const same = [
    { ...options[0], count: 3 },
    { ...options[1], count: 3 },
  ];
  assert.equal(loopOptionLabel(same[0], same), 'このページに 3 件ある枠（手順 2 件が中を操作）');
  for (const option of options) {
    assert.doesNotMatch(loopOptionLabel(option, options), /div|span|li\b|\./);
  }
});

test('既定の範囲は、先頭より後の含められない手順（一覧のページを開き直した手順）の前までにする', () => {
  /** @type {Step[]} */
  const reopened = [
    ...steps,
    { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
    { type: 'click', target: pageTarget('#date-2', '2026年9月2日') },
  ];
  /** @type {RowHint[]} */
  const reopenedHints = [...hints, null, hints[1]];
  const range = defaultLoopRange(reopened, reopenedHints);
  assert.deepEqual(range, { from: 1, to: 4 });
  // 既定の範囲は、そのまま繰り返しにできます。
  const result = makeLoop(reopened, reopenedHints, 1, 4, candidateKey(orderRow));
  assert.ok(result.ok);
});
