import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultValue,
  findReferences,
  paramFieldErrors,
  renderTemplate,
  resolveParams,
  validateParams,
  validateReferences,
} from '../extension/shared/params.js';

/** @type {import('../extension/shared/params.js').Param[]} */
const params = [
  { name: 'size', label: 'サイズ', type: 'select', options: ['S', 'M', 'L'], default: 'M' },
  { name: 'count', label: '個数', type: 'number' },
  { name: 'target', label: '対象月', type: 'month', default: '@previous-month' },
  { name: 'keyword', label: '検索語', type: 'text' },
];

test('参照を列挙する', () => {
  assert.deepEqual(findReferences('{{size}} と {{ target.year }} と {{x'), [
    { name: 'size', part: undefined },
    { name: 'target', part: 'year' },
  ]);
});

test('参照を値に置き換え、定義のない参照はそのまま残す', () => {
  assert.equal(renderTemplate('{{a}}-{{b}}-{{a}}', { a: '1' }), '1-{{b}}-1');
});

test('前月と今月の既定値は、実行した日から計算する', () => {
  const january = new Date(2026, 0, 15);
  assert.equal(defaultValue(params[2], january), '2025-12');
  assert.equal(defaultValue({ ...params[2], default: '@current-month' }, january), '2026-01');
});

test('入力が空の場合は既定値を使い、年月からは年と月も作る', () => {
  const { values, errors } = resolveParams(
    params,
    { count: '3', keyword: 'ねじ' },
    new Date(2026, 8, 24),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(values, {
    size: 'M',
    count: '3',
    target: '2026-08',
    'target.year': '2026',
    'target.month': '8',
    'target.mm': '08',
    keyword: 'ねじ',
  });
});

test('種類に合わない値と、空の値は誤りとして報告する', () => {
  const { errors } = resolveParams(
    params,
    { size: 'XL', count: '三', target: '2026/08', keyword: '' },
    new Date(2026, 8, 24),
  );
  assert.equal(errors.length, 4);
});

test('パラメータの定義の誤りを報告する', () => {
  assert.deepEqual(validateParams(params), []);
  assert.deepEqual(validateParams(undefined), []);
  assert.equal(validateParams('size').length, 1);
  assert.equal(validateParams([{ name: '1st', label: 'x', type: 'text' }]).length, 1);
  assert.equal(validateParams([params[1], params[1]]).length, 1);
  assert.equal(validateParams([{ name: 'a', label: 'x', type: 'date' }]).length, 1);
  assert.equal(validateParams([{ name: 'a', label: 'x', type: 'select' }]).length, 1);
  assert.equal(validateParams([{ ...params[2], default: 'last-month' }]).length, 1);
});

test('定義されていない参照と、年月以外での .year などの参照を報告する', () => {
  assert.deepEqual(validateReferences('{{size}} {{target.mm}}', params), []);
  assert.equal(validateReferences('{{color}}', params).length, 1);
  assert.equal(validateReferences('{{size.year}}', params).length, 1);
  assert.equal(validateReferences('{{target.day}}', params).length, 1);
});

test('入力の誤りを、パラメータの名前ごとに返す', () => {
  const now = new Date(2026, 8, 25);
  assert.deepEqual(
    paramFieldErrors(params, { size: 'XL', count: 'abc', target: '', keyword: '' }, now),
    {
      size: '選択肢にない値です。',
      count: '数値ではありません。',
      keyword: '値を入力してください。',
    },
    '空でも既定値のある欄（対象月）は誤りにしない',
  );
  assert.deepEqual(
    paramFieldErrors(params, { size: 'S', count: '3', target: '2026-08', keyword: '本' }, now),
    {},
  );
});

test('欄ごとの誤りは、実行時の検証（resolveParams）と同じ件数になる', () => {
  const now = new Date(2026, 8, 25);
  const input = { size: 'XL', count: '', target: '2026-13', keyword: 'a' };
  assert.equal(
    Object.keys(paramFieldErrors(params, input, now)).length,
    resolveParams(params, input, now).errors.length,
  );
});
