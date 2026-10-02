// 定期実行の予約の計算と検証（extension/shared/schedule.js）のテストです（#22）。
// 日時はすべてローカル時刻で作ります。予約は PC の時刻を基準とするためです。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ON_TIME_MS,
  describeSchedule,
  dueOccurrence,
  formatRunAt,
  nextRunAt,
  pickWaiting,
  previousRunAt,
  readScheduleInput,
  schedulingProblems,
  schedulingRemedies,
  shouldRun,
  validateScheduleSetting,
} from '../extension/shared/schedule.js';

/** @typedef {import('../extension/shared/schedule.js').Schedule} Schedule */
/** @typedef {import('../extension/shared/schedule.js').ScheduleSetting} ScheduleSetting */
/** @typedef {import('../extension/shared/flow.js').Flow} Flow */

/**
 * ローカル時刻の日時です。月は 1 から数えます。
 * @param {number} year
 * @param {number} month
 * @param {number} date
 * @param {number} [hours]
 * @param {number} [minutes]
 */
function at(year, month, date, hours = 0, minutes = 0) {
  return new Date(year, month - 1, date, hours, minutes);
}

/** @type {ScheduleSetting} */
const daily = { frequency: 'daily', time: '09:00', catchUp: true };
/** @type {ScheduleSetting} */
const weekly = { frequency: 'weekly', weekday: 1, time: '09:30', catchUp: true };
/** @type {ScheduleSetting} */
const monthly = { frequency: 'monthly', day: 1, time: '08:00', catchUp: true };

test('毎日：同じ日の時刻の前なら当日、後なら翌日', () => {
  assert.deepEqual(nextRunAt(daily, at(2026, 9, 29, 8, 59)), at(2026, 9, 29, 9, 0));
  assert.deepEqual(nextRunAt(daily, at(2026, 9, 29, 9, 0)), at(2026, 9, 30, 9, 0));
  assert.deepEqual(nextRunAt(daily, at(2026, 12, 31, 10, 0)), at(2027, 1, 1, 9, 0));
});

test('毎週：指定した曜日の時刻', () => {
  // 2026-09-29 は火曜日です。次の月曜日は 10 月 5 日です。
  assert.deepEqual(nextRunAt(weekly, at(2026, 9, 29, 12, 0)), at(2026, 10, 5, 9, 30));
  assert.deepEqual(nextRunAt(weekly, at(2026, 10, 5, 9, 29)), at(2026, 10, 5, 9, 30));
  assert.deepEqual(nextRunAt(weekly, at(2026, 10, 5, 9, 30)), at(2026, 10, 12, 9, 30));
});

test('毎月：指定した日の時刻。年の変わり目も数える', () => {
  assert.deepEqual(nextRunAt(monthly, at(2026, 9, 29, 12, 0)), at(2026, 10, 1, 8, 0));
  assert.deepEqual(nextRunAt(monthly, at(2026, 12, 1, 8, 0)), at(2027, 1, 1, 8, 0));
});

test('毎月：その日がない月は、月の最終日に実行する', () => {
  /** @type {ScheduleSetting} */
  const endOfMonth = { frequency: 'monthly', day: 31, time: '20:00', catchUp: true };
  assert.deepEqual(nextRunAt(endOfMonth, at(2027, 2, 1)), at(2027, 2, 28, 20, 0));
  assert.deepEqual(nextRunAt(endOfMonth, at(2028, 2, 1)), at(2028, 2, 29, 20, 0));
  assert.deepEqual(nextRunAt(endOfMonth, at(2026, 9, 1)), at(2026, 9, 30, 20, 0));
  assert.deepEqual(nextRunAt(endOfMonth, at(2026, 10, 1)), at(2026, 10, 31, 20, 0));
  assert.deepEqual(previousRunAt(endOfMonth, at(2027, 3, 15)), at(2027, 2, 28, 20, 0));
});

test('前の予約の日時は、指定した日時と同じ時刻を含む', () => {
  assert.deepEqual(previousRunAt(daily, at(2026, 9, 29, 9, 0)), at(2026, 9, 29, 9, 0));
  assert.deepEqual(previousRunAt(daily, at(2026, 9, 29, 8, 59)), at(2026, 9, 28, 9, 0));
  assert.deepEqual(previousRunAt(monthly, at(2026, 9, 29)), at(2026, 9, 1, 8, 0));
});

/**
 * @param {ScheduleSetting} setting
 * @param {Date} createdAt
 * @param {Date} [lastScheduledAt]
 * @returns {Schedule}
 */
function schedule(setting, createdAt, lastScheduledAt) {
  return {
    ...setting,
    createdAt: createdAt.toISOString(),
    ...(lastScheduledAt ? { lastScheduledAt: lastScheduledAt.toISOString() } : {}),
  };
}

test('取りこぼしなし：予約の日時を過ぎていなければ実行しない', () => {
  const s = schedule(daily, at(2026, 9, 29, 10, 0));
  assert.equal(dueOccurrence(s, at(2026, 9, 29, 23, 0)), null);
});

