// まとめフロー（複数のフローの一括実行、#7）の実行を管理します。
//
// どのフローを次に始めるかは shared/batch.js の関数で決め、各フローの実行は runner.js の startRun に任せます。
// 各フローが終わったとき、［確認済み・次へ］［中止］を押されたときに、次に始めるフローを決め直します。
//
// 一括実行の状態は chrome.storage.session に保存し、サイドパネルが表示します。入力した値（パスワードを
// 含む）は、runner.js と同じく、このファイルの変数にだけ置き、保存しません。そのため Service Worker が
// 途中で停止した場合、残りのフローは始めず、「未実行」として記録します。

import { getBatch } from '../common/batch-store.js';
import { getFlow } from '../common/flow-store.js';
import {
  BATCH_RUN_KEY_PREFIX,
  abortItem,
  acknowledgeItem,
  batchConflictMessage,
  batchConflicts,
  batchProblems,
  batchRunsFrom,
  expireHeld,
  finishItem,
  isBatchFinished,
  nextToStart,
  skipWaiting,
} from '../shared/batch.js';
import { flowOrigins, validateFlow, withMinimumInterval } from '../shared/flow.js';
import {
  activeRunOrigins,
  getRunState,
  listRunStates,
  requestStop,
  resolveSteps,
  startRun,
} from './runner.js';

/** @typedef {import('../shared/batch.js').BatchRun} BatchRun */

/**
 * フローごとの、実行する値です。キーはフローの id です。
 * @typedef {Record<string, { params: Record<string, string>, secrets: Record<string, string> }>} BatchInputs
 */

/**
 * この Service Worker で進めている一括実行です。状態の正本はこの変数で、変えるたびに
 * chrome.storage.session に書き込みます。Service Worker が停止すると失われるため、中断の判定にも使います。
 * @type {Map<string, BatchRun>}
 */
const batches = new Map();

/**
 * 一括実行ごとの、実行する値です。保存しません。
 * @type {Map<string, BatchInputs>}
 */
const batchInputs = new Map();

/**
 * 一括実行ごとの、処理の順番待ちです。状態を読んで書き換える処理を 1 つずつ行い、
 * 同じフローを 2 回始めることや、更新が失われることを防ぎます。
 * @type {Map<string, Promise<void>>}
 */
const queues = new Map();

/** 一括実行が残っている間、Service Worker が停止しないよう問い合わせを続けているかです。 */
let keepingAlive = false;

/** 問い合わせの間隔です。Chrome は、拡張機能の API を 30 秒呼ばないと Service Worker を停止します。 */
const KEEP_ALIVE_INTERVAL_MS = 20_000;

/** Service Worker が停止したため、始めなかったフローの理由です。 */
const INTERRUPTED_NOTE = '拡張機能の処理が途中で停止したため、実行しませんでした。';

