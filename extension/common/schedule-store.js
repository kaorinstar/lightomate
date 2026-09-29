// 定期実行（#22）の予約の読み書きです。Service Worker と拡張機能の画面から使います。
//
// 予約は chrome.storage.local の schedules に、フローの ID をキーとして保存します。フロー定義
// （docs/flow-format.md）には含めません。予約を変えると、Service Worker が chrome.storage.onChanged で
// 受け取り、chrome.alarms の予約をやり直します（background/scheduler.js）。

import { validateScheduleSetting } from '../shared/schedule.js';

/** @typedef {import('../shared/schedule.js').Schedule} Schedule */
/** @typedef {import('../shared/schedule.js').ScheduleSetting} ScheduleSetting */

/** chrome.storage.local に予約を保存するキーです。 */
export const SCHEDULES_KEY = 'schedules';

/**
 * 保存した予約の一覧です。キーはフローの ID です。
 * @returns {Promise<Record<string, Schedule>>}
 */
export async function listSchedules() {
  const stored = await chrome.storage.local.get(SCHEDULES_KEY);
  return /** @type {Record<string, Schedule>} */ (stored[SCHEDULES_KEY] ?? {});
}

/**
 * @param {Record<string, Schedule>} schedules
 * @returns {Promise<void>}
 */
async function writeAll(schedules) {
  await chrome.storage.local.set({ [SCHEDULES_KEY]: schedules });
}

/**
 * フローの予約を保存します。設定した日時より前の予約の日時は、取りこぼしとして扱いません。
 * 定期実行できるフローか（schedulingProblems）は、呼び出す側で確かめます。
 * @param {string} flowId
 * @param {ScheduleSetting} setting
 * @param {Date} now
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function saveSchedule(flowId, setting, now) {
  const errors = validateScheduleSetting(setting);
  if (errors.length > 0) {
    return { ok: false, error: errors.join(' ') };
  }
  const all = await listSchedules();
  /** @type {Schedule} */
  const schedule = {
    frequency: setting.frequency,
    ...(setting.frequency === 'weekly' ? { weekday: setting.weekday } : {}),
    ...(setting.frequency === 'monthly' ? { day: setting.day } : {}),
    time: setting.time,
    catchUp: setting.catchUp,
    createdAt: now.toISOString(),
  };
  await writeAll({ ...all, [flowId]: schedule });
  return { ok: true };
}

/**
 * フローの予約を削除します。予約がない場合は何もしません。
 * @param {string} flowId
 * @returns {Promise<void>}
 */
export async function removeSchedule(flowId) {
  const all = await listSchedules();
  if (Object.hasOwn(all, flowId)) {
    delete all[flowId];
    await writeAll(all);
  }
}

/**
 * 予約の日時を処理したことを記録します。同じ予約の日時を 2 回実行しないために使います。
 * @param {string} flowId
 * @param {Date} scheduledAt
 * @returns {Promise<void>}
 */
export async function markScheduled(flowId, scheduledAt) {
  const all = await listSchedules();
  const schedule = all[flowId];
  if (schedule) {
    await writeAll({
      ...all,
      [flowId]: { ...schedule, lastScheduledAt: scheduledAt.toISOString() },
    });
  }
}
