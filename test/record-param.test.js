// 記録した選択と入力の値を、実行するたびに変える値にする処理（extension/shared/record-param.js、#286）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeRecordedParam,
  paramTarget,
  referencedParams,
  revertRecordedParam,
  valueOptions,
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

/**
 * 手順に順に値を選び、結果の手順とパラメータを返します。
 * @param {Step[]} steps
 * @param {{ index: number, value: string, part?: string }[]} picks
 */
function pickAll(steps, picks) {
  /** @type {Param[]} */
  let params = [];
  for (const { index, value, part } of picks) {
    const result = ok(makeRecordedParam(steps, params, index, { value, part }));
    steps = result.steps;
    params = result.params;
  }
  return { steps, params };
}

/** @param {Step[]} steps */
const valuesOf = (steps) => steps.map((step) => step.type === 'select' && step.values[0]);

test('表示名「開始の月」・値 09 の選択に前月を選ぶと、{{date1.mm}} になり、「開始の日付」の定義が加わる', () => {
  const result = ok(makeRecordedParam([select('開始の月', '09')], [], 0, { value: 'prev' }));
  assert.deepEqual(result.steps[0].type === 'select' && result.steps[0].values, ['{{date1.mm}}']);
  // 記録した時点の表示文字列は残します。実行では、参照を含む値では表示文字列を探しません。
  assert.deepEqual(result.steps[0].type === 'select' && result.steps[0].labels, ['09']);
  assert.deepEqual(result.params, [
    { name: 'date1', label: '開始の日付', type: 'date', default: '@first-of-previous-month' },
  ]);
  assert.equal(result.label, '開始の日付');
});

test('開始の月・日、終了の月・日の順に、前月・1 日・前月・末日を選ぶと、開始日と終了日になる', () => {
  const { steps, params } = pickAll(
    [
      select('開始の月', '09'),
      select('開始の日', '01'),
      select('終了の月', '09'),
      select('終了の日', '30'),
    ],
    [
      { index: 0, value: 'prev' },
      { index: 1, value: 'first' },
      { index: 2, value: 'prev' },
      { index: 3, value: 'end' },
    ],
  );
  assert.deepEqual(valuesOf(steps), [
    '{{date1.mm}}',
    '{{date1.dd}}',
    '{{date2.mm}}',
    '{{date2.dd}}',
  ]);
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

test('月を 2 つ選んでから日を 2 つ選んでも、月と日を順に組にする', () => {
  // 表示名は「月」「日」だけです（e2e/pages/bank-period.html と同じ）。
  const { steps, params } = pickAll(
    [select('月', '09'), select('月', '09'), select('日', '01'), select('日', '30')],
    [
      { index: 0, value: 'prev' },
      { index: 1, value: 'prev' },
      { index: 2, value: 'first' },
      { index: 3, value: 'end' },
    ],
  );
  assert.deepEqual(valuesOf(steps), [
    '{{date1.mm}}',
    '{{date2.mm}}',
    '{{date1.dd}}',
    '{{date2.dd}}',
  ]);
  assert.deepEqual(
    params.map((param) => [param.label, param.default]),
    [
      ['開始日', '@first-of-previous-month'],
      ['終了日', '@end-of-previous-month'],
    ],
  );
});

test('日を先に選んでも、後から選んだ月を同じ側の日付にまとめる', () => {
  const { steps, params } = pickAll(
    [select('日', '01'), select('日', '30'), select('月', '09'), select('月', '09')],
    [
      { index: 0, value: 'first' },
      { index: 1, value: 'end' },
      { index: 2, value: 'prev' },
      { index: 3, value: 'prev' },
    ],
  );
  assert.deepEqual(valuesOf(steps), [
    '{{date1.dd}}',
    '{{date2.dd}}',
    '{{date1.mm}}',
    '{{date2.mm}}',
  ]);
  assert.deepEqual(
    params.map((param) => param.default),
    ['@first-of-previous-month', '@end-of-previous-month'],
  );
});

test('今月の月と今日の日は、既定値が今日の日付にまとめる', () => {
  const { params } = pickAll(
    [select('月', '10'), select('日', '11')],
    [
      { index: 0, value: 'current' },
      { index: 1, value: 'today' },
    ],
  );
  assert.deepEqual(params, [{ name: 'date1', label: '日付', type: 'date', default: '@today' }]);
});

test('前月の月と組になる日に「今日」は選べない', () => {
  const first = ok(
    makeRecordedParam([select('月', '09'), select('日', '11')], [], 0, { value: 'prev' }),
  );
  const result = makeRecordedParam(first.steps, first.params, 1, { value: 'today' });
  assert.equal(result.ok, false);
});

test('記録した値が 1 桁の場合は、先頭に 0 を付けない形（month、day）にする', () => {
  const month = ok(makeRecordedParam([select('開始の月', '9')], [], 0, { value: 'prev' }));
  assert.deepEqual(month.steps[0].type === 'select' && month.steps[0].values, ['{{date1.month}}']);
  const day = ok(makeRecordedParam([select('日', '5')], [], 0, { value: 'first' }));
  assert.deepEqual(day.steps[0].type === 'select' && day.steps[0].values, ['{{date1.day}}']);
});

test('4 桁の年は {{名前.year}} にする', () => {
  const result = ok(makeRecordedParam([select('開始の年', '2026')], [], 0, { value: 'prev' }));
  assert.deepEqual(result.steps[0].type === 'select' && result.steps[0].values, ['{{date1.year}}']);
});

test('value が数でない場合は、表示文字列が数なら対象にする', () => {
  const step = select('開始の月', 'm09', '09');
  assert.deepEqual(paramTarget(step), { kind: 'date', part: 'month' });
});

test('表示名と値から年・月・日が決まらない場合は、選択が必要と判定し、選ぶと変える', () => {
  const step = select('期間', '09');
  assert.deepEqual(paramTarget(step), { kind: 'date', part: null });
  const missing = makeRecordedParam([step], [], 0, { value: 'prev' });
  assert.equal(missing.ok, false);
  const result = ok(makeRecordedParam([step], [], 0, { value: 'prev', part: 'month' }));
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
      value: 'prev',
    }),
  );
  assert.equal(result.params[1].name, 'date3');
});

