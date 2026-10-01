// 定期実行（#22）です。予約の日時になったら、フローを背景のタブで実行し、通知で知らせます。
//
// - 予約は chrome.storage.local の schedules に保存し（common/schedule-store.js）、chrome.alarms で次の
//   予約の日時を予約します。chrome.alarms の予約は Chrome の再起動や拡張機能の更新で消える場合があるため、
//   Service Worker の起動のたびに、保存した予約から予約をやり直します。
// - 取りこぼし（Chrome を起動していない間に過ぎた予約）は、Service Worker の起動時に判定します。
// - 同じサイトの実行（手動の実行、一括実行、ほかの定期実行）が終わっていない場合は、終わるまで待ちます。
//   待っている定期実行は chrome.storage.session に保存し、Service Worker が停止しても失われないようにします。
// - 通知は chrome.notifications で、PC の中だけで表示します。外部には送信しません（#14）。

import { FLOWS_KEY, getFlow, listFlows } from '../common/flow-store.js';
import { addHistory } from '../common/history-store.js';
import {
  SCHEDULES_KEY,
  listSchedules,
  markScheduled,
  removeSchedule,
} from '../common/schedule-store.js';
import { BATCH_RUN_KEY_PREFIX, batchConflicts, batchRunsFrom } from '../shared/batch.js';
import { RUN_KEY_PREFIX } from '../shared/flow-list.js';
import {
  dueOccurrence,
  formatRunAt,
  nextRunAt,
  pickWaiting,
  schedulingProblems,
  shouldRun,
} from '../shared/schedule.js';
import { activeRunOrigins, listRunStates, onRunEnd, startRun } from './runner.js';

/** @typedef {import('../shared/schedule.js').WaitingRun} WaitingRun */
/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('./runner.js').RunState} RunState */

/** 予約ごとの chrome.alarms の名前の接頭辞です。後ろにフローの ID を付けます。 */
const ALARM_PREFIX = 'schedule/';

/**
 * 待っている定期実行があるあいだ、始められるかを確かめ直す chrome.alarms の名前です。
 * 実行の終わりを chrome.storage.onChanged で受け取れなかった場合に備えます。
 */
const WAITING_ALARM = 'schedule-waiting';

/** 待っている定期実行を保存する chrome.storage.session のキーです。 */
const WAITING_KEY = 'scheduleWaiting';

/** 実行が終わった状態です。 */
const FINISHED = ['done', 'failed', 'stopped', 'halted'];

/** 通知の題名です。 */
const TITLE = 'Lightomate の定期実行';

/**
 * 予約の処理の順番待ちです。予約を読んで書き換える処理を 1 つずつ行い、同じ予約を 2 回実行しないようにします。
 * @type {Promise<void>}
 */
let queue = Promise.resolve();

/**
 * @param {() => Promise<void>} task
 * @returns {Promise<void>}
 */
function enqueue(task) {
  const result = queue.then(task);
  queue = result.catch((error) => console.error('定期実行の処理に失敗しました。', error));
  return result;
}

/**
 * イベントの受け取りを登録し、予約をやり直します。Service Worker の最上位で呼び出します。
 */
export function registerScheduleEvents() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(ALARM_PREFIX)) {
      checkSchedules().catch(() => {});
    } else if (alarm.name === WAITING_ALARM) {
      startWaiting().catch(() => {});
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (SCHEDULES_KEY in changes || FLOWS_KEY in changes)) {
      checkSchedules().catch(() => {});
    }
    if (area !== 'session') {
      return;
    }
    let settled = false;
    for (const [key, change] of Object.entries(changes)) {
      if (key.startsWith(RUN_KEY_PREFIX)) {
        notifyRunChange(
          /** @type {RunState | undefined} */ (change.oldValue),
          /** @type {RunState | undefined} */ (change.newValue),
        );
        settled = true;
      } else if (key.startsWith(BATCH_RUN_KEY_PREFIX)) {
        settled = true;
      }
    }
    if (settled) {
      startWaiting().catch(() => {});
    }
  });

  // 実行が実行中の一覧（activeRunOrigins）から消えたときにも確かめ直します（#146）。状態の変化の知らせは、
  // 実行中の一覧から消える前に届くため、その時点では重なっていると判定され、待つ一覧に戻る場合があります。
  // この知らせがないと、次に確かめるのは 1 分ごとの alarm になり、最大で約 1 分遅れます。
  onRunEnd(() => {
    startWaiting().catch(() => {});
  });

  // Chrome の起動時にも Service Worker は起動しますが、念のため起動の知らせでも確かめます。
  chrome.runtime.onStartup.addListener(() => {
    checkSchedules().catch(() => {});
  });
  checkSchedules().catch(() => {});
}

