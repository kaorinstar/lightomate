// フローの実行を管理します。
//
// 手順を 1 つずつ取り出し、ページの移動はこの Service Worker で行い、クリック・入力・選択は
// ページに読み込んだ content/runner.js に依頼します。
//
// 実行の状態（何番目の手順か、成功・失敗）は chrome.storage.session に保存し、サイドパネルが
// 表示します。入力した値（パスワードを含む）はこのファイルの変数にだけ置き、保存しません。
// そのため Service Worker が途中で停止した場合、実行は続けられず、中断として記録します。
//
// 別のサイトのフローは同時に実行できます。同じサイトのフローは同時に実行しません（#32）。
// 実行の状態は実行ごとに別のキー（run/<実行の id>）に保存し、ほかの実行の更新と競合しないようにします。

import { getFlow } from '../common/flow-store.js';
import { isWebUrl, validateFlow } from '../shared/flow.js';
import {
  RUN_KEY_PREFIX,
  conflictMessage,
  findConflictingRun,
  isActiveRun,
  runStatesFrom,
} from '../shared/flow-list.js';
import { renderTemplate, resolveParams } from '../shared/params.js';
import { confirmPauseNote, findConfirmText } from '../shared/purchase-guard.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('../shared/flow.js').Step} Step */

/**
 * 実行の状態です。サイドパネルが表示に使います。値は含めません。
 * @typedef {object} RunState
 * @property {string} runId 実行の識別子
 * @property {string} flowId
 * @property {string} flowName
 * @property {string} origin フローのオリジン。同じサイトの実行が重ならないかの判定に使います。
 * @property {number} tabId 実行しているタブ
 * @property {number} stepIndex 実行中の手順の番号（0 から数えます）。完了後は最後の手順の番号、
 *   失敗後は失敗した手順の番号、停止後は停止した時点で完了していた手順の数です。
 * @property {number} total 手順の数
 * @property {'running' | 'stopping' | 'done' | 'failed' | 'stopped' | 'halted'} status
 *   halted は、確定ボタンの手前、または一時停止の手順で実行を終えたことを示します（#29）。
 * @property {string} [error] 失敗した理由。halted の場合は、止まった理由の説明です。
 * @property {string} startedAt
 */

/** 要素が表示されるまで待つ上限です。 */
const ELEMENT_TIMEOUT_MS = 10_000;

/** ページの移動と読み込みを待つ上限です。 */
const NAVIGATION_TIMEOUT_MS = 30_000;

/** 手順と手順の間に空ける時間です。実行速度の設定（#15）ができるまでの仮の値です。 */
const STEP_INTERVAL_MS = 500;

/** 実行中のページへ読み込むスクリプトです。overlay.js と finder.js の関数を runner.js が使います。 */
const CONTENT_FILES = [
  'content/overlay.js',
  'content/finder.js',
  'content/element-text.js',
  'content/runner.js',
];

/** 停止の指示を確かめる間隔です。要素やページの読み込みを待っている間も、この間隔で確かめます。 */
const STOP_CHECK_INTERVAL_MS = 250;

/** サイドパネルから停止を指示されたことを示す誤りです。失敗ではなく停止として扱います。 */
class StopRequested extends Error {}

/**
 * 確定ボタンの手前、または一時停止の手順で実行を終えることを示すものです（#29）。
 * 失敗ではなく、以降の操作を人に任せる終わり方として扱います。
 */
class Halted extends Error {}

/**
 * この Service Worker で実行中の実行の id と、そのオリジンです。停止すると失われるため、
 * 中断の判定に使います。実行の状態を保存する前から登録し、同じサイトの実行を同時に始めないようにします。
 * @type {Map<string, string>}
 */
const activeRuns = new Map();

/**
 * @param {string} runId
 * @returns {Promise<RunState | undefined>}
 */
export async function getRunState(runId) {
  const key = RUN_KEY_PREFIX + runId;
  const stored = await chrome.storage.session.get(key);
  return /** @type {RunState | undefined} */ (stored[key]);
}

/**
 * 実行の状態の一覧を、始めた日時の古い順に返します。
 * @returns {Promise<RunState[]>}
 */
export async function listRunStates() {
  return /** @type {RunState[]} */ (runStatesFrom(await chrome.storage.session.get(null)));
}

/** @param {RunState} state */
async function setRunState(state) {
  await chrome.storage.session.set({ [RUN_KEY_PREFIX + state.runId]: state });
}

/**
 * 実行中の状態の一部を更新します。更新の直前に読み直し、サイドパネルからの停止の指示
 * （status が stopping）を上書きしないようにします。
 * @param {string} runId
 * @param {Partial<RunState>} update
 */
