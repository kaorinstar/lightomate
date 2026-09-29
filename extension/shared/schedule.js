// 定期実行（#22）の予約の計算と検証です。chrome.* は使いません。
//
// 予約はフローごとに 1 件で、周期（毎日・毎週・毎月）と時刻を持ちます。時刻は PC の時刻（ローカル時刻）で、
// 精度は分単位です。予約は chrome.storage.local の schedules に、フローの ID をキーとして保存します
// （common/schedule-store.js）。フロー定義（JSON）には含めません。

import { batchConflicts } from './batch.js';
import { flattenSteps } from './control-flow.js';

/** @typedef {import('./flow.js').Flow} Flow */
/** @typedef {import('./batch.js').BatchRun} BatchRun */

/** 周期の種類です。 */
export const FREQUENCIES = /** @type {const} */ (['daily', 'weekly', 'monthly']);

/** 曜日の名前です。Date の getDay() の値（0 が日曜日）の順です。 */
export const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 予約の時刻を過ぎてから、この時間までに始めた実行は、時刻どおりの実行として扱います。
 * これより遅れた場合（Chrome を起動していなかった、PC がスリープしていたなど）は、取りこぼしとして扱います。
 * chrome.alarms は数十秒遅れることがあるため、余裕を持たせます。
 */
export const ON_TIME_MS = 10 * 60 * 1000;

/** 時刻の形式です（例：09:00）。 */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * 予約の設定です。画面で入力する項目です。
 * @typedef {object} ScheduleSetting
 * @property {'daily' | 'weekly' | 'monthly'} frequency 周期
 * @property {number} [weekday] 曜日（0 が日曜日）。毎週の場合に使います
 * @property {number} [day] 日（1〜31）。毎月の場合に使います。その日がない月は、月の最終日に実行します
 * @property {string} time 時刻（HH:MM、24 時間制）
 * @property {boolean} catchUp 取りこぼしを実行するか。Chrome を起動していない間に過ぎた予約を、次に起動したときに 1 回だけ実行します
 */

/**
 * 保存する予約です。
 * @typedef {ScheduleSetting & {
 *   createdAt: string,
 *   lastScheduledAt?: string,
 * }} Schedule
 *   createdAt は予約を設定した日時（ISO 8601）です。これより前の予約の日時は、取りこぼしとして扱いません。
 *   lastScheduledAt は、最後に処理した予約の日時（ISO 8601）です。実行したか、取りこぼしの実行がオフのため
 *   実行しなかったかを問いません。同じ予約の日時を 2 回実行しないために使います。
 */

/**
 * 同じサイトの実行が終わるのを待っている定期実行です（chrome.storage.session に保存します）。
 * @typedef {object} WaitingRun
 * @property {string} flowId
 * @property {string} flowName
 * @property {string} origin
 * @property {string} scheduledAt 予約の日時（ISO 8601）
 */

/**
 * 予約の設定を検証します。
 * @param {unknown} value
 * @returns {string[]} 誤りの説明。誤りがない場合は空の配列
 */
export function validateScheduleSetting(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['予約の設定がオブジェクトではありません。'];
  }
  const setting = /** @type {Record<string, unknown>} */ (value);
  /** @type {string[]} */
  const errors = [];
  if (!FREQUENCIES.includes(/** @type {never} */ (setting.frequency))) {
    errors.push('周期は、毎日・毎週・毎月のいずれかを選んでください。');
  }
  if (
    setting.frequency === 'weekly' &&
    !(
      Number.isInteger(setting.weekday) &&
      Number(setting.weekday) >= 0 &&
      Number(setting.weekday) <= 6
    )
  ) {
    errors.push('曜日を選んでください。');
  }
  if (
    setting.frequency === 'monthly' &&
    !(Number.isInteger(setting.day) && Number(setting.day) >= 1 && Number(setting.day) <= 31)
  ) {
    errors.push('日は 1〜31 の整数で指定してください。');
  }
  if (typeof setting.time !== 'string' || !TIME_PATTERN.test(setting.time)) {
    errors.push('時刻を 00:00〜23:59 の形式で指定してください。');
  }
  if (typeof setting.catchUp !== 'boolean') {
    errors.push('取りこぼしを実行するかを指定してください。');
  }
  return errors;
}