/**
 * 一括実行を始めます。1 件でも始められない理由があれば、どのフローも始めません。
 * @param {string} batchId
 * @param {BatchInputs} inputs
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function startBatch(batchId, inputs) {
  const batch = await getBatch(batchId);
  if (!batch) {
    return { ok: false, error: 'まとめフローが見つかりません。' };
  }
  const stored = await Promise.all(batch.flowIds.map((id) => getFlow(id)));
  const flows = stored.flatMap((entry) => (entry ? [entry] : []));
  const problems = batchProblems(batch.flowIds, flows);
  if (problems.length > 0) {
    return { ok: false, error: problems.join('\n') };
  }

  // 値の誤りは、どのフローも始める前に確かめます。途中のフローだけが始まらない状態を避けるためです。
  const now = new Date();
  /** @type {string[]} */
  const errors = [];
  for (const { id, flow } of flows) {
    // 手順の間隔が下限より短いフロー（#110）は、下限として実行します。
    const formatErrors = validateFlow(withMinimumInterval(flow));
    if (formatErrors.length > 0) {
      errors.push(`「${flow.name}」の形式に誤りがあります：${formatErrors.join(' ')}`);
      continue;
    }
    const input = inputs[id] ?? { params: {}, secrets: {} };
    const resolved = resolveSteps(flow, input.params, input.secrets, now);
    if (!resolved.ok) {
      errors.push(`「${flow.name}」：${resolved.error}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, error: errors.join('\n') };
  }
  const origins = [...new Set(flows.flatMap(({ flow }) => flowOrigins(flow)))];
  if (!(await chrome.permissions.contains({ origins: origins.map((origin) => `${origin}/*`) }))) {
    return { ok: false, error: `${origins.join('、')} を操作する許可がありません。` };
  }

  // 比べてから登録するまでの間に await を置かないでください。同じサイトの実行を同時に始めないためです。
  const runs = [
    ...(await listRunStates()),
    ...activeRunOrigins().map((origin) => ({ origin, flowName: '別のフロー', status: 'running' })),
  ];
  const conflicts = batchConflicts(
    flows.map(({ flow }) => flow.origin),
    runs,
    [...batches.values()],
  );
  if (conflicts.length > 0) {
    return { ok: false, error: batchConflictMessage(conflicts) };
  }
  const batchRunId = crypto.randomUUID();
  batches.set(batchRunId, {
    batchRunId,
    batchId,
    name: batch.name,
    startedAt: now.toISOString(),
    items: flows.map(({ id, flow }) => ({
      flowId: id,
      flowName: flow.name,
      origin: flow.origin,
      status: 'waiting',
    })),
  });
  batchInputs.set(batchRunId, inputs);
  keepAlive();
  await enqueue(batchRunId, () => advance(batchRunId));
  return { ok: true };
}

/**
 * ［確認済み・次へ］です。確定の手前で止まったフローを完了にし、同じサイトの次のフローを始めます。
 * @param {string} batchRunId
 * @param {number} index
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function acknowledgeBatchItem(batchRunId, index) {
  /** @type {{ ok: true } | { ok: false, error: string }} */
  let result = { ok: false, error: notRunningError() };
  await enqueue(batchRunId, async () => {
    const batch = batches.get(batchRunId);
    if (!batch) {
      return;
    }
    const acknowledged = acknowledgeItem(batch.items, index);
    if (!acknowledged.ok) {
      result = acknowledged;
      return;
    }
    batch.items = acknowledged.items;
    result = { ok: true };
    await advance(batchRunId);
  });
  return result;
}

/**
 * フロー 1 件の［中止］です。実行中のフローは停止を求めます。まだ始めていないフローと、確定の手前で
 * 止まったフローは、同じサイトの後のフローとともに始めないことにします。
 * @param {string} batchRunId
 * @param {number} index
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function abortBatchItem(batchRunId, index) {
  /** @type {{ ok: true } | { ok: false, error: string }} */
  let result = { ok: false, error: notRunningError() };
  await enqueue(batchRunId, async () => {
    const batch = batches.get(batchRunId);
    const item = batch?.items[index];
    if (!batch || !item) {
      return;
    }
    result = { ok: true };
    if (item.status === 'running' && item.runId) {
      // 実行が終わったときに onRunEnded で「中止」にし、同じサイトの後のフローを「未実行」にします。
      await requestStop(item.runId);
      return;
    }
    batch.items = abortItem(batch.items, index);
    await advance(batchRunId);
  });
  return result;
}

/**
 * 一括実行の［すべて中止］です。実行中のフローは停止を求め、まだ始めていないフローは「未実行」にします。
 * @param {string} batchRunId
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function abortBatch(batchRunId) {
  /** @type {{ ok: true } | { ok: false, error: string }} */
  let result = { ok: false, error: notRunningError() };
  await enqueue(batchRunId, async () => {
    const batch = batches.get(batchRunId);
    if (!batch) {
      return;
    }
    result = { ok: true };
    batch.items = skipWaiting(batch.items, '中止しました。');
    for (const item of batch.items) {
      if (item.status === 'running' && item.runId) {
        await requestStop(item.runId);
      }
    }
    await advance(batchRunId);
  });
  return result;
}

/**
 * すべての一括実行の、まだ始めていないフローを「未実行」にします。緊急停止のキー（#18）で使います。
 * 実行中のフローは、runner.js の requestStopAll で停止します。
 * @returns {Promise<void>}
 */
export async function abortAllBatches() {
  await Promise.all(
    [...batches.keys()].map((batchRunId) =>
      enqueue(batchRunId, async () => {
        const batch = batches.get(batchRunId);
        if (batch) {
          batch.items = skipWaiting(batch.items, '緊急停止のため、実行しませんでした。');
          await advance(batchRunId);
        }
      }),
    ),
  );
}

/**
 * Service Worker の起動時に呼び出します。終わっていない一括実行は、前の Service Worker が途中で
 * 停止したことを示すため、残りのフローを「未実行」にします。
 * @returns {Promise<void>}
 */
export async function markInterruptedBatches() {
  for (const batch of batchRunsFrom(await chrome.storage.session.get(null))) {
    if (batches.has(batch.batchRunId) || isBatchFinished(batch.items)) {
      continue;
    }
    // 実行中だったフローの実行は、runner.js の markInterruptedRuns が中断として記録します。
    const items = skipWaiting(batch.items, INTERRUPTED_NOTE).map((item) =>
      item.status === 'running'
        ? { ...item, status: /** @type {const} */ ('failed'), note: INTERRUPTED_NOTE }
        : item,
    );
    await chrome.storage.session.set({
      [BATCH_RUN_KEY_PREFIX + batch.batchRunId]: { ...batch, items },
    });
  }
}