/**
 * 予約をすべて確かめます。予約の日時を過ぎたものを実行し、次の予約の日時を chrome.alarms に予約します。
 * 削除したフローの予約は削除します。
 * @returns {Promise<void>}
 */
export function checkSchedules() {
  return enqueue(async () => {
    const schedules = await listSchedules();
    const flows = new Map((await listFlows()).map((stored) => [stored.id, stored.flow]));
    const now = new Date();
    for (const [flowId, schedule] of Object.entries(schedules)) {
      const flow = flows.get(flowId);
      if (!flow) {
        await removeSchedule(flowId);
        continue;
      }
      const due = dueOccurrence(schedule, now);
      if (due) {
        // 先に処理済みとして記録します。実行を始めた後に Service Worker が停止しても、2 回実行しないためです。
        await markScheduled(flowId, due.at);
        if (shouldRun(schedule, due)) {
          await requestRun(flowId, flow, due.at);
        }
      }
      await chrome.alarms.create(ALARM_PREFIX + flowId, {
        when: nextRunAt(schedule, now).getTime(),
      });
    }
    for (const alarm of await chrome.alarms.getAll()) {
      const flowId = alarm.name.slice(ALARM_PREFIX.length);
      if (alarm.name.startsWith(ALARM_PREFIX) && !Object.hasOwn(schedules, flowId)) {
        await chrome.alarms.clear(alarm.name);
      }
    }
  });
}

/**
 * 予約の日時になったフローを実行します。同じサイトの実行が終わっていない場合は、待つ一覧に加えます。
 * enqueue の中から呼び出します。
 * @param {string} flowId
 * @param {Flow} flow
 * @param {Date} scheduledAt
 * @returns {Promise<void>}
 */
async function requestRun(flowId, flow, scheduledAt) {
  const problems = schedulingProblems(flow);
  if (problems.length > 0) {
    await recordFailure(flowId, flow, `定期実行できないフローです。${problems.join(' ')}`);
    return;
  }
  const waiting = await listWaiting();
  if (waiting.some((entry) => entry.flowId === flowId)) {
    return;
  }
  if (await isBusy(flow.origin)) {
    await setWaiting([
      ...waiting,
      {
        flowId,
        flowName: flow.name,
        origin: flow.origin,
        scheduledAt: scheduledAt.toISOString(),
      },
    ]);
    notify(
      `wait/${flowId}`,
      `「${flow.name}」（${formatRunAt(scheduledAt)} の予約）は、同じサイトの実行が終わるまで待ちます。`,
    );
    return;
  }
  await start(flowId, flow, scheduledAt.toISOString());
}

/**
 * 定期実行を始めます。始められなかった場合は、失敗として通知し、実行履歴に記録します。
 * ただし、同じサイトの実行を始めたばかりで重なった場合は、待つ一覧に戻します。
 * @param {string} flowId
 * @param {Flow} flow
 * @param {string} scheduledAt 予約の日時（ISO 8601）
 * @returns {Promise<void>}
 */
async function start(flowId, flow, scheduledAt) {
  const result = await startRun(flowId, {}, {}, { active: false, trigger: 'schedule' });
  if (result.ok) {
    return;
  }
  if (activeRunOrigins().includes(flow.origin)) {
    await setWaiting([
      ...(await listWaiting()),
      { flowId, flowName: flow.name, origin: flow.origin, scheduledAt },
    ]);
    return;
  }
  await recordFailure(flowId, flow, result.error);
}

/**
 * 待っている定期実行のうち、始められるものを始めます。
 * @returns {Promise<void>}
 */