test('選択肢にない値は受け付けない', () => {
  assert.equal(makeRecordedParam([select('開始の月', '09')], [], 0, { value: 'end' }).ok, false);
  assert.equal(makeRecordedParam([select('開始の日', '09')], [], 0, { value: 'prev' }).ok, false);
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

test('月の欄には月だけ、日の欄には日だけを選択肢に出し、記録した値と一致するものを選んでおく', () => {
  // 2026 年 10 月 10 日に、期間 9 月 1 日〜9 月 30 日を記録した場合です。
  const now = new Date(2026, 9, 10);
  /** @type {Step[]} */
  let steps = [select('月', '09'), select('日', '01'), select('月', '09'), select('日', '30')];
  /** @type {Param[]} */
  let params = [];
  /** @type {string[][]} */
  const shown = [];
  for (const [index, part] of /** @type {const} */ (['month', 'day', 'month', 'day']).entries()) {
    const options = valueOptions(steps, params, index, part, now);
    shown.push(
      options.map((option) => `${option.selected ? '*' : ''}${option.label}→${option.fieldValue}`),
    );
    const selected = options.find((option) => option.selected);
    assert.ok(selected);
    const result = ok(makeRecordedParam(steps, params, index, { value: selected.value }));
    steps = result.steps;
    params = result.params;
  }
  assert.deepEqual(shown, [
    ['*前月（9 月）→09', '今月（10 月）→10'],
    // 組になる日付が前月の側のため、「今日」は出しません。
    ['*1 日→01', '末日（30 日）→30'],
    ['*前月（9 月）→09', '今月（10 月）→10'],
    ['1 日→01', '*末日（30 日）→30'],
  ]);
  assert.deepEqual(valuesOf(steps), [
    '{{date1.mm}}',
    '{{date1.dd}}',
    '{{date2.mm}}',
    '{{date2.dd}}',
  ]);
  assert.deepEqual(
    params.map((param) => [param.label, param.default]),
    [
      ['開始日', '@first-of-previous-month'],
      ['終了日', '@end-of-previous-month'],
    ],
  );
});

test('組になる日付がない日の欄には、1 日・末日・今日を出す。一致しない場合は先頭を選んでおく', () => {
  const now = new Date(2026, 9, 10);
  const options = valueOptions([select('日', '15')], [], 0, 'day', now);
  assert.deepEqual(
    options.map((option) => [option.label, option.fieldValue, option.selected]),
    [
      ['1 日', '01', true],
      ['末日（30 日）', '30', false],
      ['今日（10 日）', '10', false],
    ],
  );
});

test('1 桁で記録した月には、先頭に 0 を付けない値を示す', () => {
  const now = new Date(2026, 9, 10);
  const options = valueOptions([select('月', '9')], [], 0, 'month', now);
  assert.equal(options[0].fieldValue, '9');
  assert.equal(options[0].selected, true);
});

test('元の値に戻すと、記録した値になり、使わなくなった定義を除く。戻した後は選び直せる', () => {
  let { steps, params } = pickAll(
    [select('月', '09'), select('日', '01'), input('お名前', '山田')],
    [
      { index: 0, value: 'prev' },
      { index: 1, value: 'first' },
    ],
  );
  const text = ok(makeRecordedParam(steps, params, 2, {}));
  steps = text.steps;
  params = text.params;

  // 日を戻しても、月が使っている日付は残します。
  const day = revertRecordedParam(steps, params, 1);
  assert.ok(day.ok);
  assert.deepEqual(valuesOf(day.steps).slice(0, 2), ['{{date1.mm}}', '01']);
  assert.deepEqual(
    day.params.map((param) => param.name),
    ['date1', 'text1'],
  );
  // 戻した日は、もう一度選べます。末日を選ぶと、月と組の日付の既定値が前月末日になります。
  assert.ok(paramTarget(day.steps[1]));
  const again = ok(makeRecordedParam(day.steps, day.params, 1, { value: 'end' }));
  assert.deepEqual(
    again.params.map((param) => [param.name, param.label, param.default]),
    [
      ['date1', '終了日', '@end-of-previous-month'],
      ['text1', 'お名前', '山田'],
    ],
  );

  // 入力は記録した文字に戻し、文字の定義を除きます。
  const name = revertRecordedParam(again.steps, again.params, 2);
  assert.ok(name.ok);
  assert.equal(name.steps[2].type === 'input' && name.steps[2].value, '山田');
  assert.deepEqual(
    name.params.map((param) => param.name),
    ['date1'],
  );

  // 変えていない手順は戻せません。
  assert.equal(revertRecordedParam([select('月', '09')], [], 0).ok, false);
});
