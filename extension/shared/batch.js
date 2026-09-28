// まとめフロー（複数のフローの一括実行、#7）の判定です。chrome.* は使いません。
//
// まとめフローに含めたフローは、それぞれ新しいタブで実行します。
// - 別のサイトのフローは、BATCH_MAX_PARALLEL 件まで並行して実行します。
// - 同じサイト（フローの origin）のフローは、登録した順に 1 件ずつ実行します。同じ Chrome では、
//   同じサイトのログイン状態とカートの中身をタブの間で共有するためです（#32）。
// - 同じサイトの前のフローが確定ボタンの手前などで止まった場合（held）は、人が［確認済み・次へ］を
//   押すまで次のフローを始めません。人が確定を済ませる前に次のフローがカートを操作しないためです。
// - 同じサイトの前のフローが失敗・中止した場合は、そのサイトの残りのフローを始めません（skipped）。

/**
 * 一括実行の中の、フロー 1 件の状態です。
 * - waiting：まだ始めていない
 * - running：実行中（一時停止中を含む）
 * - held：確定ボタンの手前、または最後の一時停止の手順で実行を終え、人の操作を待っている
 * - done：完了。held の後に［確認済み・次へ］を押された場合も done にします
 * - failed：失敗、または始められなかった
 * - stopped：実行中に中止された
 * - skipped：始めなかった（未実行）
 * @typedef {'waiting' | 'running' | 'held' | 'done' | 'failed' | 'stopped' | 'skipped'} BatchItemStatus
 */

/**
 * @typedef {object} BatchItem
 * @property {string} flowId
 * @property {string} flowName
 * @property {string} origin フローのオリジン。同じサイトかの判定に使います
 * @property {BatchItemStatus} status
 * @property {string} [runId] 実行を始めた場合の、実行の識別子
 * @property {string} [note] 失敗した理由と、始めなかった理由
 * @property {string} [heldAt] held になった日時（ISO 8601）。［確認済み・次へ］を待つ上限の判定に使います
 */

/**
 * 一括実行の状態です。chrome.storage.session に保存し、サイドパネルが表示します。値は含めません。
 * @typedef {object} BatchRun
 * @property {string} batchRunId 一括実行の識別子
 * @property {string} batchId まとめフローの識別子
 * @property {string} name まとめフローの名前
 * @property {string} startedAt
 * @property {BatchItem[]} items 登録した順のフロー
 */

/**
 * 判定に使う、保存したフローの項目です。
 * @typedef {object} BatchFlowEntry
 * @property {string} id
 * @property {{ name: string, origin: string, steps: { type: string }[] }} flow
 */

/** 別のサイトのフローを並行して実行する数の上限です。PC とサイトへの負荷を抑えるためです。 */
export const BATCH_MAX_PARALLEL = 3;

/** まとめフローに含められるフローの数の上限です。 */
export const BATCH_MAX_FLOWS = 20;

/** まとめフローの名前の長さの上限です。 */
export const BATCH_NAME_MAX_LENGTH = 200;

/**
 * ［確認済み・次へ］を待つ上限です。一時停止の上限（#37）と同じ 30 分です。
 * 待っている間は、入力した値を Service Worker に置いたまま、停止しないよう問い合わせを続けるためです。
 */
export const HELD_LIMIT_MS = 30 * 60_000;

/** 一括実行の状態を chrome.storage.session に保存するキーの先頭です。続けて一括実行の id を付けます。 */
export const BATCH_RUN_KEY_PREFIX = 'batch/';

/** 実行中と、人の操作を待っている状態です。 */
const UNFINISHED = ['waiting', 'running'];

/**
 * まとめフローとして保存・実行できるかを調べ、誤りの説明を返します。誤りがない場合は空の配列です。
 * @param {string[]} flowIds 登録した順のフローの id
 * @param {BatchFlowEntry[]} flows 保存済みのフロー
 * @returns {string[]}
 */
export function batchProblems(flowIds, flows) {
  if (flowIds.length < 2) {
    return ['まとめフローには、2 件以上のフローを選んでください。'];
  }
  if (flowIds.length > BATCH_MAX_FLOWS) {
    return [`まとめフローに含められるフローは ${BATCH_MAX_FLOWS} 件までです。`];
  }
  if (new Set(flowIds).size !== flowIds.length) {
    return ['同じフローを 2 回含めることはできません。'];
  }
  const byId = new Map(flows.map((stored) => [stored.id, stored]));
  /** @type {string[]} */
  const errors = [];
  const missing = flowIds.filter((id) => !byId.has(id)).length;
  if (missing > 0) {
    errors.push(
      `含めたフローのうち ${missing} 件が削除されています。まとめフローを削除し、登録し直してください。`,
    );
  }
  for (const id of flowIds) {
    const stored = byId.get(id);
    if (stored && stored.flow.steps[0]?.type !== 'navigate') {
      errors.push(
        `「${stored.flow.name}」は、最初の手順がページを開く手順ではないため、まとめて実行できません。`,
      );
    }
  }
  return errors;
}

