// 記録した手順の範囲を、一覧の各行で繰り返す手順に変える処理（extension/shared/record-loop.js、#167）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  attachPager,
  candidateKey,
  dateSteps,
  defaultLoopRange,
  excludedReason,
  loopOptionLabel,
  loopOptions,
  makeLoop,
  monthParam,
  nameableSteps,
  pagerLoops,
  pagerSpan,
  pagerSteps,
  sanitizePagerHint,
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
  // 記録から作る繰り返しは、行の中の要素が見つからない行を飛ばします（#174）。
  assert.equal(loop.onMissing, 'skip');
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

// ---- ファイル名に使う文字（#179） ----

const spanTarget = (/** @type {string} */ selector, /** @type {string} */ label) => ({
  selectors: [selector],
  tag: 'span',
  label,
});

/** @type {Step[]} */
const namedSteps = [
  { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
  { type: 'click', target: spanTarget('#date-1', '2026年9月11日'), translated: true },
  { type: 'click', target: spanTarget('#number-1', '503-1') },
  { type: 'click', target: pageTarget('#menu-1', '領収書等') },
  {
    type: 'click',
    target: pageTarget('#invoice-1', '明細書'),
    download: { path: 'Lightomate/{{flow.name}}/x', onConflict: 'rename', from: 'link' },
  },
  { type: 'click', target: spanTarget('#after-1', '後') },
];
/** @type {RowHint[]} */
const namedHints = [
  null,
  ...['span.date', 'span.number', 'a.menu', 'a.invoice', 'span.after'].map((selector) => [
    {
      items: orderRow,
      count: 3,
      inner: {
        selectors: [selector],
        tag: 'span',
        label: selector,
        scope: /** @type {const} */ ('item'),
      },
    },
  ]),
];

test('ファイル名に使えるのは、範囲の最初の保存の手順より前の、文字（リンクやボタン以外）のクリックだけ', () => {
  assert.deepEqual(nameableSteps(namedSteps, 1, 5), [1, 2]);
  // 保存の手順がない範囲では、ファイル名に使う手順はありません。
  assert.deepEqual(nameableSteps(namedSteps, 1, 3), []);
});

test('選んだ文字のクリックを読み取りに変え、保存の手順の保存先を、その値を選んだ順に並べた名前にする', () => {
  const result = makeLoop(namedSteps, namedHints, 1, 5, candidateKey(orderRow), [2, 1]);
  assert.ok(result.ok);
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.deepEqual(loop.steps[0], {
    type: 'extract',
    target: { selectors: ['span.date'], tag: 'span', label: 'span.date', scope: 'item' },
    name: 'fileName2',
    translated: true,
  });
  assert.equal(loop.steps[1].type === 'extract' && loop.steps[1].name, 'fileName1');
  assert.deepEqual(loop.steps[3].type === 'click' && loop.steps[3].download, {
    path: 'Lightomate/{{flow.name}}/{{fileName1}}_{{fileName2}}',
    onConflict: 'overwrite',
    from: 'link',
  });
  // 保存の手順の後のクリックは、そのままです。
  assert.equal(loop.steps[4].type, 'click');
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

test('サイト名を入れる場合は、ファイル名の先頭に {{site.host}} を置く', () => {
  const result = makeLoop(namedSteps, namedHints, 1, 5, candidateKey(orderRow), [2], true);
  assert.ok(result.ok);
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  const save = loop.steps[3];
  assert.equal(
    save.type === 'click' && save.download?.path,
    'Lightomate/{{flow.name}}/{{site.host}}_{{fileName1}}',
  );
});

test('ファイル名に使えない手順を選んだ場合と、同じ手順を 2 回選んだ場合は、変換しない', () => {
  for (const names of [[3], [5], [1, 1], ['1']]) {
    const result = makeLoop(namedSteps, namedHints, 1, 5, candidateKey(orderRow), names);
    assert.equal(result.ok, false, JSON.stringify(names));
  }
});

test('ファイル名を選ばない場合は、保存の手順の保存先を変えない', () => {
  const result = makeLoop(namedSteps, namedHints, 1, 5, candidateKey(orderRow));
  assert.ok(result.ok);
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.deepEqual(loop.steps[3], { ...namedSteps[4], target: namedHints[4]?.[0].inner });
});

/** ページ送りの部品の li も、同じ形の行の候補になります（#182）。 */
const pagerRow = { selectors: ['ul.a-pagination > li'], tag: 'li', label: '一覧の行（li）' };

/** @type {Step[]} */
const pagedSteps = [
  { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
  { type: 'click', target: pageTarget('#receipt-1', '領収書等') },
  { type: 'click', target: pageTarget('#invoice-1', '明細書') },
  { type: 'click', target: pageTarget('html > body > ul > li:nth-of-type(4) > a', '次へ') },
  { type: 'navigate', url: 'https://shop.example.com/orders?p=2', cause: 'page' },
];
/** @type {RowHint[]} */
const pagedHints = [
  null,
  ...['a.receipt', 'a.invoice'].map((selector) => [
    {
      items: orderRow,
      count: 10,
      inner: {
        selectors: [selector],
        tag: 'a',
        label: selector,
        scope: /** @type {const} */ ('item'),
      },
    },
  ]),
  [
    {
      items: pagerRow,
      count: 4,
      inner: { selectors: ['a'], tag: 'a', label: '次へ', scope: /** @type {const} */ ('item') },
    },
  ],
  null,
];
const pagedPagers = [null, null, null, ['li.a-last > a'], null];
const nextPage = { selectors: ['li.a-last > a'], tag: 'a', label: '次へ' };

test('次のページへ送るクリックに選べるのは、1 件目の操作の後に押した、行の外のリンクかボタンだけ（#182）', () => {
  const key = candidateKey(orderRow);
  assert.deepEqual(pagerSteps(pagedSteps, pagedHints, pagedPagers, 1, key), [3]);
  // 範囲の先頭のクリックは選べません。1 件目の操作の前に押したクリックです。
  assert.deepEqual(pagerSteps(pagedSteps, pagedHints, pagedPagers, 3, key), []);
  // ページ送りに使う指定を作れなかったクリックは選べません。
  assert.deepEqual(pagerSteps(pagedSteps, pagedHints, [null, null, null, null, null], 1, key), []);
  // 選んだ行の中のクリックは選べません。
  assert.deepEqual(
    pagerSteps(pagedSteps, pagedHints, [null, null, ['a.invoice'], null, null], 1, key),
    [],
  );
  // ページ送りの部品の li を行に選んだ場合は、「次へ」もその行の中のクリックのため選べません。
  assert.deepEqual(pagerSteps(pagedSteps, pagedHints, pagedPagers, 1, candidateKey(pagerRow)), []);
});

test('次のページへ送るクリックを選ぶと、その要素を nextPage にし、そのクリックと直後の移動を手順から除く（#182）', () => {
  for (const to of [4, 3, 2]) {
    const result = makeLoop(pagedSteps, pagedHints, 1, to, candidateKey(orderRow), [], false, {
      index: 3,
      pagers: pagedPagers,
    });
    assert.ok(result.ok, String(to));
    assert.equal(result.steps.length, 2);
    const loop = result.steps[1];
    assert.ok(loop.type === 'forEach');
    // 何番目の li かをたどる記録の指定と、表示の文字は使いません。
    assert.deepEqual(loop.nextPage, nextPage);
    assert.deepEqual(
      loop.steps.map((step) => step.type === 'click' && step.target.selectors[0]),
      ['a.receipt', 'a.invoice'],
    );
    assert.deepEqual(result.hints, [null, null]);
    assert.deepEqual(result.pagers, [null, null]);
    assert.deepEqual(
      validateFlow({
        schemaVersion: SCHEMA_VERSION,
        name: '記録',
        origin: 'https://shop.example.com',
        steps: result.steps,
      }),
      [],
    );
  }
});

test('次のページへ送れない手順を選んだ場合は変換せず、選ばない場合は「次へ」も繰り返しの中に置く（#182）', () => {
  const key = candidateKey(orderRow);
  for (const index of [1, 2, 4, '3']) {
    const result = makeLoop(pagedSteps, pagedHints, 1, 4, key, [], false, {
      index,
      pagers: pagedPagers,
    });
    assert.equal(result.ok, false, String(index));
  }
  const plain = makeLoop(pagedSteps, pagedHints, 1, 4, key);
  assert.ok(plain.ok);
  const loop = plain.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.equal(loop.nextPage, undefined);
  assert.equal(loop.steps.length, 4);
});

test('ページから届いたページ送りの指定は、文字列の配列だけを受け付ける（#182）', () => {
  assert.deepEqual(sanitizePagerHint(['li.a-last > a']), ['li.a-last > a']);
  for (const value of [undefined, [], [''], [1], 'li.a-last > a', Array(11).fill('a')]) {
    assert.equal(sanitizePagerHint(value), null, JSON.stringify(value));
  }
});

test('PDF を開いた後に［戻る］で一覧へ戻ってから押した「次へ」も選べ、戻る移動も除く（#182）', () => {
  /** @type {Step[]} */
  const withBack = [
    ...pagedSteps.slice(0, 3),
    { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
    ...pagedSteps.slice(3),
  ];
  const backHints = [...pagedHints.slice(0, 3), null, ...pagedHints.slice(3)];
  const backPagers = [null, null, null, null, ['li.a-last > a'], null];
  const key = candidateKey(orderRow);
  // ［戻る］は範囲に含められないため、既定の範囲はその前までです。
  assert.deepEqual(defaultLoopRange(withBack, backHints), { from: 1, to: 2 });
  assert.deepEqual(pagerSteps(withBack, backHints, backPagers, 1, key), [4]);
  const result = makeLoop(withBack, backHints, 1, 2, key, [], false, {
    index: 4,
    pagers: backPagers,
  });
  assert.ok(result.ok);
  assert.equal(result.steps.length, 2);
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.deepEqual(loop.nextPage, nextPage);
});

test('1 件目の操作と「次へ」の間でほかの場所を押していても選べ、間の手順を除き、その後の手順は残す（#182）', () => {
  /** @type {Step[]} */
  const withOthers = [
    ...pagedSteps.slice(0, 3),
    { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
    // ほかの拡張機能がページに加えたアイコンなど、ページ送りと関係のないクリックです。
    { type: 'click', target: { selectors: ['#other-icon'], tag: 'span', label: 'enable' } },
    ...pagedSteps.slice(3),
    { type: 'savePdf', path: 'Lightomate/{{flow.name}}/後' },
  ];
  const otherHints = [...pagedHints.slice(0, 3), null, null, ...pagedHints.slice(3), null];
  const otherPagers = [null, null, null, null, null, ['li.a-last > a'], null, null];
  const key = candidateKey(orderRow);
  assert.deepEqual(pagerSteps(withOthers, otherHints, otherPagers, 1, key), [5]);
  assert.deepEqual(pagerSpan(withOthers, 2, 5), { innerEnd: 2, removeEnd: 6 });
  const result = makeLoop(withOthers, otherHints, 1, 2, key, [], false, {
    index: 5,
    pagers: otherPagers,
  });
  assert.ok(result.ok);
  assert.deepEqual(
    result.steps.map((step) => step.type),
    ['navigate', 'forEach', 'savePdf'],
  );
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.deepEqual(loop.nextPage, nextPage);
  assert.equal(loop.steps.length, 2);
  assert.deepEqual(result.pagers, [null, null, null]);
});

/** 注文日の文字を押してから明細書を保存した記録です（#183）。 */
/** @type {Step[]} */
const datedSteps = namedSteps.map((step, index) =>
  index === 1 && step.type === 'click'
    ? { ...step, target: { ...step.target, text: '2026年9月11日' } }
    : index === 2 && step.type === 'click'
      ? { ...step, target: { ...step.target, text: '503-1' } }
      : step,
);

test('対象の月の条件に使えるのは、行の中の文字のクリックで、記録した文字が日付として読めるものだけ（#183）', () => {
  const key = candidateKey(orderRow);
  assert.deepEqual(dateSteps(datedSteps, namedHints, 1, 5, key), [1]);
  // 記録した文字がない手順は使えません。
  assert.deepEqual(dateSteps(namedSteps, namedHints, 1, 5, key), []);
  // 選んだ行の外の文字は使えません。
  assert.deepEqual(dateSteps(datedSteps, namedHints, 1, 5, candidateKey(headCell)), []);
});

test('日付の手順を選ぶと、行の手順を対象の月の条件で囲み、古い行で終える条件と年月のパラメータを加える（#183）', () => {
  const key = candidateKey(orderRow);
  const result = makeLoop(
    datedSteps,
    namedHints,
    1,
    5,
    key,
    [2],
    false,
    {},
    {
      index: 1,
      stopAtOlder: true,
    },
  );
  assert.ok(result.ok);
  assert.deepEqual(result.param, {
    name: 'month',
    label: '対象月',
    type: 'month',
    default: '@previous-month',
  });
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  const date = { selectors: ['span.date'], tag: 'span', label: 'span.date', scope: 'item' };
  assert.deepEqual(loop.steps[0], {
    type: 'if',
    condition: { target: date, before: '{{month}}' },
    then: [{ type: 'break' }],
  });
  const filtered = loop.steps[1];
  assert.ok(filtered.type === 'if');
  assert.deepEqual(filtered.condition, { target: date, month: '{{month}}' });
  // 日付のクリックは除き、残りの手順（注文番号の読み取り、［領収書等］、保存、その後のクリック）を条件の中に置きます。
  assert.deepEqual(
    filtered.then.map((step) => step.type),
    ['extract', 'click', 'click', 'click'],
  );
  assert.deepEqual(
    validateFlow({
      schemaVersion: SCHEMA_VERSION,
      name: '記録',
      origin: 'https://shop.example.com',
      params: result.param ? [result.param] : [],
      steps: result.steps,
    }),
    [],
  );
});

test('日付をファイル名にも使う場合は、読み取りを条件より前に残す。古い行で終えない場合は終える条件を置かない（#183）', () => {
  const result = makeLoop(
    datedSteps,
    namedHints,
    1,
    5,
    candidateKey(orderRow),
    [1, 2],
    false,
    {},
    {
      index: 1,
      stopAtOlder: false,
    },
  );
  assert.ok(result.ok);
  const loop = result.steps[1];
  assert.ok(loop.type === 'forEach');
  assert.deepEqual(
    loop.steps.map((step) => step.type),
    ['extract', 'if'],
  );
  assert.equal(loop.steps[0].type === 'extract' && loop.steps[0].name, 'fileName1');
});

test('日付として使えない手順を選んだ場合は変換しない（#183）', () => {
  for (const index of [2, 3, '1']) {
    const result = makeLoop(
      datedSteps,
      namedHints,
      1,
      5,
      candidateKey(orderRow),
      [],
      false,
      {},
      {
        index,
      },
    );
    assert.equal(result.ok, false, String(index));
  }
});

test('年月の month がある場合はそれを使い、別の種類の month がある場合は month2 を加える（#183）', () => {
  assert.deepEqual(monthParam([{ name: 'month', label: '月', type: 'month' }]), { name: 'month' });
  assert.equal(monthParam([{ name: 'month', label: '月', type: 'text' }]).name, 'month2');
  assert.equal(monthParam([]).add?.name, 'month');
});

// 繰り返しを作った後に、一覧へ戻って「次へ」を押した記録です（#237）。
/** @type {Step[]} */
const afterLoopSteps = [
  { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
  {
    type: 'forEach',
    items: orderRow,
    onMissing: 'skip',
    steps: [
      {
        type: 'click',
        target: { selectors: ['a.detail'], tag: 'a', label: '注文詳細', scope: 'item' },
      },
    ],
  },
  { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
  {
    type: 'click',
    target: {
      selectors: ['button[aria-label="next"]'],
      tag: 'button',
      label: 'next',
      text: '次へ',
    },
  },
  { type: 'navigate', url: 'https://shop.example.com/orders?p=2', cause: 'page' },
];
/** @type {import('../extension/shared/record-loop.js').PagerHint[]} */
const afterLoopPagers = [null, null, null, ['button.nav-next'], null];
const afterLoopHints = afterLoopSteps.map(() => null);

test('繰り返しの後に一覧へ戻る移動だけを挟んだ「次へ」は、その繰り返しのページ送りにできる（#237）', () => {
  assert.deepEqual(pagerLoops(afterLoopSteps, afterLoopHints, afterLoopPagers), [
    null,
    null,
    null,
    1,
    null,
  ]);
  const result = attachPager(afterLoopSteps, afterLoopHints, afterLoopPagers, 3);
  assert.ok(result.ok);
  assert.equal(result.loop, 1);
  assert.deepEqual(
    result.steps.map((step) => step.type),
    ['navigate', 'forEach'],
  );
  const loop = /** @type {any} */ (result.steps[1]);
  assert.deepEqual(loop.nextPage, { selectors: ['button.nav-next'], tag: 'button', label: 'next' });
  assert.equal(result.hints.length, 2);
  assert.equal(result.pagers.length, 2);
  const flow = {
    schemaVersion: SCHEMA_VERSION,
    name: 'x',
    origin: 'https://shop.example.com',
    steps: result.steps,
  };
  assert.deepEqual(validateFlow(flow), []);
});

test('ページ送りにできないクリック：指定を作れない、間にほかの操作がある、すでにページ送りがある、行の中（#237）', () => {
  assert.deepEqual(pagerLoops(afterLoopSteps, afterLoopHints, [null, null, null, null, null]), [
    null,
    null,
    null,
    null,
    null,
  ]);
  /** @type {Step[]} */
  const withOther = [
    ...afterLoopSteps.slice(0, 2),
    { type: 'click', target: { selectors: ['#other'], tag: 'button', label: 'ほか' } },
    ...afterLoopSteps.slice(3),
  ];
  assert.equal(pagerLoops(withOther, afterLoopHints, afterLoopPagers)[3], null);
  const paged = afterLoopSteps.map((step) =>
    step.type === 'forEach'
      ? { ...step, nextPage: { selectors: ['a.next'], tag: 'a', label: '次へ' } }
      : step,
  );
  assert.equal(pagerLoops(paged, afterLoopHints, afterLoopPagers)[3], null);
  /** @type {RowHint[]} */
  const inRow = [
    null,
    null,
    null,
    [
      {
        items: orderRow,
        count: 3,
        inner: { selectors: ['button'], tag: 'button', label: 'next', scope: 'item' },
      },
    ],
    null,
  ];
  assert.equal(pagerLoops(afterLoopSteps, inRow, afterLoopPagers)[3], null);
  const failed = attachPager(afterLoopSteps, afterLoopHints, afterLoopPagers, 2);
  assert.equal(failed.ok, false);
});
