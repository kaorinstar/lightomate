// 記録した選択と入力の値を、実行するたびに変える値にする処理（extension/shared/record-param.js、#286）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeRecordedParam,
  paramTarget,
  referencedParams,
  valueParamNote,
} from '../extension/shared/record-param.js';
import { describeStep } from '../extension/shared/describe.js';
import { SCHEMA_VERSION, validateFlow } from '../extension/shared/flow.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */
/** @typedef {import('../extension/shared/params.js').Param} Param */

/**
 * 選択の手順を作ります。
 * @param {string} label 要素の表示名
 * @param {string} value 選んだ選択肢の value
 * @param {string} [shown] 選んだ選択肢の表示文字列
 * @returns {Step}
 */
function select(label, value, shown = value) {
  return {
    type: 'select',
    target: { selectors: [`select[name="${label}"]`], tag: 'select', label },
    values: [value],
    labels: [shown],
  };
}

/**
 * 入力の手順を作ります。
 * @param {string} label
 * @param {string} value
 * @returns {Step}
 */
function input(label, value) {
  return {
    type: 'input',
    target: { selectors: ['#keyword'], tag: 'input', label },
    value,
  };
}

/**
 * 結果が成功であることを確かめて返します。
 * @param {ReturnType<typeof makeRecordedParam>} result
 */
function ok(result) {
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return /** @type {Extract<typeof result, { ok: true }>} */ (result);
}

test('表示名「開始の月」・値 09 の選択に前月 1 日を選ぶと、{{date1.mm}} になり、「開始の日付」の定義が加わる', () => {
  const result = ok(
    makeRecordedParam([select('開始の月', '09')], [], 0, {
      defaultValue: '@first-of-previous-month',
    }),
  );
  assert.deepEqual(result.steps[0].type === 'select' && result.steps[0].values, ['{{date1.mm}}']);
  // 記録した時点の表示文字列は残します。実行では、参照を含む値では表示文字列を探しません。
  assert.deepEqual(result.steps[0].type === 'select' && result.steps[0].labels, ['09']);
  assert.deepEqual(result.params, [
    { name: 'date1', label: '開始の日付', type: 'date', default: '@first-of-previous-month' },
  ]);
  assert.equal(result.label, '開始の日付');
});

test('同じ既定値を選んだ手順は同じ日付にまとめ、異なる既定値では新しい日付を加える', () => {
  /** @type {Step[]} */
  let steps = [
    select('開始の月', '09'),
    select('開始の日', '01'),
    select('終了の月', '09'),
    select('終了の日', '30'),
  ];
  /** @type {Param[]} */
  let params = [];
  const choices = [
    '@first-of-previous-month',
    '@first-of-previous-month',
    '@end-of-previous-month',
    '@end-of-previous-month',
  ];
  choices.forEach((defaultValue, index) => {
    const result = ok(makeRecordedParam(steps, params, index, { defaultValue }));
    steps = result.steps;
    params = result.params;
  });
  assert.deepEqual(
    steps.map((step) => step.type === 'select' && step.values[0]),
    ['{{date1.mm}}', '{{date1.dd}}', '{{date2.mm}}', '{{date2.dd}}'],
  );
  assert.deepEqual(params, [
    { name: 'date1', label: '開始の日付', type: 'date', default: '@first-of-previous-month' },
    { name: 'date2', label: '終了の日付', type: 'date', default: '@end-of-previous-month' },
  ]);
  assert.deepEqual(
    validateFlow({
      schemaVersion: SCHEMA_VERSION,
      name: '期間',
      origin: 'https://example.com',
      params,
      steps,
    }),
    [],
  );
});

test('表示名が「月」「日」だけの場合は、既定値から「開始日」「終了日」を表示名にする', () => {
  // 銀行の画面（e2e/pages/bank-period.html）は、選択の横に「月」「日」とだけ表示します。
  let result = ok(
    makeRecordedParam([select('月', '09'), select('月', '09')], [], 0, {
      defaultValue: '@first-of-previous-month',
    }),
  );
  result = ok(
    makeRecordedParam(result.steps, result.params, 1, {
      defaultValue: '@end-of-previous-month',
    }),
  );
  assert.deepEqual(
    result.params.map((param) => param.label),
    ['開始日', '終了日'],
  );
});

test('記録した値が 1 桁の場合は、先頭に 0 を付けない形（month、day）にする', () => {
  const month = ok(makeRecordedParam([select('開始の月', '9')], [], 0, { defaultValue: '@today' }));
  assert.deepEqual(month.steps[0].type === 'select' && month.steps[0].values, ['{{date1.month}}']);
  const day = ok(makeRecordedParam([select('日', '5')], [], 0, { defaultValue: '@today' }));
  assert.deepEqual(day.steps[0].type === 'select' && day.steps[0].values, ['{{date1.day}}']);
});

test('4 桁の年は {{名前.year}} にする', () => {
  const result = ok(
    makeRecordedParam([select('開始の年', '2026')], [], 0, { defaultValue: '@today' }),
  );
  assert.deepEqual(result.steps[0].type === 'select' && result.steps[0].values, ['{{date1.year}}']);
});