/**
 * 人がいないと値を決められないため、定期実行できない理由を返します。
 * - 既定値のないパラメータ：入力フォームを表示しないため、値がありません。
 * - 値を記録していない入力欄（パスワードなど）：値を保存していないため、入力できません。
 * @param {Flow} flow
 * @returns {string[]} 理由。定期実行できる場合は空の配列
 */
export function schedulingProblems(flow) {
  /** @type {string[]} */
  const problems = [];
  for (const param of flow.params ?? []) {
    if (param.default === undefined || param.default === '') {
      problems.push(`パラメータ「${param.label}」に既定値がありません。`);
    }
  }
  const secrets = flattenSteps(flow.steps).filter(
    ({ step }) => step.type === 'input' && step.secret,
  );
  for (const { step, number } of secrets) {
    const label = step.type === 'input' ? step.target.label : '';
    problems.push(`手順 ${number + 1}（${label}）は、実行のたびに値を入力する欄です。`);
  }
  return problems;
}

/**
 * 予約の時刻の時と分です。
 * @param {ScheduleSetting} setting
 * @returns {[number, number]}
 */
function timeOf(setting) {
  const [hours, minutes] = setting.time.split(':').map(Number);
  return [hours, minutes];
}

/**
 * 年と月（0 から数えます）の日数です。
 * @param {number} year
 * @param {number} month
 * @returns {number}
 */
function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * 指定した日（年・月・日）の予約の日時です。その日に予約がない場合は null です。
 * @param {ScheduleSetting} setting
 * @param {number} year
 * @param {number} month 0 から数えます
 * @param {number} date
 * @returns {Date | null}
 */
function occurrenceOn(setting, year, month, date) {
  const [hours, minutes] = timeOf(setting);
  const at = new Date(year, month, date, hours, minutes);
  switch (setting.frequency) {
    case 'daily':
      return at;
    case 'weekly':
      return at.getDay() === setting.weekday ? at : null;
    case 'monthly': {
      const last = daysInMonth(at.getFullYear(), at.getMonth());
      return at.getDate() === Math.min(setting.day ?? 1, last) ? at : null;
    }
    default:
      return null;
  }
}

/** 予約の日時を探す日数の上限です。毎月の予約でも 2 か月以内に必ず見つかります。 */
const SEARCH_DAYS = 62;

/**
 * 指定した日時より後の、最初の予約の日時です。
 * @param {ScheduleSetting} setting
 * @param {Date} after
 * @returns {Date}
 */
export function nextRunAt(setting, after) {
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const at = occurrenceOn(
      setting,
      after.getFullYear(),
      after.getMonth(),
      after.getDate() + offset,
    );
    if (at && at > after) {
      return at;
    }
  }
  throw new Error('次の予約の日時が見つかりませんでした。');
}

/**
 * 指定した日時以前の、最後の予約の日時です。
 * @param {ScheduleSetting} setting
 * @param {Date} atOrBefore
 * @returns {Date}
 */
export function previousRunAt(setting, atOrBefore) {
  for (let offset = 0; offset <= SEARCH_DAYS; offset += 1) {
    const at = occurrenceOn(
      setting,
      atOrBefore.getFullYear(),
      atOrBefore.getMonth(),
      atOrBefore.getDate() - offset,
    );
    if (at && at <= atOrBefore) {
      return at;
    }
  }
  throw new Error('前の予約の日時が見つかりませんでした。');
}

