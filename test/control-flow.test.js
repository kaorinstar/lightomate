// 条件分岐と繰り返し（extension/shared/control-flow.js、#6）のテストです。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  advance,
  afterRow,
  compileSteps,
  displayNumber,
  flattenSteps,
  itemScope,
  itemText,
  needsReturn,
  outlineSteps,
  pageLimitError,
  returnedListError,
  rowLimitError,
  stepAt,
} from '../extension/shared/control-flow.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */
/** @typedef {import('../extension/shared/control-flow.js').LoopFrame} LoopFrame */

/**
 * 名前を付けた手順です。実行した順を、名前の一覧で確かめます。
 * @param {string} name
 * @returns {Step}
 */
const wait = (name) => /** @type {Step} */ ({ type: 'wait', ms: 1, name });

/**
 * @param {string} label
 * @param {boolean} [exists]
 * @param {Step[]} [then]
 * @param {Step[]} [otherwise]
 * @returns {Step}
 */
const ifStep = (label, exists = true, then = [], otherwise) => ({
  type: 'if',
  condition: { target: { selectors: [`#${label}`], tag: 'div', label }, exists },
  then,
  ...(otherwise ? { else: otherwise } : {}),
});

/**
 * @param {string} label
 * @param {Step[]} steps
 * @returns {Step}
 */
const forEach = (label, steps) => ({
  type: 'forEach',
  items: { selectors: [`.${label}`], tag: 'tr', label },
  steps,
});

/**
 * 命令の一覧を最後まで実行し、行った手順の名前を返します。
 * @param {Step[]} steps
 * @param {{ conditions?: Record<string, boolean>, counts?: Record<string, number> }} page
 *   条件の要素があるか（label ごと）と、一覧の行数（label ごと）
 * @returns {string[]}
 */
function simulate(steps, { conditions = {}, counts = {} }) {
  const program = compileSteps(steps);
  /** @type {string[]} */
  const done = [];
  let position = { pc: 0, frames: /** @type {LoopFrame[]} */ ([]) };
  for (let guard = 0; position.pc < program.length; guard += 1) {
    assert.ok(guard < 1000, '命令の実行が終わりません。');
    const instruction = program[position.pc];
    /** @type {boolean | number | undefined} */
    let result;
    if (instruction.op === 'if') {
      const { target, exists } = instruction.step.condition;
      result = (conditions[target.label] ?? false) === exists;
    } else if (instruction.op === 'forEach') {
      result = counts[instruction.step.items.label] ?? 0;
    } else if (instruction.op === 'step') {
      const item = position.frames.map((frame) => frame.index + 1).join('-');
      const name = /** @type {{ name?: string }} */ (instruction.step).name ?? '';
      done.push(item ? `${name}@${item}` : name);
    }
    position = advance(program, position.pc, position.frames, result);
  }
  return done;
}

test('if は、条件を満たす場合は then を、満たさない場合は else を行う', () => {
  const steps = [
    wait('前'),
    ifStep('ログイン', true, [wait('入力')], [wait('飛ばす')]),
    wait('後'),
  ];
  assert.deepEqual(simulate(steps, { conditions: { ログイン: true } }), ['前', '入力', '後']);
  assert.deepEqual(simulate(steps, { conditions: { ログイン: false } }), ['前', '飛ばす', '後']);
});

test('if の else は省略でき、条件を満たさない場合は次の手順へ進む', () => {
  const steps = [ifStep('ログイン', true, [wait('入力')]), wait('後')];
  assert.deepEqual(simulate(steps, { conditions: { ログイン: false } }), ['後']);
  assert.deepEqual(simulate(steps, { conditions: { ログイン: true } }), ['入力', '後']);
});

test('exists が false の if は、要素がない場合に then を行う', () => {
  const steps = [ifStep('案内', false, [wait('閉じない')], [wait('閉じる')])];
  assert.deepEqual(simulate(steps, { conditions: { 案内: false } }), ['閉じない']);
  assert.deepEqual(simulate(steps, { conditions: { 案内: true } }), ['閉じる']);
});