test('value が数でない場合は、表示文字列が数なら対象にする', () => {
  const step = select('開始の月', 'm09', '09');
  assert.deepEqual(paramTarget(step), { kind: 'date', part: 'month' });
});

test('表示名と値から年・月・日が決まらない場合は、選択が必要と判定し、選ぶと変える', () => {
  const step = select('期間', '09');
  assert.deepEqual(paramTarget(step), { kind: 'date', part: null });
  const missing = makeRecordedParam([step], [], 0, { defaultValue: '@today' });
  assert.equal(missing.ok, false);
  const result = ok(makeRecordedParam([step], [], 0, { defaultValue: '@today', part: 'month' }));
  assert.deepEqual(result.steps[0].type === 'select' && result.steps[0].values, ['{{date1.mm}}']);
});

test('表示名がなくても、値が 13〜31 なら日、4 桁なら年と判定する', () => {
  assert.deepEqual(paramTarget(select('期間', '25')), { kind: 'date', part: 'day' });
  assert.deepEqual(paramTarget(select('期間', '2026')), { kind: 'date', part: 'year' });
});

test('表示名の部分と記録した値が食い違う場合は、値から判定する', () => {
  // 「月」の欄に 25 は入らないため、日として扱います。
  assert.deepEqual(paramTarget(select('開始の月', '25')), { kind: 'date', part: 'day' });
});

test('対象にしない手順：数でない選択、複数の選択、参照を含む値、パスワード、クリック', () => {
  assert.equal(paramTarget(select('並び順', 'new', '新しい順')), null);
  assert.equal(
    paramTarget({
      type: 'select',
      target: { selectors: ['#m'], tag: 'select', label: '月' },
      values: ['09', '10'],
      labels: ['09', '10'],
    }),
    null,
  );
  assert.equal(paramTarget(select('月', '{{date1.mm}}')), null);
  assert.equal(
    paramTarget({
      type: 'input',
      target: { selectors: ['#pw'], tag: 'input', label: 'パスワード' },
      secret: true,
    }),
    null,
  );
  assert.equal(paramTarget(input('検索', '{{text1}}')), null);
  assert.equal(
    paramTarget({
      type: 'click',
      target: { selectors: ['#go'], tag: 'button', label: '照会する' },
    }),
    null,
  );
});

test('入力の手順は {{text1}} になり、記録した文字が既定値になる', () => {
  const result = ok(makeRecordedParam([input('お名前', '山田 太郎')], [], 0, {}));
  assert.deepEqual(result.steps[0].type === 'input' && result.steps[0].value, '{{text1}}');
  assert.deepEqual(result.params, [
    { name: 'text1', label: 'お名前', type: 'text', default: '山田 太郎' },
  ]);
  assert.deepEqual(
    validateFlow({
      schemaVersion: SCHEMA_VERSION,
      name: '入力',
      origin: 'https://example.com',
      params: result.params,
      steps: result.steps,
    }),
    [],
  );
});

test('名前は、ほかのパラメータと読み取りの名前に重ならないものにする', () => {
  /** @type {Step[]} */
  const steps = [
    { type: 'extract', target: { selectors: ['#a'], tag: 'span', label: 'a' }, name: 'date1' },
    select('開始の月', '09'),
  ];
  const result = ok(
    makeRecordedParam(steps, [{ name: 'date2', label: '別の値', type: 'text' }], 1, {
      defaultValue: '@today',
    }),
  );
  assert.equal(result.params[1].name, 'date3');
});

test('既定値の一覧にない値は受け付けない', () => {
  const result = makeRecordedParam([select('開始の月', '09')], [], 0, {
    defaultValue: '2026-09-01',
  });
  assert.equal(result.ok, false);
});

test('どの手順も参照しないパラメータは除く', () => {
  /** @type {Param[]} */
  const params = [
    { name: 'date1', label: '開始日', type: 'date', default: '@first-of-previous-month' },
    { name: 'date2', label: '終了日', type: 'date', default: '@end-of-previous-month' },
  ];
  assert.deepEqual(referencedParams([select('月', '{{date2.mm}}')], params), [params[1]]);
  assert.deepEqual(referencedParams([], params), []);
  assert.deepEqual(referencedParams([], undefined), []);
});

test('実行するときに入力する値にした手順に、どの値かの説明を添える', () => {
  /** @type {Param[]} */
  const params = [
    { name: 'date1', label: '開始日', type: 'date', default: '@first-of-previous-month' },
    { name: 'text1', label: 'お名前', type: 'text' },
  ];
  assert.equal(
    valueParamNote(select('月', '{{date1.mm}}', '09'), params),
    '実行するときに入力：開始日の月',
  );
  assert.equal(valueParamNote(input('お名前', '{{text1}}'), params), '実行するときに入力：お名前');
  assert.equal(valueParamNote(select('月', '09'), params), null);
  assert.equal(valueParamNote(select('月', '{{other.mm}}'), params), null);
});

test('参照を含む選択の手順は、記録時の表示文字列ではなく値を示す', () => {
  assert.equal(describeStep(select('月', '{{date1.mm}}', '09')), '選択：月 ← {{date1.mm}}');
  assert.equal(describeStep(select('月', '09')), '選択：月 ← 09');
});