async function updateRunState(runId, update) {
  const state = await getRunState(runId);
  if (state) {
    await setRunState({ ...state, ...update });
  }
}

/**
 * Service Worker の起動時に呼び出します。実行中のまま残っている状態は、前の Service Worker が
 * 実行の途中で停止したことを示すため、中断として記録します。
 */
export async function markInterruptedRuns() {
  for (const state of await listRunStates()) {
    if (!activeRuns.has(state.runId) && isActiveRun(state)) {
      await setRunState({
        ...state,
        status: 'failed',
        error: '拡張機能の処理が途中で停止したため、実行を中断しました。',
      });
    }
  }
}

/**
 * フローの実行を始めます。実行は裏で続き、この関数はすぐに戻ります。
 * @param {string} flowId
 * @param {Record<string, string>} paramInput 入力フォームの値
 * @param {Record<string, string>} secretInput 値を記録していない入力欄の値（手順の番号ごと）
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function startRun(flowId, paramInput, secretInput) {
  const stored = await getFlow(flowId);
  if (!stored) {
    return { ok: false, error: 'フローが見つかりません。' };
  }
  const { flow } = stored;
  const errors = validateFlow(flow);
  if (errors.length > 0) {
    return { ok: false, error: `フローの形式に誤りがあります：${errors.join(' ')}` };
  }
  if (!(await chrome.permissions.contains({ origins: [`${flow.origin}/*`] }))) {
    return { ok: false, error: `${flow.origin} を操作する許可がありません。` };
  }

  const resolved = resolveSteps(flow, paramInput, secretInput, new Date());
  if (!resolved.ok) {
    return resolved;
  }

  // 保存した状態に加え、この Service Worker で始めたばかりの実行とも比べます。
  // 比べてから登録するまでの間に await を置かないでください。同じサイトの実行を同時に始めないためです。
  const conflict = findConflictingRun(flow.origin, [
    ...(await listRunStates()),
    ...[...activeRuns].map(([, origin]) => ({
      flowName: '',
      origin,
      status: 'running',
      startedAt: '',
    })),
  ]);
  if (conflict) {
    return { ok: false, error: conflictMessage(flow.origin, conflict.flowName) };
  }
  const runId = crypto.randomUUID();
  activeRuns.set(runId, flow.origin);

  try {
    const tabId = await openTab(flow, resolved.steps);
    await setRunState({
      runId,
      flowId,
      flowName: flow.name,
      origin: flow.origin,
      tabId,
      stepIndex: 0,
      total: resolved.steps.length,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    runSteps(flow, resolved.steps, tabId, runId).finally(() => {
      activeRuns.delete(runId);
    });
    return { ok: true };
  } catch (error) {
    activeRuns.delete(runId);
    return { ok: false, error: String(error) };
  }
}

/**
 * 実行の停止を求めます。実行中の手順が終わった時点で停止します。
 * @param {string} runId
 * @returns {Promise<void>}
 */
export async function requestStop(runId) {
  const state = await getRunState(runId);
  if (state?.status === 'running') {
    await setRunState({ ...state, status: 'stopping' });
  }
}

/**
 * パラメータの値を当てはめた手順を作ります。
 * @param {Flow} flow
 * @param {Record<string, string>} paramInput
 * @param {Record<string, string>} secretInput
 * @param {Date} now
 * @returns {{ ok: true, steps: Step[] } | { ok: false, error: string }}
 */
export function resolveSteps(flow, paramInput, secretInput, now) {
  const { values, errors } = resolveParams(flow.params ?? [], paramInput, now);
  if (errors.length > 0) {
    return { ok: false, error: errors.join(' ') };
  }

  /** @type {Step[]} */
  const steps = [];
  for (const [index, step] of flow.steps.entries()) {
    switch (step.type) {
      case 'navigate': {
        const url = renderTemplate(step.url, values);
        if (!isWebUrl(url) || new URL(url).origin !== flow.origin) {
          return {
            ok: false,
            error: `手順 ${index + 1} の移動先（${url}）が、フローのサイト（${flow.origin}）ではありません。`,
          };
        }
        steps.push({ ...step, url });
        break;
      }
      case 'input': {
        if (step.secret) {
          const value = secretInput[String(index)];
          if (!value) {
            return {
              ok: false,
              error: `手順 ${index + 1}（${step.target.label}）の値を入力してください。`,
            };
          }
          steps.push({ type: 'input', target: step.target, value });
        } else {
          steps.push({ ...step, value: renderTemplate(step.value ?? '', values) });
        }
        break;
      }
      case 'select':
        steps.push({ ...step, values: step.values.map((value) => renderTemplate(value, values)) });
        break;
      default:
        steps.push(step);
    }
  }
  return { ok: true, steps };
}