/**
 * 次に始めるフローの番号（items の添字）を返します。
 * サイトごとに、終わっていない最初のフローだけを候補にし、並行して実行する数の上限まで選びます。
 * 同じサイトの前のフローが held、failed、stopped、skipped の場合は、そのサイトのフローを始めません。
 * @param {BatchItem[]} items
 * @returns {number[]}
 */
export function nextToStart(items) {
  let slots = BATCH_MAX_PARALLEL - items.filter((item) => item.status === 'running').length;
  /** @type {Set<string>} */
  const blocked = new Set();
  /** @type {number[]} */
  const starts = [];
  for (const [index, item] of items.entries()) {
    if (blocked.has(item.origin) || item.status === 'done') {
      continue;
    }
    blocked.add(item.origin);
    if (item.status === 'waiting' && slots > 0) {
      starts.push(index);
      slots -= 1;
    }
  }
  return starts;
}

/**
 * 実行が終わったフローの状態を、実行の結果から決めます。
 * 失敗・中止した場合は、同じサイトの残りのフローを「未実行」にします。
 * @param {BatchItem[]} items
 * @param {number} index 終わったフローの番号
 * @param {string} runStatus 実行の状態（RunState の status）
 * @param {string | undefined} error 失敗した理由
 * @param {Date} now
 * @returns {BatchItem[]}
 */
export function finishItem(items, index, runStatus, error, now) {
  const item = items[index];
  /** @type {BatchItem} */
  let finished;
  if (runStatus === 'done') {
    finished = { ...item, status: 'done' };
  } else if (runStatus === 'halted') {
    finished = { ...item, status: 'held', heldAt: now.toISOString() };
  } else if (runStatus === 'stopped') {
    finished = { ...item, status: 'stopped' };
  } else {
    finished = { ...item, status: 'failed', ...(error ? { note: error } : {}) };
  }
  const next = items.map((other, i) => (i === index ? finished : other));
  if (finished.status === 'failed') {
    return skipFollowers(
      next,
      index,
      `前の「${item.flowName}」が失敗したため、実行しませんでした。`,
    );
  }
  if (finished.status === 'stopped') {
    return skipFollowers(
      next,
      index,
      `前の「${item.flowName}」を中止したため、実行しませんでした。`,
    );
  }
  return next;
}

/**
 * 同じサイトの後のフローで、まだ始めていないものがあるかを返します。
 * held のフローに［確認済み・次へ］を表示するかの判定に使います。
 * @param {BatchItem[]} items
 * @param {number} index
 * @returns {boolean}
 */
export function hasWaitingFollower(items, index) {
  const origin = items[index]?.origin;
  return items.some((item, i) => i > index && item.origin === origin && item.status === 'waiting');
}

/**
 * ［確認済み・次へ］を押されたフローを完了にし、同じサイトの次のフローを始められるようにします。
 * @param {BatchItem[]} items
 * @param {number} index
 * @returns {{ ok: true, items: BatchItem[] } | { ok: false, error: string }}
 */
export function acknowledgeItem(items, index) {
  const item = items[index];
  if (item?.status !== 'held' || !hasWaitingFollower(items, index)) {
    return { ok: false, error: '次に実行するフローがないため、進められません。' };
  }
  return {
    ok: true,
    items: items.map((other, i) => (i === index ? { ...item, status: 'done' } : other)),
  };
}

/**
 * まだ始めていないフロー、または held のフローの［中止］です。まだ始めていないフローは「未実行」にし、
 * どちらの場合も、同じサイトの後のフローを「未実行」にします。実行中のフローは、実行の停止を求めた後、
 * 実行が終わったときに finishItem で扱うため、ここでは変えません。
 * @param {BatchItem[]} items
 * @param {number} index
 * @returns {BatchItem[]}
 */
export function abortItem(items, index) {
  const item = items[index];
  if (item?.status === 'waiting') {
    const next = items.map((other, i) =>
      i === index
        ? { ...other, status: /** @type {const} */ ('skipped'), note: '中止しました。' }
        : other,
    );
    return skipFollowers(
      next,
      index,
      `前の「${item.flowName}」を中止したため、実行しませんでした。`,
    );
  }
  if (item?.status === 'held') {
    return skipFollowers(
      items,
      index,
      `前の「${item.flowName}」で中止したため、実行しませんでした。`,
    );
  }
  return items;
}

/**
 * まだ始めていないフローを、すべて「未実行」にします。緊急停止（#18）と、Service Worker の停止の後に使います。
 * @param {BatchItem[]} items
 * @param {string} note 始めなかった理由
 * @returns {BatchItem[]}
 */