/**
 * 始めたフローの実行が終わったときの処理です。実行の結果を一括実行の状態に反映し、次のフローを始めます。
 * @param {string} batchRunId
 * @param {string} runId
 */
function onRunEnded(batchRunId, runId) {
  enqueue(batchRunId, async () => {
    const batch = batches.get(batchRunId);
    const index = batch?.items.findIndex((item) => item.runId === runId) ?? -1;
    if (!batch || index < 0) {
      return;
    }
    const state = await getRunState(runId);
    batch.items = finishItem(
      batch.items,
      index,
      state?.status ?? 'failed',
      state?.error,
      new Date(),
    );
    await advance(batchRunId);
  }).catch((error) => console.error('一括実行を続けられませんでした。', error));
}

/**
 * 次に始めるフローを始め、状態を保存します。始められなかったフローは失敗として扱い、次を決め直します。
 * 終わった一括実行は、この Service Worker の変数から外します（表示のため、保存した状態は残します）。
 * enqueue の中から呼び出します。
 * @param {string} batchRunId
 * @returns {Promise<void>}
 */
async function advance(batchRunId) {
  const batch = batches.get(batchRunId);
  if (!batch) {
    return;
  }
  const inputs = batchInputs.get(batchRunId) ?? {};
  for (
    let starts = nextToStart(batch.items);
    starts.length > 0;
    starts = nextToStart(batch.items)
  ) {
    for (const index of starts) {
      batch.items[index] = { ...batch.items[index], status: 'running' };
    }
    await save(batch);
    for (const index of starts) {
      const item = batch.items[index];
      const input = inputs[item.flowId] ?? { params: {}, secrets: {} };
      const result = await startRun(item.flowId, input.params, input.secrets, {
        active: false,
        onEnd: (runId) => onRunEnded(batchRunId, runId),
      });
      batch.items = result.ok
        ? batch.items.map((other, i) => (i === index ? { ...other, runId: result.runId } : other))
        : finishItem(batch.items, index, 'failed', result.error, new Date());
    }
  }
  await save(batch);
  if (isBatchFinished(batch.items)) {
    batches.delete(batchRunId);
    batchInputs.delete(batchRunId);
  }
}

/**
 * 一括実行の状態を保存します。
 * @param {BatchRun} batch
 * @returns {Promise<void>}
 */
async function save(batch) {
  await chrome.storage.session.set({ [BATCH_RUN_KEY_PREFIX + batch.batchRunId]: batch });
}

/**
 * 一括実行ごとに、処理を 1 つずつ行います。
 * @param {string} batchRunId
 * @param {() => Promise<void>} task
 * @returns {Promise<void>}
 */
function enqueue(batchRunId, task) {
  const previous = queues.get(batchRunId) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(
    batchRunId,
    next.catch(() => {}),
  );
  next
    .finally(() => {
      if (queues.get(batchRunId) === next) {
        queues.delete(batchRunId);
      }
    })
    .catch(() => {});
  return next;
}

/**
 * 一括実行が残っている間、Service Worker が停止しないよう、chrome.storage を定期的に読みます。
 * ［確認済み・次へ］を待っている間は実行中のフローがなく、Service Worker が停止すると入力した値が
 * 失われるためです。あわせて、上限の時間まで［確認済み・次へ］を押されなかったフローを扱います。
 */
function keepAlive() {
  if (keepingAlive) {
    return;
  }
  keepingAlive = true;
  (async () => {
    while (batches.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, KEEP_ALIVE_INTERVAL_MS));
      await chrome.storage.session.get(BATCH_RUN_KEY_PREFIX);
      for (const batchRunId of [...batches.keys()]) {
        await enqueue(batchRunId, async () => {
          const batch = batches.get(batchRunId);
          if (!batch) {
            return;
          }
          const items = expireHeld(batch.items, new Date());
          if (items !== batch.items) {
            batch.items = items;
            await advance(batchRunId);
          }
        });
      }
    }
  })()
    .catch((error) => console.error('一括実行の確認に失敗しました。', error))
    .finally(() => {
      keepingAlive = false;
      // 確かめ終えた直後に始まった一括実行があれば、続けて確かめます。
      if (batches.size > 0) {
        keepAlive();
      }
    });
}

/** @returns {string} */
function notRunningError() {
  return 'この一括実行は終わっているか、拡張機能の処理が途中で停止したため、操作できません。';
}