/**
 * 実行するタブを用意します。最初の手順がページを開く手順であれば、新しいタブで開きます。
 * そうでなければ、表示中のタブを使います。
 * @param {Flow} flow
 * @param {Step[]} steps
 * @returns {Promise<number>}
 */
async function openTab(flow, steps) {
  const first = steps[0];
  if (first?.type === 'navigate') {
    const tab = await chrome.tabs.create({ url: first.url, active: true });
    if (tab.id === undefined) {
      throw new Error('タブを開けませんでした。');
    }
    return tab.id;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || !tab.url || new URL(tab.url).origin !== flow.origin) {
    throw new Error(`${flow.origin} のページを表示してから実行してください。`);
  }
  return tab.id;
}

/**
 * 手順を順に実行します。
 * @param {Flow} flow
 * @param {Step[]} steps パラメータを当てはめた手順
 * @param {number} tabId
 * @param {string} runId
 */
async function runSteps(flow, steps, tabId, runId) {
  let index = 0;
  try {
    while (index < steps.length) {
      await throwIfStopRequested(runId);
      await updateRunState(runId, { stepIndex: index });
      // タブのページが移動すると、Chrome はそのタブ用のアイコンの文字を消します。手順ごとに設定し直します。
      await showRunBadge(tabId);

      const step = steps[index];
      if (step.type === 'navigate' && step.cause === 'page') {
        // ページの操作による移動は、直前のクリックなどの結果です。移動が終わるのを待ちます。
        // 転送が続く場合、途中のページを経ずに最後のページに着くことがあるため、
        // 続けて記録された移動のうち、どれかに着いた時点で、その手順まで進めます。
        index = await waitForPageNavigation(runId, tabId, steps, index);
      } else if (step.type === 'pause') {
        throw new Halted(step.note ?? '一時停止の手順です。以降の操作は手で行ってください。');
      } else if (step.type === 'navigate') {
        if (index > 0) {
          await chrome.tabs.update(tabId, { url: step.url });
        }
        await waitForLoad(runId, tabId, (url) => samePage(url, step.url), step.url);
      } else {
        await runInPage(runId, flow, tabId, step);
      }

      index += 1;
      await sleep(STEP_INTERVAL_MS);
    }
    await updateRunState(runId, { status: 'done', stepIndex: steps.length - 1 });
  } catch (error) {
    if (error instanceof StopRequested) {
      // stepIndex は、停止した時点で完了していた手順の数と同じです。
      await updateRunState(runId, { status: 'stopped', stepIndex: index });
      return;
    }
    if (error instanceof Halted) {
      await updateRunState(runId, { status: 'halted', stepIndex: index, error: error.message });
      return;
    }
    await updateRunState(runId, {
      status: 'failed',
      stepIndex: index,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    await chrome.tabs.sendMessage(tabId, { kind: 'runner/finish' }, { frameId: 0 }).catch(() => {});
  }
}

/**
 * 実行中であることを、ツールバーのアイコンに黄色の「RUN」で示します。
 * @param {number} tabId
 */
async function showRunBadge(tabId) {
  await chrome.action.setBadgeText({ tabId, text: 'RUN' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#fbbc04' });
  await chrome.action.setBadgeTextColor({ tabId, color: '#202124' });
}

/**
 * クリック・入力・選択を、ページの content script に依頼します。
 *
 * クリックは、先に対象の要素の文言を確かめます。確定ボタンであればクリックせずに実行を終えます（#29）。
 * 記録時の置き換えだけでは、JSON の直接編集で加えた手順を防げないためです。
 * @param {string} runId
 * @param {Flow} flow
 * @param {number} tabId
 * @param {Step} step
 */
async function runInPage(runId, flow, tabId, step) {
  await waitForLoad(runId, tabId, () => true, '');
  const tab = await chrome.tabs.get(tabId);
  // 別のサイトに移動していた場合は、入力値を別のサイトに入力しないよう停止します（#14）。
  if (!tab.url || new URL(tab.url).origin !== flow.origin) {
    throw new Error(`フローのサイト（${flow.origin}）とは別のページに移動したため、停止しました。`);
  }

  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: CONTENT_FILES });

  if (step.type === 'click') {
    const inspected = await requestPage(runId, tabId, {
      kind: 'runner/inspect',
      step,
      timeoutMs: ELEMENT_TIMEOUT_MS,
    });
    const texts = Array.isArray(inspected.texts)
      ? inspected.texts.filter((/** @type {unknown} */ text) => typeof text === 'string')
      : [];
    const confirmText = findConfirmText([
      ...texts,
      step.target.label,
      ...(step.target.text ? [step.target.text] : []),
    ]);
    if (confirmText !== undefined) {
      throw new Halted(confirmPauseNote(confirmText));
    }
  }
  await requestPage(runId, tabId, { kind: 'runner/step', step, timeoutMs: ELEMENT_TIMEOUT_MS });
}

/**
 * ページの content script に依頼し、応答を返します。応答が失敗を示す場合は例外を投げます。
 * @param {string} runId
 * @param {number} tabId
 * @param {object} message
 * @returns {Promise<Record<string, any>>}
 */
async function requestPage(runId, tabId, message) {
  // 要素を待っている間（最大 10 秒）も停止の指示に応じられるよう、応答を待ちながら指示を確かめます。
  const reply = chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).then(
    (response) => ({ response, error: undefined }),
    (error) => ({ response: undefined, error }),
  );
  let result;
  while (!(result = await Promise.race([reply, sleep(STOP_CHECK_INTERVAL_MS).then(() => null)]))) {
    try {
      await throwIfStopRequested(runId);
    } catch (error) {
      // ページで要素を待つ処理も止めます。
      await chrome.tabs
        .sendMessage(tabId, { kind: 'runner/abort' }, { frameId: 0 })
        .catch(() => {});
      throw error;
    }
  }
  if (result.error !== undefined) {
    throw new Error(`ページと通信できませんでした（${String(result.error)}）。`, {
      cause: result.error,
    });
  }
  const { response } = result;
  if (!response?.ok) {
    throw new Error(response?.error ?? 'ページから応答がありませんでした。');
  }
  return response;
}

/**
 * ページの操作による移動が終わるまで待ちます。
 * @param {string} runId
 * @param {number} tabId
 * @param {Step[]} steps
 * @param {number} index 待つ移動の手順の番号
 * @returns {Promise<number>} 着いたページの手順の番号
 */
async function waitForPageNavigation(runId, tabId, steps, index) {
  /** @type {{ index: number, url: string }[]} */
  const candidates = [];
  for (let i = index; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.type !== 'navigate' || step.cause !== 'page') {
      break;
    }
    candidates.push({ index: i, url: step.url });
  }

  let reached = index;
  await waitForLoad(
    runId,
    tabId,
    (url) => {
      const match = candidates.findLast((candidate) => samePage(url, candidate.url));
      if (match) {
        reached = match.index;
      }
      return Boolean(match);
    },
    candidates.map((candidate) => candidate.url).join(' または '),
  );
  return reached;
}

