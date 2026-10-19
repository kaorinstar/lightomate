// 記録した選択と入力の値を、実行するたびに変える値にする処理（extension/shared/record-param.js、#286）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeRecordedParam,
  paramTarget,
  referencedParams,
  revertRecordedParam,
  valueOptions,
  wholeDateTokens,
  wholeOptions,
  wholePreview,
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
  const result = ok(
    makeRecordedParam([select('開始の月', '09')], [], 0, { value: 'previous-month' }),
  );
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
      { index: 0, value: 'previous-month' },
      { index: 1, value: 'first' },
      { index: 2, value: 'previous-month' },
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
      { index: 0, value: 'previous-month' },
      { index: 1, value: 'previous-month' },
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
      { index: 2, value: 'previous-month' },
      { index: 3, value: 'previous-month' },
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
      { index: 0, value: 'current-month' },
      { index: 1, value: 'today' },
    ],
  );
  assert.deepEqual(params, [{ name: 'date1', label: '日付', type: 'date', default: '@today' }]);
});

test('月と日は自由に組み合わせられる：前月の今日、今月の末日、選んだ月・選んだ日（#288）', () => {
  const now = new Date(2026, 9, 11);
  /**
   * @param {string} month
   * @param {string} day
   */
  const pair = (month, day) => {
    const first = ok(
      makeRecordedParam([select('月', '09'), select('日', '15')], [], 0, { value: month }, now),
    );
    return ok(makeRecordedParam(first.steps, first.params, 1, { value: day }, now)).params[0]
      .default;
  };
  assert.equal(pair('previous-month', 'today'), '@previous-month:today');
  assert.equal(pair('current-month', 'end'), '@current-month:end');
  assert.equal(pair('previous-month', 'fixed'), '@previous-month:15');
  assert.equal(pair('fixed', 'fixed'), '@2026-09:15');
  assert.equal(pair('fixed', 'end'), '@2026-09:end');
  // 既存の 4 つで表せる組み合わせは、既存の書き方にします（版 19 の拡張機能でも読めるようにするため）。
  assert.equal(pair('previous-month', 'first'), '@first-of-previous-month');
  assert.equal(pair('current-month', 'today'), '@today');
});

test('「選んだ月」の年は、同じ日付の年の欄の記録した値を使う', () => {
  const now = new Date(2026, 9, 11);
  const { params } = pickAll(
    [select('年', '2025'), select('月', '12')],
    [
      { index: 0, value: 'previous-month' },
      { index: 1, value: 'fixed' },
    ],
  );
  assert.equal(params[0].default, '@2025-12:first');
  // 月を先に選んだ年の欄は、月に合わせた年だけを出します。
  const options = valueOptions(
    [select('年', '2026'), select('月', '{{date1.mm}}', '09')],
    [{ name: 'date1', label: '開始日', type: 'date', default: '@previous-month:today' }],
    0,
    'year',
    now,
  );
  assert.deepEqual(
    options.map((option) => [option.value, option.label]),
    [['keep', '月の欄に合わせた年（2026 年）']],
  );
  // 月・日だけの欄の後にある年の欄は、その日付とまとめず、新しい日付にします（#289）。
  const after = ok(
    makeRecordedParam(
      [
        select('月', '{{date1.mm}}', '09'),
        select('日', '{{date1.dd}}', '01'),
        select('年', '2026'),
      ],
      [{ name: 'date1', label: '開始日', type: 'date', default: '@first-of-previous-month' }],
      2,
      { value: 'previous-month' },
      now,
    ),
  );
  assert.equal(after.steps[2].type === 'select' && after.steps[2].values[0], '{{date2.year}}');
});

test('記録した値が 1 桁の場合は、先頭に 0 を付けない形（month、day）にする', () => {
  const month = ok(
    makeRecordedParam([select('開始の月', '9')], [], 0, { value: 'previous-month' }),
  );
  assert.deepEqual(month.steps[0].type === 'select' && month.steps[0].values, ['{{date1.month}}']);
  const day = ok(makeRecordedParam([select('日', '5')], [], 0, { value: 'first' }));
  assert.deepEqual(day.steps[0].type === 'select' && day.steps[0].values, ['{{date1.day}}']);
});

