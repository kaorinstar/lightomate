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
  assert.equal(validateParams([{ name: 'a', label: 'x', type: 'datetime' }]).length, 1);
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

test('前々月の既定値は、実行した日の 2 か月前の年月にし、年をまたぐ（#163）', () => {
  const param = {
    name: 'month',
    label: '対象月',
    type: /** @type {const} */ ('month'),
    default: '@month-before-last',
  };
  assert.equal(defaultValue(param, new Date(2026, 9, 1)), '2026-08');
  assert.equal(defaultValue(param, new Date(2026, 1, 28)), '2025-12');
  assert.equal(defaultValue(param, new Date(2026, 0, 31)), '2025-11');
  assert.deepEqual(validateParams([param]), []);
});

/** @type {import('../extension/shared/params.js').Param} */
const from = { name: 'from', label: '開始日', type: 'date' };

test('日付のパラメータを検証し、形式の誤りと実在しない日付を誤りとする（#219）', () => {
  assert.deepEqual(validateParams([{ ...from, default: '2026-08-06' }]), []);
  assert.deepEqual(validateParams([{ ...from, default: '@end-of-previous-month' }]), []);
  // 年月の既定値は、日付では使えません。
  assert.equal(validateParams([{ ...from, default: '@previous-month' }]).length, 1);
  const now = new Date(2026, 8, 25);
  for (const value of [
    '2026-8-6',
    '2026/08/06',
    '2026-08',
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
  ]) {
    assert.deepEqual(
      paramFieldErrors([from], { from: value }, now),
      { from: '日付は 2026-08-06 の形式で、実在する日付を指定してください。' },
      value,
    );
  }
  assert.deepEqual(paramFieldErrors([from], { from: '2028-02-29' }, now), {});
});

test('日付のパラメータの .year、.month、.mm、.day、.dd を当てはめる（#219）', () => {
  const { values, errors } = resolveParams([from], { from: '2026-08-06' }, new Date());
  assert.deepEqual(errors, []);
  assert.equal(
    renderTemplate(
      '{{from}} {{from.year}} {{from.month}} {{from.mm}} {{from.day}} {{from.dd}}',
      values,
    ),
    '2026-08-06 2026 8 08 6 06',
  );
  assert.deepEqual(
    validateReferences('{{from.year}}{{from.mm}}{{from.day}}{{from.dd}}', [from]),
    [],
  );
  // .day と .dd は日付のパラメータでだけ使えます。
  assert.equal(validateReferences('{{target.dd}}', params).length, 1);
  assert.equal(validateReferences('{{size.day}}', params).length, 1);
  assert.equal(validateReferences('{{from.hour}}', [from]).length, 1);
});

test('日付の既定値を、実行した日から計算する（#219）', () => {
  /**
   * @param {string} value 既定値
   * @param {Date} now
   */
  const at = (value, now) => defaultValue({ ...from, default: value }, now);
  const now = new Date(2026, 9, 6, 23, 30);
  assert.equal(at('@today', now), '2026-10-06');
  assert.equal(at('@first-of-current-month', now), '2026-10-01');
  assert.equal(at('@first-of-previous-month', now), '2026-09-01');
  assert.equal(at('@end-of-previous-month', now), '2026-09-30');
  // 1 月に実行した場合は、前年の 12 月です。
  const january = new Date(2027, 0, 15);
  assert.equal(at('@first-of-previous-month', january), '2026-12-01');
  assert.equal(at('@end-of-previous-month', january), '2026-12-31');
  // 閏年と、そうでない年の 2 月の末日です。
  assert.equal(at('@end-of-previous-month', new Date(2028, 2, 31)), '2028-02-29');
  assert.equal(at('@end-of-previous-month', new Date(2026, 2, 1)), '2026-02-28');
  // 実行時の値も、入力が空の場合は既定値から計算します。
  const { values } = resolveParams(
    [{ ...from, default: '@end-of-previous-month' }],
    { from: '' },
    january,
  );
  assert.equal(values['from.dd'], '31');
});