export function skipWaiting(items, note) {
  return items.map((item) =>
    item.status === 'waiting' ? { ...item, status: /** @type {const} */ ('skipped'), note } : item,
  );
}

/**
 * ［確認済み・次へ］を上限の時間まで押されなかった held のフローについて、同じサイトの後のフローを
 * 「未実行」にします。
 * @param {BatchItem[]} items
 * @param {Date} now
 * @returns {BatchItem[]}
 */
export function expireHeld(items, now) {
  let next = items;
  for (const [index, item] of items.entries()) {
    if (
      item.status === 'held' &&
      item.heldAt !== undefined &&
      now.getTime() - Date.parse(item.heldAt) >= HELD_LIMIT_MS &&
      hasWaitingFollower(next, index)
    ) {
      next = skipFollowers(
        next,
        index,
        `「${item.flowName}」の後、30 分以内に［確認済み・次へ］が押されなかったため、実行しませんでした。`,
      );
    }
  }
  return next;
}

/**
 * 一括実行が終わったか（まだ始めていないフローと、実行中のフローがないか）を返します。
 * held のフローは、後に同じサイトのフローを待っていなければ、終わったものとして扱います。
 * @param {BatchItem[]} items
 * @returns {boolean}
 */
export function isBatchFinished(items) {
  return items.every((item) => !UNFINISHED.includes(item.status));
}

/**
 * 一括実行を始める前に、同じサイトのフローが別に実行中でないかを調べます。
 * 実行中（一時停止中を含む）の実行と、ほかの一括実行でまだ終わっていないフロー（held で次を待っているものを含む）
 * を、実行中として扱います。重なっているサイトと、そのサイトで実行中のフロー名を返します。
 * @param {string[]} origins まとめフローに含めたフローのオリジン
 * @param {{ origin: string, flowName: string, status: string }[]} runs 実行の状態の一覧
 * @param {BatchRun[]} batches ほかの一括実行
 * @returns {{ origin: string, flowName: string }[]}
 */
export function batchConflicts(origins, runs, batches) {
  const busy = [
    ...runs.filter((run) => ['running', 'stopping', 'pausing', 'paused'].includes(run.status)),
    ...batches.flatMap((batch) =>
      batch.items.filter(
        (item, index) =>
          UNFINISHED.includes(item.status) ||
          (item.status === 'held' && hasWaitingFollower(batch.items, index)),
      ),
    ),
  ];
  /** @type {{ origin: string, flowName: string }[]} */
  const conflicts = [];
  for (const origin of new Set(origins)) {
    const run = busy.find((entry) => entry.origin === origin);
    if (run) {
      conflicts.push({ origin, flowName: run.flowName });
    }
  }
  return conflicts;
}

/**
 * 同じサイトのフローを実行中のため、一括実行を始められないことの説明です。
 * @param {{ origin: string, flowName: string }[]} conflicts batchConflicts の結果
 * @returns {string}
 */
export function batchConflictMessage(conflicts) {
  const lines = conflicts.map(({ origin, flowName }) => `・${origin}（「${flowName}」を実行中）`);
  return `次のサイトでフローを実行中のため、まとめて実行できません。同じサイトのフローは、同時に実行できません。実行が終わってから、もう一度実行してください。\n${lines.join('\n')}`;
}

/**
 * フロー 1 件の状態の表示です。実行中の場合は、実行の状態から一時停止中などを区別します。
 * @param {BatchItem} item
 * @param {{ status: string } | undefined} run そのフローの実行の状態
 * @returns {string}
 */
export function batchItemLabel(item, run) {
  switch (item.status) {
    case 'waiting':
      return '待機中';
    case 'running':
      if (run?.status === 'paused' || run?.status === 'pausing') {
        return '一時停止中';
      }
      return run?.status === 'stopping' ? '停止中' : '実行中';
    case 'held':
      return '確定の手前で停止';
    case 'done':
      return '完了';
    case 'failed':
      return '失敗';
    case 'stopped':
      return '中止';
    default:
      return '未実行';
  }
}

/**
 * chrome.storage.session の内容から、一括実行の状態だけを、始めた日時の古い順に取り出します。
 * @param {Record<string, unknown>} stored
 * @returns {BatchRun[]}
 */
export function batchRunsFrom(stored) {
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(BATCH_RUN_KEY_PREFIX))
    .map(([, value]) => /** @type {BatchRun} */ (value))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * 同じサイトの後のフローで、まだ始めていないものを「未実行」にします。
 * @param {BatchItem[]} items
 * @param {number} index
 * @param {string} note 始めなかった理由
 * @returns {BatchItem[]}
 */
function skipFollowers(items, index, note) {
  const origin = items[index].origin;
  return items.map((item, i) =>
    i > index && item.origin === origin && item.status === 'waiting'
      ? { ...item, status: /** @type {const} */ ('skipped'), note }
      : item,
  );
}
