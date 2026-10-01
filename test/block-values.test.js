// ブロックの文字の欄に入れられる値の一覧（extension/shared/block-values.js、#147）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertableValues, valueFields } from '../extension/shared/block-values.js';
import { stepsToWorkspace, workspaceToSteps } from '../extension/shared/blocks.js';
import { SCHEMA_VERSION, validateFlow } from '../extension/shared/flow.js';

/** @typedef {import('../extension/shared/blocks.js').BlockState} BlockState */

const target = { selectors: ['#order-id'], tag: 'span', label: '注文番号' };
const rows = { selectors: ['tr.order'], tag: 'tr', label: '注文の行' };

/** @type {import('../extension/shared/params.js').Param[]} */
const params = [
  { name: 'month', label: '対象月', type: 'month' },
  { name: 'shop', label: '店舗', type: 'text' },
];

/**
 * 手順からブロックの配置を作り、ブロックに前から順の id（例：lm_savePdf#2）を付けます。
 * @param {import('../extension/shared/flow.js').Step[]} steps
 */
function workspace(steps) {
  const state = stepsToWorkspace(steps);
  /** @type {BlockState[]} */
  const blocks = [];
  /** @param {BlockState | undefined} block */
  const visit = (block) => {
    for (; block; block = block.next?.block) {
      block.id = `${block.type}#${blocks.length}`;
      blocks.push(block);
      for (const input of Object.values(block.inputs ?? {})) {
        visit(input.block);
      }
    }
  };
  for (const top of state.blocks?.blocks ?? []) {
    visit(top);
  }
  return { state, blocks };
}

/**
 * 一覧のうち、まとまりが group の値の文字を返します。
 * @param {import('../extension/shared/block-values.js').InsertableValue[]} values
 * @param {string} group
 */
const texts = (values, group) =>
  values.filter((value) => value.group === group).map((value) => value.text);

const steps = /** @type {import('../extension/shared/flow.js').Step[]} */ ([
  { type: 'navigate', url: 'https://www.example.com/', cause: 'user' },
  { type: 'extract', target, name: 'orderNumber' },
  {
    type: 'forEach',
    items: rows,
    steps: [
      { type: 'extract', target: { ...target, scope: 'item' }, name: 'rowNo' },
      { type: 'savePdf', path: 'Lightomate/a.pdf' },
    ],
  },
  { type: 'savePdf', path: 'Lightomate/b.pdf' },
  {
    type: 'if',
    condition: { target, exists: true },
    then: [{ type: 'extract', target, name: 'inIf' }],
  },
  { type: 'savePdf', path: 'Lightomate/c.pdf' },
  { type: 'extract', target, name: 'later' },
]);

test('保存先には、パラメータ（年月の部分を含む）、前の読み取りの名前、決まった値を出す', () => {
  const { state, blocks } = workspace(steps);
  const [inLoop, afterLoop, afterIf] = blocks.filter((block) => block.type === 'lm_savePdf');
  const values = insertableValues(state, String(inLoop.id), 'path', params);
  assert.deepEqual(texts(values, 'param'), [
    '{{month}}',
    '{{month.year}}',
    '{{month.month}}',
    '{{month.mm}}',
    '{{shop}}',
  ]);
  assert.deepEqual(texts(values, 'builtin'), [
    '{{flow.name}}',
    '{{site.host}}',
    '{{run.yyyy}}',
    '{{run.mm}}',
    '{{run.dd}}',
    '{{run.hhmmss}}',
  ]);
  // 繰り返しの内側では、外側の前の読み取りと、内側の前の読み取りを出します。
  assert.deepEqual(texts(values, 'extract'), ['{{orderNumber}}', '{{rowNo}}']);
  // 読み取りの値の説明には、読み取る要素の説明を示します。
  assert.equal(
    values.find((value) => value.text === '{{orderNumber}}')?.label,
    '「注文番号」を読み取った値',
  );
  // 繰り返しやもしの内側の読み取りは、その外側には出しません。後の読み取りも出しません。
  assert.deepEqual(
    texts(insertableValues(state, String(afterLoop.id), 'path', params), 'extract'),
    ['{{orderNumber}}'],
  );
  assert.deepEqual(texts(insertableValues(state, String(afterIf.id), 'path', params), 'extract'), [
    '{{orderNumber}}',
  ]);
});

test('保存先でない欄（URL、入力する値、条件の値）には、パラメータだけを出す', () => {
  const { state, blocks } = workspace(steps);
  const navigate = blocks.find((block) => block.type === 'lm_navigate');
  const values = insertableValues(state, String(navigate?.id), 'template', params);
  assert.ok(values.every((value) => value.group === 'param'));
  assert.equal(values.length, 5);
});

test('一覧から入れた値を含む保存先と入力する値は、保存の前の検証を通る', () => {
  const { state, blocks } = workspace(steps);
  for (const block of blocks.filter((block) => block.type === 'lm_savePdf')) {
    const inserted = insertableValues(state, String(block.id), 'path', params)
      .map((value) => value.text)
      .join('_');
    block.fields = { ...block.fields, PATH: `Lightomate/${inserted}.pdf` };
  }
  const navigate = /** @type {BlockState} */ (blocks.find((block) => block.type === 'lm_navigate'));
  const query = insertableValues(state, String(navigate?.id), 'template', params)
    .map((value) => value.text)
    .join('');
  navigate.fields = { ...navigate.fields, URL: `https://www.example.com/?q=${query}` };

  const result = workspaceToSteps(state);
  assert.equal(result.error, undefined);
  assert.deepEqual(
    validateFlow({
      schemaVersion: SCHEMA_VERSION,
      name: '値を入れる',
      origin: 'https://www.example.com',
      params,
      steps: result.steps,
    }),
    [],
  );
});

test('値を入れられる欄は、ブロックの種類と条件の種類で決まる', () => {
  assert.deepEqual(
    valueFields('lm_savePdf', {}).map((field) => [field.field, field.kind]),
    [['PATH', 'path']],
  );
  assert.deepEqual(
    valueFields('lm_click', {}).map((field) => [field.field, field.kind]),
    [['DOWNLOAD', 'path']],
  );
  assert.deepEqual(
    valueFields('lm_input', {}).map((field) => field.field),
    ['VALUE'],
  );
  assert.deepEqual(valueFields('lm_input_secret', {}), []);
  assert.deepEqual(valueFields('lm_wait', {}), []);
  // 条件は、値を使う種類のときだけ。期間では始めと終わりの 2 つです。
  assert.deepEqual(valueFields('lm_if', { COND: 'exists' }), []);
  assert.deepEqual(
    valueFields('lm_while', { COND: 'contains' }).map((field) => field.field),
    ['VALUE'],
  );
  assert.deepEqual(
    valueFields('lm_if', { COND: 'range' }).map((field) => field.label),
    ['期間の始め', '期間の終わり'],
  );
});

test('ブロックが見つからない場合は、読み取りの名前を出さない', () => {
  const { state } = workspace(steps);
  assert.deepEqual(texts(insertableValues(state, 'none', 'path', []), 'extract'), []);
});
