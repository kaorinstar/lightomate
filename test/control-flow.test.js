// 条件分岐と繰り返し（extension/shared/control-flow.js、#6）のテストです。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  advance,
  compileSteps,
  displayNumber,
  flattenSteps,
  itemScope,
  itemText,
  outlineSteps,
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