/**
 * タブの読み込みが終わり、表示中の URL が条件を満たすまで待ちます。
 * Service Worker は操作がない状態が約 30 秒続くと停止するため、イベントを待つのではなく、
 * 短い間隔でタブの状態を問い合わせます。問い合わせのたびに停止までの時間が延びます。
 * @param {string} runId
 * @param {number} tabId
 * @param {(url: string) => boolean} isExpected
 * @param {string} description 待っているページの説明（失敗時の表示に使います）
 */
async function waitForLoad(runId, tabId, isExpected, description) {
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  let lastUrl = '';
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error('実行中のタブが閉じられたため、停止しました。');
    }
    lastUrl = tab.url ?? tab.pendingUrl ?? '';
    if (tab.status === 'complete' && lastUrl && isExpected(lastUrl)) {
      return;
    }
    await throwIfStopRequested(runId);
    await sleep(STOP_CHECK_INTERVAL_MS);
  }
  throw new Error(
    description
      ? `${Math.round(NAVIGATION_TIMEOUT_MS / 1000)} 秒待ちましたが、想定したページ（${description}）に移動しませんでした。現在のページ：${lastUrl || '不明'}`
      : `${Math.round(NAVIGATION_TIMEOUT_MS / 1000)} 秒待ちましたが、ページの読み込みが終わりませんでした。`,
  );
}

/**
 * 同じページかを判定します。クエリ文字列（? 以降）とページ内の位置（# 以降）は比べません。
 * セッションの識別子など、実行のたびに変わる値が含まれることがあるためです。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function samePage(a, b) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return false;
  }
}

/**
 * サイドパネルから停止を指示されている場合に、StopRequested を投げます。
 * サイドパネルの［閉じる］などで実行の状態が消えている場合も、停止として扱います。
 * @param {string} runId
 */
async function throwIfStopRequested(runId) {
  const state = await getRunState(runId);
  if (!state || state.status === 'stopping') {
    throw new StopRequested('停止を指示されました。');
  }
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