test('時刻どおり：予約の日時の直後は、遅れていない実行として扱う', () => {
  const s = schedule(daily, at(2026, 9, 28, 10, 0));
  assert.deepEqual(dueOccurrence(s, new Date(at(2026, 9, 29, 9, 0).getTime() + 30_000)), {
    at: at(2026, 9, 29, 9, 0),
    late: false,
  });
  const due = dueOccurrence(s, new Date(at(2026, 9, 29, 9, 0).getTime() + ON_TIME_MS));
  assert.equal(due?.late, false);
});

test('取りこぼし 1 回分：遅れた予約として返す', () => {
  const s = schedule(daily, at(2026, 9, 28, 10, 0));
  assert.deepEqual(dueOccurrence(s, at(2026, 9, 29, 12, 0)), {
    at: at(2026, 9, 29, 9, 0),
    late: true,
  });
});

test('取りこぼし複数回分：最後の 1 回分だけを返す', () => {
  const s = schedule(daily, at(2026, 9, 20, 10, 0), at(2026, 9, 21, 9, 0));
  assert.deepEqual(dueOccurrence(s, at(2026, 9, 29, 12, 0)), {
    at: at(2026, 9, 29, 9, 0),
    late: true,
  });
});

test('処理済みの予約の日時は、2 回実行しない', () => {
  const s = schedule(daily, at(2026, 9, 20, 10, 0), at(2026, 9, 29, 9, 0));
  assert.equal(dueOccurrence(s, at(2026, 9, 29, 12, 0)), null);
});

test('予約を設定した日時より前の予約の日時は、取りこぼしとして扱わない', () => {
  // 9:00 の予約を 9:05 に設定した場合、その日の 9:00 は実行しません。
  const s = schedule(daily, at(2026, 9, 29, 9, 5));
  assert.equal(dueOccurrence(s, at(2026, 9, 29, 9, 6)), null);
});

test('取りこぼしの実行がオフの場合、遅れた予約は実行しない', () => {
  assert.equal(
    shouldRun({ ...schedule(daily, at(2026, 9, 1)), catchUp: false }, { late: true }),
    false,
  );
  assert.equal(
    shouldRun({ ...schedule(daily, at(2026, 9, 1)), catchUp: false }, { late: false }),
    true,
  );
  assert.equal(shouldRun(schedule(daily, at(2026, 9, 1)), { late: true }), true);
});

test('予約の設定の検証', () => {
  assert.deepEqual(validateScheduleSetting(daily), []);
  assert.deepEqual(validateScheduleSetting(weekly), []);
  assert.deepEqual(validateScheduleSetting(monthly), []);
  assert.deepEqual(validateScheduleSetting({ ...daily, frequency: 'yearly' }), [
    '周期は、毎日・毎週・毎月のいずれかを選んでください。',
  ]);
  assert.deepEqual(validateScheduleSetting({ ...weekly, weekday: 7 }), ['曜日を選んでください。']);
  assert.deepEqual(validateScheduleSetting({ ...monthly, day: 0 }), [
    '日は 1〜31 の整数で指定してください。',
  ]);
  assert.deepEqual(validateScheduleSetting({ ...monthly, day: 32 }), [
    '日は 1〜31 の整数で指定してください。',
  ]);
  for (const time of ['24:00', '9:00', '09:60', '']) {
    assert.deepEqual(validateScheduleSetting({ ...daily, time }), [
      '時刻を 00:00〜23:59 の形式で指定してください。',
    ]);
  }
  assert.deepEqual(validateScheduleSetting({ ...daily, catchUp: 'yes' }), [
    '取りこぼしを実行するかを指定してください。',
  ]);
  assert.deepEqual(validateScheduleSetting(null), ['予約の設定がオブジェクトではありません。']);
});