test('forEach は、各行で内側の手順を行い、全件の後に次の手順へ進む', () => {
  const steps = [forEach('注文', [wait('読む'), wait('保存')]), wait('後')];
  assert.deepEqual(simulate(steps, { counts: { 注文: 3 } }), [
    '読む@1',
    '保存@1',
    '読む@2',
    '保存@2',
    '読む@3',
    '保存@3',
    '後',
  ]);
});

test('forEach は、行が 0 件の場合は内側の手順を行わずに次の手順へ進む', () => {
  const steps = [forEach('注文', [wait('読む')]), wait('後')];
  assert.deepEqual(simulate(steps, { counts: { 注文: 0 } }), ['後']);
});

test('forEach の中の if と、入れ子の forEach を行う', () => {
  const steps = [
    forEach('注文', [
      ifStep('領収書', true, [wait('保存')], [wait('なし')]),
      forEach('商品', [wait('商品')]),
    ]),
  ];
  assert.deepEqual(
    simulate(steps, { conditions: { 領収書: true }, counts: { 注文: 2, 商品: 2 } }),
    ['保存@1', '商品@1-1', '商品@1-2', '保存@2', '商品@2-1', '商品@2-2'],
  );
});

test('手順の通し番号は、親の手順、then、else、内側の順に数える', () => {
  const steps = [
    wait('a'),
    ifStep('条件', true, [wait('b')], [wait('c')]),
    forEach('行', [wait('d')]),
    wait('e'),
  ];
  const flat = flattenSteps(steps);
  assert.deepEqual(
    flat.map(({ number, depth }) => [number, depth]),
    [
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 0],
      [5, 1],
      [6, 0],
    ],
  );
  assert.equal(/** @type {{ name?: string }} */ (stepAt(steps, 3))?.name, 'c');
  assert.equal(stepAt(steps, 7), undefined);
});

test('入れ子のないフローでは、通し番号は手順の添字と同じ', () => {
  const steps = [wait('a'), wait('b'), wait('c')];
  assert.deepEqual(
    flattenSteps(steps).map(({ number }) => number),
    [0, 1, 2],
  );
});

test('画面の行の一覧では、else の手前に区切りの行を置く', () => {
  const steps = [ifStep('条件', true, [wait('b')], [wait('c')])];
  assert.deepEqual(
    outlineSteps(steps).map((row) => (row.kind === 'else' ? 'else' : row.number)),
    [0, 1, 'else', 2],
  );
});

test('表示する手順の番号は、飛ぶ命令の先の手順の番号にする', () => {
  const steps = [
    ifStep('条件', true, [wait('b')], [wait('c')]),
    forEach('行', [wait('d')]),
    wait('e'),
  ];
  const program = compileSteps(steps);
  const total = flattenSteps(steps).length;
  // then の最後の jump は、else を飛び越えた先の forEach（番号 3）を指します。
  const jump = program.findIndex((instruction) => instruction.op === 'jump');
  assert.equal(displayNumber(program, jump, [], total), 3);
  // next は、次の行がある場合は内側の最初の手順（番号 4）、ない場合は繰り返しの後（番号 5）です。
  const next = program.findIndex((instruction) => instruction.op === 'next');
  const start = program.findIndex((instruction) => instruction.op === 'forEach');
  assert.equal(displayNumber(program, next, [{ startPc: start, index: 0, count: 2 }], total), 4);
  assert.equal(displayNumber(program, next, [{ startPc: start, index: 1, count: 2 }], total), 5);
  assert.equal(displayNumber(program, program.length, [], total), total);
});

test('一時停止から再開すると、保存した命令の番号と件数から続きの行を行う', () => {
  const steps = [forEach('注文', [wait('読む'), wait('保存')]), wait('後')];
  const program = compileSteps(steps);
  // 2 件目の「保存」の後で止まった位置です。
  const saving = program.findIndex(
    (instruction) =>
      instruction.op === 'step' &&
      /** @type {{ name?: string }} */ (instruction.step).name === '保存',
  );
  /** @type {LoopFrame[]} */
  const frames = [{ startPc: 0, index: 1, count: 3 }];
  let position = advance(program, saving, frames);
  position = advance(program, position.pc, position.frames);
  assert.equal(position.pc, 1);
  assert.deepEqual(position.frames, [{ startPc: 0, index: 2, count: 3 }]);
  assert.deepEqual(frames, [{ startPc: 0, index: 1, count: 3 }], '元の記録は変えない');
});