/**
 * 処理していない予約の日時を返します。予約の日時を過ぎていない場合は null です。
 * 複数回分を処理していない場合も、最後の 1 回分だけを返します。取りこぼしの実行は 1 回だけとするためです。
 * late は、予約の日時から ON_TIME_MS より遅れていることを示します（取りこぼし）。
 * @param {Schedule} schedule
 * @param {Date} now
 * @returns {{ at: Date, late: boolean } | null}
 */
export function dueOccurrence(schedule, now) {
  const at = previousRunAt(schedule, now);
  const handled = new Date(schedule.lastScheduledAt ?? schedule.createdAt);
  if (!(at > handled)) {
    return null;
  }
  return { at, late: now.getTime() - at.getTime() > ON_TIME_MS };
}

/**
 * 予約の日時になったときに実行するかを判定します。取りこぼしの実行がオフの場合、遅れた予約は実行しません。
 * @param {Schedule} schedule
 * @param {{ late: boolean }} due
 * @returns {boolean}
 */
export function shouldRun(schedule, due) {
  return !due.late || schedule.catchUp;
}

/**
 * 待っている定期実行のうち、今始められる最初のものを返します。同じサイトの実行（一時停止中を含む）と、
 * 終わっていない一括実行のサイトは、使用中として扱います（batchConflicts と同じ規則です）。
 * @param {WaitingRun[]} waiting 待っている順
 * @param {{ origin: string, flowName: string, status: string }[]} runs 実行の状態
 * @param {BatchRun[]} batches 一括実行の状態
 * @returns {WaitingRun | undefined}
 */
export function pickWaiting(waiting, runs, batches) {
  return waiting.find((entry) => batchConflicts([entry.origin], runs, batches).length === 0);
}

/**
 * 予約の設定を、画面に表示する文にします。例：毎月 1 日 9:00
 * @param {ScheduleSetting} setting
 * @returns {string}
 */
export function describeSchedule(setting) {
  const [hours, minutes] = timeOf(setting);
  const time = `${hours}:${String(minutes).padStart(2, '0')}`;
  switch (setting.frequency) {
    case 'daily':
      return `毎日 ${time}`;
    case 'weekly':
      return `毎週 ${WEEKDAY_NAMES[setting.weekday ?? 0]}曜日 ${time}`;
    case 'monthly':
      return `毎月 ${setting.day} 日 ${time}`;
    default:
      return '';
  }
}

/**
 * 予約の日時を、画面と通知に表示する文にします。例：10月1日（水）9:00
 * @param {Date} date
 * @returns {string}
 */
export function formatRunAt(date) {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAY_NAMES[date.getDay()]}）${date.getHours()}:${minutes}`;
}

/**
 * 画面の入力欄の値を、予約の設定にします。周期が「なし」の場合は setting が null です（予約の解除）。
 * @param {{ frequency: string, weekday: string, day: string, time: string, catchUp: boolean }} input
 * @returns {{ ok: true, setting: ScheduleSetting | null }
 *   | { ok: false, field: 'day' | 'time', error: string }}
 */
export function readScheduleInput(input) {
  if (input.frequency === '') {
    return { ok: true, setting: null };
  }
  const frequency = /** @type {ScheduleSetting['frequency']} */ (input.frequency);
  const day = input.day.trim() === '' ? NaN : Number(input.day.trim());
  if (frequency === 'monthly' && !(Number.isInteger(day) && day >= 1 && day <= 31)) {
    return { ok: false, field: 'day', error: '日は 1〜31 の整数で入力してください。' };
  }
  if (!TIME_PATTERN.test(input.time)) {
    return { ok: false, field: 'time', error: '時刻を入力してください。' };
  }
  /** @type {ScheduleSetting} */
  const setting = {
    frequency,
    ...(frequency === 'weekly' ? { weekday: Number(input.weekday) } : {}),
    ...(frequency === 'monthly' ? { day } : {}),
    time: input.time,
    catchUp: input.catchUp,
  };
  return { ok: true, setting };
}