/** @type {Flow} */
const baseFlow = {
  schemaVersion: 12,
  name: '領収書',
  origin: 'https://shop.example.com',
  steps: [{ type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' }],
};

test('定期実行できるフロー：既定値のあるパラメータだけを持つ', () => {
  assert.deepEqual(schedulingProblems(baseFlow), []);
  assert.deepEqual(
    schedulingProblems({
      ...baseFlow,
      params: [{ name: 'month', label: '対象月', type: 'month', default: '@previous-month' }],
    }),
    [],
  );
  // 前々月（#163）も、実行した日から決まる既定値です。
  assert.deepEqual(
    schedulingProblems({
      ...baseFlow,
      params: [{ name: 'month', label: '対象月', type: 'month', default: '@month-before-last' }],
    }),
    [],
  );
});

test('定期実行できないフロー：既定値のないパラメータと、値を記録していない入力欄', () => {
  const target = { selectors: ['#password'], tag: 'input', label: 'パスワード' };
  assert.deepEqual(
    schedulingProblems({
      ...baseFlow,
      params: [{ name: 'code', label: '注文番号', type: 'text' }],
      steps: [
        ...baseFlow.steps,
        {
          type: 'if',
          condition: {
            target: { selectors: ['#login'], tag: 'form', label: 'ログイン' },
            exists: true,
          },
          then: [{ type: 'input', target, secret: true }],
        },
      ],
    }),
    [
      'パラメータ「注文番号」に既定値がありません。',
      '手順 3（パスワード）は、実行のたびに値を入力する欄です。',
    ],
  );
});

const A = 'https://a.example.com';
const B = 'https://b.example.com';

test('待っている定期実行：同じサイトの実行中は選ばず、終わった後に選ぶ', () => {
  const waiting = [
    { flowId: 'a', flowName: 'A', origin: A, scheduledAt: '' },
    { flowId: 'b', flowName: 'B', origin: B, scheduledAt: '' },
  ];
  const running = [{ origin: A, flowName: '手動', status: 'running' }];
  assert.equal(pickWaiting(waiting, running, [])?.flowId, 'b');
  assert.equal(pickWaiting(waiting.slice(0, 1), running, []), undefined);
  // 一時停止中も実行中として扱います。
  assert.equal(
    pickWaiting(waiting.slice(0, 1), [{ origin: A, flowName: '手動', status: 'paused' }], []),
    undefined,
  );
  // 終わった実行は使用中として扱いません。
  assert.equal(
    pickWaiting(waiting, [{ origin: A, flowName: '手動', status: 'done' }], [])?.flowId,
    'a',
  );
});

test('待っている定期実行：終わっていない一括実行のサイトは使用中として扱う', () => {
  const waiting = [{ flowId: 'a', flowName: 'A', origin: A, scheduledAt: '' }];
  /** @type {import('../extension/shared/batch.js').BatchRun} */
  const batch = {
    batchRunId: 'r',
    batchId: 'x',
    name: '月初',
    startedAt: '',
    items: [
      { flowId: 'b', flowName: 'B', origin: B, status: 'running' },
      { flowId: 'c', flowName: 'C', origin: A, status: 'waiting' },
    ],
  };
  assert.equal(pickWaiting(waiting, [], [batch]), undefined);
  const finished = {
    ...batch,
    items: batch.items.map((entry) => ({ ...entry, status: /** @type {const} */ ('done') })),
  };
  assert.equal(pickWaiting(waiting, [], [finished])?.flowId, 'a');
});

test('予約の表示', () => {
  assert.equal(describeSchedule(daily), '毎日 9:00');
  assert.equal(describeSchedule(weekly), '毎週 月曜日 9:30');
  assert.equal(describeSchedule(monthly), '毎月 1 日 8:00');
  assert.equal(formatRunAt(at(2026, 10, 1, 9, 5)), '10月1日（木）9:05');
});

test('画面の入力欄の値を、予約の設定にする', () => {
  const base = { frequency: '', weekday: '1', day: '', time: '09:00', catchUp: true };
  assert.deepEqual(readScheduleInput(base), { ok: true, setting: null });
  assert.deepEqual(readScheduleInput({ ...base, frequency: 'daily' }), {
    ok: true,
    setting: { frequency: 'daily', time: '09:00', catchUp: true },
  });
  assert.deepEqual(readScheduleInput({ ...base, frequency: 'weekly', catchUp: false }), {
    ok: true,
    setting: { frequency: 'weekly', weekday: 1, time: '09:00', catchUp: false },
  });
  assert.deepEqual(readScheduleInput({ ...base, frequency: 'monthly', day: ' 31 ' }), {
    ok: true,
    setting: { frequency: 'monthly', day: 31, time: '09:00', catchUp: true },
  });
  for (const day of ['', '0', '32', '1.5', 'a']) {
    assert.deepEqual(readScheduleInput({ ...base, frequency: 'monthly', day }), {
      ok: false,
      field: 'day',
      error: '日は 1〜31 の整数で入力してください。',
    });
  }
  assert.deepEqual(readScheduleInput({ ...base, frequency: 'daily', time: '' }), {
    ok: false,
    field: 'time',
    error: '時刻を入力してください。',
  });
});

test('定期実行できないフローに、定期実行できるようにする方法を理由の種類ごとに示す', () => {
  const target = { selectors: ['#password'], tag: 'input', label: 'パスワード' };
  assert.deepEqual(schedulingRemedies(baseFlow), []);
  const secret = schedulingRemedies({
    ...baseFlow,
    steps: [
      ...baseFlow.steps,
      { type: 'input', target, secret: true },
      { type: 'input', target: { ...target, label: '確認コード' }, secret: true },
    ],
  });
  assert.equal(secret.length, 1);
  assert.match(secret[0], /ログイン/);
  const both = schedulingRemedies({
    ...baseFlow,
    params: [{ name: 'code', label: '注文番号', type: 'text' }],
    steps: [...baseFlow.steps, { type: 'input', target, secret: true }],
  });
  assert.equal(both.length, 2);
  assert.match(both[0], /既定値/);
});