test('4 桁の年は {{名前.year}} にする', () => {
  const result = ok(
    makeRecordedParam([select('開始の年', '2026')], [], 0, { value: 'previous-month' }),
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
  const missing = makeRecordedParam([step], [], 0, { value: 'previous-month' });
  assert.equal(missing.ok, false);
  const result = ok(makeRecordedParam([step], [], 0, { value: 'previous-month', part: 'month' }));
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
      value: 'previous-month',
    }),
  );
  assert.equal(result.params[1].name, 'date3');
});

test('選択肢にない値は受け付けない', () => {
  assert.equal(makeRecordedParam([select('開始の月', '09')], [], 0, { value: 'end' }).ok, false);
  assert.equal(
    makeRecordedParam([select('開始の日', '09')], [], 0, { value: 'previous-month' }).ok,
    false,
  );
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
    ['*前月（9 月）→09', '今月（10 月）→10', '選んだ月（9 月のまま）→09'],
    ['*1 日→01', '末日（30 日）→30', '今日と同じ日（10 日）→10', '選んだ日（1 日のまま）→01'],
    ['*前月（9 月）→09', '今月（10 月）→10', '選んだ月（9 月のまま）→09'],
    ['1 日→01', '*末日（30 日）→30', '今日と同じ日（10 日）→10', '選んだ日（30 日のまま）→30'],
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

test('前月・今月・1 日・末日・今日と一致しない値は、「選んだ日」を選んでおく', () => {
  const now = new Date(2026, 9, 10);
  const options = valueOptions([select('日', '15')], [], 0, 'day', now);
  assert.deepEqual(
    options.map((option) => [option.label, option.fieldValue, option.selected]),
    [
      ['1 日', '01', false],
      ['末日（30 日）', '30', false],
      ['今日と同じ日（10 日）', '10', false],
      ['選んだ日（15 日のまま）', '15', true],
    ],
  );
  // 組になる月が今月なら、末日は今月の末日です。
  const current = valueOptions(
    [select('月', '{{date1.mm}}', '10'), select('日', '15')],
    [{ name: 'date1', label: '開始日', type: 'date', default: '@first-of-current-month' }],
    1,
    'day',
    now,
  );
  assert.equal(current[1].label, '末日（31 日）');
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
      { index: 0, value: 'previous-month' },
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

/**
 * 文字の入力欄の手順を作ります（表示名と値）。
 * @param {string} label
 * @param {string} value
 * @returns {Step}
 */
function field(label, value) {
  return {
    type: 'input',
    target: { selectors: [`input[name="${label}"]`], tag: 'input', label },
    value,
  };
}

test('1 つの欄の日付を、記録した形を保った参照にする（#289）', () => {
  const now = new Date(2026, 9, 11);
  /** @type {[string, string][]} */
  const cases = [
    ['2026/09/01', '{{date1.year}}/{{date1.mm}}/{{date1.dd}}'],
    ['2026/9/1', '{{date1.year}}/{{date1.month}}/{{date1.day}}'],
    ['2026-09-01', '{{date1.year}}-{{date1.mm}}-{{date1.dd}}'],
    ['2026.09.01', '{{date1.year}}.{{date1.mm}}.{{date1.dd}}'],
    ['2026年9月1日', '{{date1.year}}年{{date1.month}}月{{date1.day}}日'],
    ['20260901', '{{date1.year}}{{date1.mm}}{{date1.dd}}'],
    ['09/01', '{{date1.mm}}/{{date1.dd}}'],
    ['9月1日', '{{date1.month}}月{{date1.day}}日'],
  ];
  for (const [value, expected] of cases) {
    const step = field('期間', value);
    assert.equal(paramTarget(step)?.kind, 'whole', value);
    const result = ok(
      makeRecordedParam([step], [], 0, { month: 'previous-month', day: 'first' }, now),
    );
    assert.equal(result.steps[0].type === 'input' && result.steps[0].value, expected, value);
    assert.deepEqual(
      validateFlow({
        schemaVersion: SCHEMA_VERSION,
        name: '期間',
        origin: 'https://example.com',
        params: result.params,
        steps: result.steps,
      }),
      [],
      value,
    );
  }
});

test('日付として読めない入力と、表示名に年・月・日がない数の欄は、文字の値にする（#289）', () => {
  for (const value of [
    'abc',
    '25/09',
    '2026/13/01',
    '2026/09/32',
    '01/09/2026',
    '26/09/01',
    '0901',
  ]) {
    assert.equal(wholeDateTokens(value), null, value);
    assert.deepEqual(paramTarget(field('期間', value)), { kind: 'text' }, value);
  }
  assert.deepEqual(paramTarget(field('数量', '5')), { kind: 'text' });
  assert.deepEqual(paramTarget(field('開始の月', '9')), { kind: 'date', part: 'month' });
  assert.deepEqual(paramTarget(field('年', '2026')), { kind: 'date', part: 'year' });
});

test('年・月・日が別々の入力欄は、選択の欄と同じく 1 つの日付にまとめる（#289）', () => {
  const now = new Date(2026, 9, 11);
  let steps = [field('年', '2026'), field('月', '09'), field('日', '01')];
  /** @type {Param[]} */
  let params = [];
  for (const [index, value] of /** @type {const} */ ([
    'previous-month',
    'previous-month',
    'first',
  ]).entries()) {
    const result = ok(makeRecordedParam(steps, params, index, { value }, now));
    steps = result.steps;
    params = result.params;
  }
  assert.deepEqual(
    steps.map((step) => step.type === 'input' && step.value),
    ['{{date1.year}}', '{{date1.mm}}', '{{date1.dd}}'],
  );
  assert.equal(params.length, 1);
  assert.equal(params[0].default, '@first-of-previous-month');
});

test('1 つの欄の日付は、別々の欄とまとめない（#289）', () => {
  const now = new Date(2026, 9, 11);
  const whole = ok(
    makeRecordedParam(
      [field('期間', '09/01'), field('年', '2026')],
      [],
      0,
      {
        month: 'previous-month',
        day: 'first',
      },
      now,
    ),
  );
  // 月日の欄の日付は年を使っていませんが、年の欄は新しい日付にします。
  const year = ok(
    makeRecordedParam(whole.steps, whole.params, 1, { value: 'previous-month' }, now),
  );
  assert.equal(year.steps[1].type === 'input' && year.steps[1].value, '{{date2.year}}');
  assert.equal(
    valueParamNote(whole.steps[0], whole.params),
    `実行するときに入力：${whole.params[0].label}`,
  );
});

test('1 つの欄の日付の選択肢と、今日実行した場合に入る文字（#289）', () => {
  const now = new Date(2026, 9, 11);
  const step = field('期間', '2026/09/30');
  const options = wholeOptions(step, now);
  assert.ok(options);
  assert.equal(options.month.find((option) => option.selected)?.value, 'previous-month');
  assert.equal(options.day.find((option) => option.selected)?.value, 'end');
  assert.equal(options.month[2].label, '選んだ月（2026 年 9 月のまま）');
  assert.equal(wholePreview(step, { month: 'previous-month', day: 'today' }, now), '2026/09/11');
  assert.equal(
    wholePreview(field('期間', '9/1'), { month: 'current-month', day: 'first' }, now),
    '10/1',
  );
  // 選んだ月は、記録した年の月です。
  const fixed = ok(makeRecordedParam([step], [], 0, { month: 'fixed', day: 'fixed' }, now));
  assert.equal(fixed.params[0].default, '@2026-09:30');
});

test('入力欄の日付は、控えた元の文字で戻す。控えがない場合は戻さない（#289）', () => {
  const now = new Date(2026, 9, 11);
  const made = ok(
    makeRecordedParam(
      [field('期間', '2026/09/01')],
      [],
      0,
      { month: 'previous-month', day: 'first' },
      now,
    ),
  );
  const reverted = revertRecordedParam(made.steps, made.params, 0, '2026/09/01');
  assert.ok(reverted.ok);
  assert.equal(reverted.steps[0].type === 'input' && reverted.steps[0].value, '2026/09/01');
  assert.deepEqual(reverted.params, []);
  assert.equal(revertRecordedParam(made.steps, made.params, 0).ok, false);
});