test('行を探す範囲は、外側の繰り返しから順に、行の指定と何件目かを並べる', () => {
  const steps = [forEach('注文', [forEach('商品', [wait('a')])])];
  const program = compileSteps(steps);
  const scope = itemScope(program, [
    { startPc: 0, index: 1, count: 2 },
    { startPc: 1, index: 0, count: 3 },
  ]);
  assert.deepEqual(
    scope.map(({ items, index }) => [items.label, index]),
    [
      ['注文', 1],
      ['商品', 0],
    ],
  );
});

test('何件目かの表示', () => {
  assert.equal(itemText(undefined), '');
  assert.equal(itemText([]), '');
  assert.equal(itemText([3]), '3 件目');
  assert.equal(itemText([2, 3]), '2 件目の 3 件目');
});

test('ページ送りでは、何ページ目かを先頭に添える（#95）', () => {
  assert.equal(itemText([3], 2), '2 ページ目の 3 件目');
  assert.equal(itemText([1, 4], 1), '1 ページ目の 1 件目の 4 件目');
  assert.equal(itemText(undefined, 2), '');
});

// ページ送り（#95）の実行位置の計算です。
const nextPage = { selectors: ['a.next'], tag: 'a', label: '次へ' };

/**
 * @param {Step[]} steps
 * @param {{ max?: number, maxPages?: number }} [limits]
 * @returns {import('../extension/shared/flow.js').ForEachStep}
 */
const paged = (steps, limits = {}) => ({
  type: 'forEach',
  items: { selectors: ['.注文'], tag: 'tr', label: '注文' },
  nextPage,
  ...limits,
  steps,
});

/**
 * ページ送りを含めて命令の一覧を最後まで実行し、行った手順の名前（「名前@ページ-件」）を返します。
 * 止まった場合は、最後に「停止：理由」を加えます。
 * @param {Step[]} steps
 * @param {number[]} pages ページごとの行数。最後のページの後は「次へ」がありません
 * @returns {string[]}
 */
function simulatePages(steps, pages) {
  const program = compileSteps(steps);
  /** @type {string[]} */
  const done = [];
  let position = { pc: 0, frames: /** @type {LoopFrame[]} */ ([]) };
  for (let guard = 0; position.pc < program.length; guard += 1) {
    assert.ok(guard < 1000, '命令の実行が終わりません。');
    const instruction = program[position.pc];
    /** @type {boolean | number | undefined} */
    let result;
    if (instruction.op === 'forEach') {
      result = pages[0] ?? 0;
    } else if (instruction.op === 'next') {
      const frame = /** @type {LoopFrame} */ (position.frames.at(-1));
      const loop = program[instruction.startPc];
      assert.ok(loop.op === 'forEach');
      if (afterRow(loop.step, frame) === 'page') {
        const nextCount = pages[(frame.page ?? 0) + 1];
        if (nextCount !== undefined) {
          const error =
            pageLimitError(loop.step, frame) ?? rowLimitError(loop.step, frame, nextCount);
          if (error) {
            done.push(`停止：${error}`);
            return done;
          }
        }
        result = nextCount ?? 0;
      }
    } else if (instruction.op === 'step') {
      const frame = position.frames[0];
      const name = /** @type {{ name?: string }} */ (instruction.step).name ?? '';
      done.push(frame ? `${name}@${(frame.page ?? 0) + 1}-${frame.index + 1}` : name);
    }
    position = advance(program, position.pc, position.frames, result);
  }
  return done;
}

test('ページの最後の行の後は、次のページの 1 行目へ進み、最後のページの後に次の手順へ進む（#95）', () => {
  const steps = [paged([wait('保存')]), wait('後')];
  assert.deepEqual(simulatePages(steps, [2, 1, 2]), [
    '保存@1-1',
    '保存@1-2',
    '保存@2-1',
    '保存@3-1',
    '保存@3-2',
    '後',
  ]);
});

