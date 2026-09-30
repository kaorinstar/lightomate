// パラメータの定義の編集（#9）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeParamSaveErrors,
  paramRowErrors,
  paramsFromRows,
  renameParamReferences,
  rowsFromParams,
} from '../extension/shared/param-edit.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */

test('パラメータの定義を画面の行にし、戻すと元の定義と一致する', () => {
  /** @type {import('../extension/shared/params.js').Param[]} */
  const params = [
    { name: 'keyword', label: '検索語', type: 'text' },
    { name: 'size', label: 'サイズ', type: 'select', options: ['S', 'M', 'L'], default: 'M' },
    { name: 'target', label: '対象月', type: 'month', default: '@previous-month' },
  ];
  assert.deepEqual(paramsFromRows(rowsFromParams(params)), { params, renames: [] });
});

test('選択肢は「、」と「,」で区切り、前後の空白と空の項目を除く。選択肢以外の種類では持たない', () => {
  const { params } = paramsFromRows([
    {
      originalName: '',
      name: ' a ',
      label: ' A ',
      type: 'select',
      options: 'S, M、 L,,',
      default: '',
    },
    { originalName: '', name: 'b', label: 'B', type: 'text', options: 'S', default: ' x ' },
  ]);
  assert.deepEqual(params, [
    { name: 'a', label: 'A', type: 'select', options: ['S', 'M', 'L'] },
    { name: 'b', label: 'B', type: 'text', default: 'x' },
  ]);
});

test('名前を変えた行は、変更前と変更後の名前の組を返す。新しく足した行は含めない', () => {
  const { renames } = paramsFromRows([
    {
      originalName: 'month',
      name: 'target',
      label: '対象月',
      type: 'month',
      options: '',
      default: '',
    },
    {
      originalName: 'keep',
      name: 'keep',
      label: 'そのまま',
      type: 'text',
      options: '',
      default: '',
    },
    { originalName: '', name: 'added', label: '追加', type: 'text', options: '', default: '' },
  ]);
  assert.deepEqual(renames, [{ from: 'month', to: 'target' }]);
});

test('パラメータの名前を変えると、手順の中の参照も同じ名前に変わる（部分の参照と入れ子を含む）', () => {
  /** @type {Step[]} */
  const steps = [
    { type: 'navigate', cause: 'user', url: 'https://example.com/?m={{month}}' },
    {
      type: 'input',
      target: { selectors: ['#q'], tag: 'input', label: '検索' },
      value: '{{ month }}',
    },
    {
      type: 'forEach',
      items: { selectors: ['tr'], tag: 'tr', label: '行' },
      steps: [
        {
          type: 'if',
          condition: {
            target: { selectors: ['.d'], tag: 'span', label: '日付' },
            month: '{{month}}',
          },
          then: [{ type: 'savePdf', path: '領収書/{{month.year}}/{{month.mm}}/{{monthly}}.pdf' }],
        },
      ],
    },
  ];
  const renamed = renameParamReferences(steps, 'month', 'target');
  assert.equal(/** @type {any} */ (renamed[0]).url, 'https://example.com/?m={{target}}');
  assert.equal(/** @type {any} */ (renamed[1]).value, '{{ target }}');
  const inner = /** @type {any} */ (renamed[2]).steps[0];
  assert.equal(inner.condition.month, '{{target}}');
  // 別の名前（monthly）の参照は変えません。
  assert.equal(inner.then[0].path, '領収書/{{target.year}}/{{target.mm}}/{{monthly}}.pdf');
  // 元の手順は変更しません。
  assert.equal(/** @type {any} */ (steps[0]).url, 'https://example.com/?m={{month}}');
});

test('入力の誤りは、何番目の値のどの欄かと、欄の直下に出す文で返す', () => {
  /** @param {Partial<import('../extension/shared/param-edit.js').ParamRow>} row */
  const row = (row) => ({
    originalName: '',
    name: 'a',
    label: 'A',
    type: 'text',
    options: '',
    default: '',
    ...row,
  });
  assert.deepEqual(
    paramRowErrors([
      row({ type: 'number', default: 'x' }),
      row({ name: '1a', label: '' }),
      row({ name: 'c', type: 'select', options: '' }),
      row({ name: 'c' }),
    ]),
    [
      { index: 0, field: 'default', message: '既定値の誤りです。数値ではありません。' },
      {
        index: 1,
        field: 'name',
        message: '名前は、英字で始め、英数字と _ だけで入力してください。例：month',
      },
      { index: 1, field: 'label', message: '表示名を入力してください。' },
      {
        index: 2,
        field: 'options',
        message: '選択肢を 1 つ以上、「、」で区切って入力してください。',
      },
      {
        index: 3,
        field: 'name',
        message: '同じ名前の値がほかにあります。別の名前にしてください。',
      },
    ],
  );
  assert.deepEqual(paramRowErrors([row({})]), []);
});

test('削除した値を手順が参照している場合は、参照している名前と直し方を示す', () => {
  assert.equal(
    describeParamSaveErrors([
      'steps[0]: 定義されていないパラメータ「kw」を参照しています。',
      'steps[1].steps[0]: path の「kw」は、パラメータにも、前の手順の extract で付けた名前にもありません。',
    ]),
    '手順の中で {{kw}} を使っているため、保存しませんでした。この値を削除する場合は、先に手順のブロックの中の {{kw}} を書き換えてください。',
  );
  assert.equal(
    describeParamSaveErrors(['name が空です。']),
    '誤りがあるため、保存しませんでした。\nname が空です。',
  );
});