function startWaiting() {
  return enqueue(async () => {
    const waiting = await listWaiting();
    if (waiting.length === 0) {
      return;
    }
    const session = await chrome.storage.session.get(null);
    // 状態を保存した実行だけと比べます。終わった直後の実行は、この Service Worker の変数（activeRunOrigins）に
    // 少しの間残るため、含めると始められません。始めたばかりの実行と重なった場合は、start が待つ一覧に戻します。
    // 戻した場合も、終わった実行が変数から消えたときの知らせ（onRunEnd）で、もう一度確かめます（#146）。
    const next = pickWaiting(waiting, await listRunStates(), batchRunsFrom(session));
    if (!next) {
      return;
    }
    await setWaiting(waiting.filter((entry) => entry !== next));
    const stored = await getFlow(next.flowId);
    if (stored) {
      await start(next.flowId, stored.flow, next.scheduledAt);
    }
  });
}

/**
 * 実行の状態の一覧です。状態を保存する前の、この Service Worker で始めたばかりの実行も含みます。
 * @returns {Promise<{ origin: string, flowName: string, status: string }[]>}
 */
async function busyRuns() {
  return [
    ...(await listRunStates()),
    ...activeRunOrigins().map((origin) => ({ origin, flowName: '', status: 'running' })),
  ];
}

/**
 * 同じサイトの実行（一時停止中を含む）か、そのサイトのフローを含む終わっていない一括実行があるかです。
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
async function isBusy(origin) {
  const session = await chrome.storage.session.get(null);
  return batchConflicts([origin], await busyRuns(), batchRunsFrom(session)).length > 0;
}

/** @returns {Promise<WaitingRun[]>} */
async function listWaiting() {
  const stored = await chrome.storage.session.get(WAITING_KEY);
  return /** @type {WaitingRun[]} */ (stored[WAITING_KEY] ?? []);
}

/**
 * 待っている定期実行を保存します。ある間は、1 分ごとに始められるかを確かめ直します。
 * @param {WaitingRun[]} waiting
 * @returns {Promise<void>}
 */
async function setWaiting(waiting) {
  await chrome.storage.session.set({ [WAITING_KEY]: waiting });
  if (waiting.length > 0) {
    await chrome.alarms.create(WAITING_ALARM, { periodInMinutes: 1 });
  } else {
    await chrome.alarms.clear(WAITING_ALARM);
  }
}

/**
 * 始められなかった定期実行を、通知で知らせ、失敗として実行履歴に記録します。
 * @param {string} flowId
 * @param {Flow} flow
 * @param {string} reason
 * @returns {Promise<void>}
 */
async function recordFailure(flowId, flow, reason) {
  notify(`failed/${flowId}/${Date.now()}`, `「${flow.name}」を始められませんでした。${reason}`);
  const now = new Date().toISOString();
  await addHistory({
    runId: crypto.randomUUID(),
    flowId,
    flowName: flow.name,
    origin: flow.origin,
    startedAt: now,
    endedAt: now,
    status: 'failed',
    total: 0,
    reason,
    files: [],
    trigger: 'schedule',
  }).catch((error) => console.error('実行履歴を記録できませんでした。', error));
}

/**
 * 定期実行の状態が変わったときに、通知で知らせます。
 * @param {RunState | undefined} before
 * @param {RunState | undefined} after
 */
function notifyRunChange(before, after) {
  if (after?.trigger !== 'schedule' || before?.status === after.status) {
    return;
  }
  const name = `「${after.flowName}」`;
  const id = `run/${after.runId}/${after.status}`;
  if (before === undefined && after.status === 'running') {
    notify(id, `${name}を始めました。`);
    return;
  }
  switch (after.status) {
    case 'paused':
      // 一時停止の理由（ログインの画面など）は note にあります。
      notify(id, `${name}が一時停止しました。${after.note ?? ''}`.trim());
      return;
    case 'done':
      notify(id, `${name}が完了しました。`);
      return;
    case 'halted':
      notify(id, `${name}が確定の手前で止まりました。内容を確認してください。`);
      return;
    case 'failed':
      notify(id, `${name}が失敗しました。${after.error ?? ''}`.trim());
      return;
    case 'stopped':
      notify(id, `${name}を停止しました。`);
      return;
    default:
      if (FINISHED.includes(after.status)) {
        notify(id, `${name}が終わりました。`);
      }
  }
}

/**
 * 通知を表示します。
 * @param {string} id 通知の識別子
 * @param {string} message
 */
function notify(id, message) {
  chrome.notifications
    .create(id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: TITLE,
      message,
    })
    .catch((error) => console.error('通知を表示できませんでした。', error));
}