test('次のページの行が 0 件の場合は、繰り返しを終える（#95）', () => {
  const steps = [paged([wait('保存')]), wait('後')];
  assert.deepEqual(simulatePages(steps, [1, 0, 3]), ['保存@1-1', '後']);
});

test('nextPage がない forEach は、ページを送らずに繰り返しを終える（#95）', () => {
  const step = forEach('注文', [wait('保存')]);
  assert.ok(step.type === 'forEach');
  assert.equal(afterRow(step, { startPc: 0, index: 0, count: 1 }), 'end');
  assert.equal(afterRow(step, { startPc: 0, index: 0, count: 2 }), 'row');
  assert.equal(afterRow(paged([]), { startPc: 0, index: 1, count: 2 }), 'page');
});

test('ページ送りの上限（maxPages）に達して次のページがある場合は、止める（#95）', () => {
  const steps = [paged([wait('保存')], { maxPages: 2 }), wait('後')];
  const done = simulatePages(steps, [1, 1, 1]);
  assert.deepEqual(done.slice(0, 2), ['保存@1-1', '保存@2-1']);
  assert.match(done[2], /^停止：.*上限（2 ページ）/);
  // 上限のページが最後のページであれば、止まりません。
  assert.deepEqual(simulatePages(steps, [1, 1]), ['保存@1-1', '保存@2-1', '後']);
  // 省略した場合の上限は 10 ページです。
  const many = simulatePages([paged([wait('保存')])], Array(11).fill(1));
  assert.match(/** @type {string} */ (many.at(-1)), /上限（10 ページ）/);
});

test('max は、全ページの行の合計の上限とする（#95）', () => {
  const steps = [paged([wait('保存')], { max: 4 })];
  assert.deepEqual(simulatePages(steps, [2, 2]).length, 4);
  const done = simulatePages(steps, [2, 2, 1]);
  assert.equal(done.length, 5);
  assert.match(done[4], /^停止：.*3 ページ目までで 5 件.*上限（4 件）/);
});

test('ページを送った後の記録は、ページの番号と、前のページまでに処理した行の数を持つ（#95）', () => {
  const program = compileSteps([paged([wait('保存')])]);
  const frames = [{ startPc: 0, index: 2, count: 3, page: 1, done: 5 }];
  const moved = advance(program, 2, frames, 4);
  assert.equal(moved.pc, 1);
  assert.deepEqual(moved.frames, [{ startPc: 0, index: 0, count: 4, page: 2, done: 8 }]);
});

test('行の処理の途中でページが移動した場合だけ、一覧のページへ戻る（#95）', () => {
  assert.equal(needsReturn('list', 'list'), false);
  assert.equal(needsReturn('list', 'detail'), true);
  // ページの識別子が分からない場合は、戻りません。
  assert.equal(needsReturn(undefined, 'detail'), false);
  assert.equal(needsReturn('list', undefined), false);
});

test('一覧のページへ戻った後の行数か 1 行目が、最初と異なる場合は止める（#95）', () => {
  const list = { count: 3, firstText: '注文 1' };
  assert.equal(returnedListError('注文', list, { count: 3, firstText: '注文 1' }), undefined);
  assert.match(
    /** @type {string} */ (returnedListError('注文', list, { count: 2, firstText: '注文 1' })),
    /「注文」の行が 2 件になり、最初に数えた 3 件と異なる/,
  );
  // URL を開き直すと 1 ページ目に戻るページ送りでは、行数が同じでも 1 行目が異なります。
  assert.match(
    /** @type {string} */ (returnedListError('注文', list, { count: 3, firstText: '注文 11' })),
    /「注文」の 1 行目が最初と異なる/,
  );
  // 1 行目の文字が分からない場合は、行数だけで確かめます。
  assert.equal(
    returnedListError('注文', { count: 3 }, { count: 3, firstText: '注文 11' }),
    undefined,
  );
});
