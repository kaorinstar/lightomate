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
import { addHistory } from '../common/history-store.js';
import { isWebUrl, validateFlow } from '../shared/flow.js';
import {
  RUN_KEY_PREFIX,
  conflictMessage,
  findConflictingRun,
  isActiveRun,
  runStatesFrom,
} from '../shared/flow-list.js';
import { historyEntryFromRun } from '../shared/history.js';
import { renderTemplate, resolveParams } from '../shared/params.js';
import { confirmPauseNote, findConfirmText } from '../shared/purchase-guard.js';
import { findStopPath, stopRuleNote } from '../shared/stop-rules.js';
import { DEFAULT_SAVE_PATH, buildSavePath, builtinValues } from '../shared/save-path.js';
import { pickDelay, stepInterval } from '../shared/speed.js';
import {
  AUTH_PAUSE_NOTE,
  MAX_RETRIES,
  authPauseNoteForPage,
  expectedPageUrl,
  isRetryableFailure,
  shouldPauseForAuth,
} from '../shared/run-guard.js';
import { getStopRule } from '../common/stop-rules-store.js';

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
 * @property {'running' | 'stopping' | 'pausing' | 'paused' | 'done' | 'failed' | 'stopped' | 'halted'} status
 *   pausing は［一時停止］を押され、実行中の手順が終わるのを待っている状態、paused は一時停止中です（#37）。
 *   一時停止中の stepIndex は、再開したときに実行する手順の番号です。
 *   halted は、確定ボタンの手前、または最後の一時停止の手順で実行を終えたことを示します（#29）。
 * @property {string} [error] 失敗した理由。halted の場合は、止まった理由の説明です。
 * @property {string} [note] 一時停止の手順で止まった場合の、その手順の説明（note）です。
 * @property {string} startedAt
 */

/** 要素が表示されるまで待つ上限です。 */
const ELEMENT_TIMEOUT_MS = 10_000;

/** ページの移動と読み込みを待つ上限です。 */
const NAVIGATION_TIMEOUT_MS = 30_000;

/** 実行中のページへ読み込むスクリプトです。overlay.js と finder.js の関数を runner.js が使います。 */
const CONTENT_FILES = [
  'content/overlay.js',
  'content/finder.js',
  'content/element-text.js',
  'content/runner.js',
];

/** PDF の保存（ダウンロード）が終わるのを待つ上限です。 */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** ページから読み取る文字の長さの上限です。保存先のファイル名に使うため、長すぎる値を切ります。 */
const EXTRACT_MAX_LENGTH = 200;

/** 停止の指示を確かめる間隔です。要素やページの読み込みを待っている間も、この間隔で確かめます。 */
const STOP_CHECK_INTERVAL_MS = 250;

/**
 * 一時停止を続けられる上限です（#37）。一時停止中は同じサイトのフローを実行できず、
 * Service Worker も止まらないよう問い合わせを続けるため、上限を設けます。
 */
const PAUSE_LIMIT_MS = 30 * 60_000;

/** 一時停止中と、確定ボタンの手前などで実行を終えた後の、ツールバーのアイコンの色です（#13、#37）。 */
const PAUSED_BADGE_COLOR = '#8e24aa';

/** サイドパネルから停止を指示されたことを示す誤りです。失敗ではなく停止として扱います。 */
class StopRequested extends Error {}

/**
 * 確定ボタンの手前、または一時停止の手順で実行を終えることを示すものです（#29）。
 * 失敗ではなく、以降の操作を人に任せる終わり方として扱います。
 */
class Halted extends Error {}

/**
 * ログインや認証の画面が表示されたため、手順を行わずに一時停止することを示すものです（#18）。
 * ［再開］を押されたら、resumeIndex の手順から続けます。クリックなどの手順は同じ手順からやり直し、
 * ページの移動の手順は、人が移動先の画面を表示した後の次の手順から続けます。
 */
class AuthRequired extends Error {
  /**
   * @param {string} message
   * @param {number} [resumeIndex] 再開したときに実行する手順の番号。省略した場合は同じ手順です
   */
  constructor(message, resumeIndex) {
    super(message);
    this.resumeIndex = resumeIndex;
  }
}

/** 手順の要素が見つからなかったことを示す誤りです。この失敗だけをやり直します（#18）。 */
class ElementNotFound extends Error {}

/**
 * この Service Worker で実行中の実行の id と、そのオリジンです。停止すると失われるため、
 * 中断の判定に使います。実行の状態を保存する前から登録し、同じサイトの実行を同時に始めないようにします。
 * @type {Map<string, string>}
 */
const activeRuns = new Map();

/**
 * 実行ごとの、実行履歴に残す前に伏せる値（入力した値と、そこから作った値）です（#19）。
 * このファイルの変数にだけ置き、保存しません。Service Worker が停止すると失われますが、
 * その場合の履歴は、値を含まない決まった文（中断）だけを記録します。
 * @type {Map<string, string[]>}
 */
const redactions = new Map();

/**
 * 実行ごとの、保存したファイルのパスです（#16）。実行が終わったときに実行履歴に記録します（#19）。
 * @type {Map<string, string[]>}
 */
const savedFiles = new Map();

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
 * 実行を終えた状態を保存し、実行履歴に記録します（#19）。
 * 止まった理由に含まれる入力した値は、履歴では伏せます。実行の状態（chrome.storage.session）には
 * 伏せずに残します。サイドパネルで、利用者が原因を確かめられるようにするためです。
 * @param {string} runId
 * @param {Partial<RunState>} update
 */
async function finishRun(runId, update) {
  await updateRunState(runId, update);
  const state = await getRunState(runId);
  const values = redactions.get(runId) ?? [];
  const files = savedFiles.get(runId) ?? [];
  redactions.delete(runId);
  savedFiles.delete(runId);
  const entry = state && historyEntryFromRun(state, new Date().toISOString(), values, files);
  if (entry) {
    await addHistory(entry).catch((error) =>
      console.error('実行履歴を記録できませんでした。', error),
    );
  }
}

/**
 * Service Worker の起動時に呼び出します。実行中のまま残っている状態は、前の Service Worker が
 * 実行の途中で停止したことを示すため、中断として記録します。
 */
export async function markInterruptedRuns() {
  for (const state of await listRunStates()) {
    if (!activeRuns.has(state.runId) && isActiveRun(state)) {
      await finishRun(state.runId, {
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

  const now = new Date();
  const resolved = resolveSteps(flow, paramInput, secretInput, now);
  if (!resolved.ok) {
    return resolved;
  }
  const paramValues = resolveParams(flow.params ?? [], paramInput, now).values;
  const values = [
    ...Object.values(paramInput),
    ...Object.values(secretInput),
    ...Object.values(paramValues),
  ];
  // PDF の保存先（#16）に埋め込む値です。ページから読み取った値は、実行中に加えます。
  // パスワードなど値を記録していない欄の値は、保存先に使えないよう含めません。
  const pathValues = { ...builtinValues(flow.name, flow.origin, now), ...paramValues };

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
  redactions.set(runId, values);
  savedFiles.set(runId, []);

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
    runSteps(flow, resolved.steps, tabId, runId, pathValues).finally(() => {
      activeRuns.delete(runId);
    });
    return { ok: true };
  } catch (error) {
    activeRuns.delete(runId);
    redactions.delete(runId);
    savedFiles.delete(runId);
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
  if (state && ['running', 'pausing', 'paused'].includes(state.status)) {
    await setRunState({ ...state, status: 'stopping' });
  }
}

/**
 * 実行中・一時停止中のすべての実行の停止を求めます（#18 の緊急停止のキー）。
 * @returns {Promise<number>} 停止を求めた実行の数
 */
export async function requestStopAll() {
  const running = (await listRunStates()).filter((state) =>
    ['running', 'pausing', 'paused'].includes(state.status),
  );
  await Promise.all(running.map((state) => requestStop(state.runId)));
  return running.length;
}

/**
 * 実行の一時停止を求めます（#37）。実行中の手順が終わった時点で一時停止します。
 * @param {string} runId
 * @returns {Promise<void>}
 */
export async function requestPause(runId) {
  const state = await getRunState(runId);
  if (state?.status === 'running') {
    await setRunState({ ...state, status: 'pausing' });
  }
}

/**
 * 一時停止中の実行を再開します（#37）。
 * タブが開いていて、フローのサイトのページを表示している場合に限り再開します。
 * 止まっている間に人が別のサイトへ移動した場合に、そのサイトで操作しないためです（#14）。
 * @param {string} runId
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function requestResume(runId) {
  const state = await getRunState(runId);
  if (state?.status !== 'paused') {
    return { ok: false, error: '一時停止中ではないため、再開できません。' };
  }
  if (!activeRuns.has(runId)) {
    return {
      ok: false,
      error: '拡張機能の処理が途中で停止したため、再開できません。［実行停止］を押してください。',
    };
  }
  let tab;
  try {
    tab = await chrome.tabs.get(state.tabId);
  } catch {
    return { ok: false, error: '実行していたタブが閉じられたため、再開できません。' };
  }
  const url = tab.url ?? '';
  if (!isWebUrl(url) || new URL(url).origin !== state.origin) {
    return {
      ok: false,
      error: `フローのサイト（${state.origin}）のページを表示してから、［再開］を押してください。`,
    };
  }
  await setRunState({ ...state, status: 'running', note: undefined });
  return { ok: true };
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
 * @param {Record<string, string>} pathValues PDF の保存先に埋め込む値。読み取った値を加えていきます
 */
async function runSteps(flow, steps, tabId, runId, pathValues) {
  let index = 0;
  /**
   * 直前の手順を始める前に表示していたページの識別子です。ページの操作による移動の手順で、
   * 新しいページに切り替わったかを判定するために使います（#51）。
   * @type {string | undefined}
   */
  let documentBefore;
  /** 実行を終えた後も、ページの枠とアイコンで「ここから手で操作する」ことを示すか（#13）。 */
  let handOver = false;
  try {
    while (index < steps.length) {
      await throwIfStopRequested(runId);
      if (await isPauseRequested(runId)) {
        await pauseRun(runId, flow, tabId, index);
      }
      await updateRunState(runId, { stepIndex: index });
      // タブのページが移動すると、Chrome はそのタブ用のアイコンの文字を消します。手順ごとに設定し直します。
      await showRunBadge(tabId);

      const step = steps[index];
      try {
        if (step.type === 'navigate' && step.cause === 'page') {
          // ページの操作による移動は、直前のクリックなどの結果です。新しいページの読み込みが
          // 終わるのを待ちます。移動先の URL は比べません。サイトが記録時と異なる画面に転送する
          // ことがあるためです（#51）。想定と異なるページに着いた場合は、次の手順の要素が
          // 見つからずに止まります。転送が続いて記録された移動は、まとめて 1 回の移動として扱います。
          await waitForNewPage(runId, tabId, documentBefore, step.url);
          index = lastPageNavigationIndex(steps, index);
          documentBefore = await getDocumentId(tabId);
          // ログインの有効期限切れなどで、認証の画面に転送されていないかを調べます（#18）。
          await checkAuthAfterNavigation(runId, flow, tabId, steps[index], index);
        } else if (step.type === 'wait') {
          await waitWithStopCheck(runId, step.ms);
        } else if (step.type === 'pause') {
          // 最後の手順の場合は、再開しても続ける手順がないため、これまでどおり実行を終えます。
          if (index === steps.length - 1) {
            throw new Halted(step.note ?? '一時停止の手順です。以降の操作は手で行ってください。');
          }
          // 止まる前のページの識別子（documentBefore）は変えません。止まっている間に人がページを
          // 移動していれば、次の「ページの操作による移動」の手順は待たずに進みます。
          index += 1;
          await pauseRun(runId, flow, tabId, index, step.note);
          continue;
        } else if (step.type === 'navigate') {
          const shownBefore = await getDocumentId(tabId);
          if (index > 0) {
            await chrome.tabs.update(tabId, { url: step.url });
          }
          // 移動先ではなく認証の画面に転送された場合は、30 秒待たずに一時停止します（#18）。
          // 移動する前から表示していたページは調べません。ログインの画面から移動する場合に、
          // 移動前のログインの画面で止まらないようにするためです。
          await waitForLoad(
            runId,
            tabId,
            (url) => samePage(url, step.url),
            step.url,
            (documentId) =>
              documentId === shownBefore && index > 0
                ? Promise.resolve()
                : checkAuthAfterNavigation(runId, flow, tabId, step, index),
          );
          documentBefore = await getDocumentId(tabId);
        } else if (step.type === 'savePdf') {
          await checkAuthScreen(runId, flow, tabId, step, expectedPageUrl(steps, index));
          const file = await savePdf(runId, flow, tabId, step, pathValues);
          savedFiles.get(runId)?.push(file);
          documentBefore = await getDocumentId(tabId);
        } else {
          const done = await runInPageWithRetry(
            runId,
            flow,
            tabId,
            step,
            expectedPageUrl(steps, index),
          );
          documentBefore = done.documentId;
          if (step.type === 'extract') {
            const text = typeof done.response.text === 'string' ? done.response.text : '';
            if (!text) {
              throw new Error(
                `「${step.target.label}」から文字を読み取れませんでした（空でした）。`,
              );
            }
            pathValues[step.name] = text.slice(0, EXTRACT_MAX_LENGTH);
            // 読み取った値は個人情報を含む場合があるため、実行履歴の理由には残しません。
            redactions.get(runId)?.push(pathValues[step.name]);
          }
        }
      } catch (error) {
        // ログインや認証の画面が表示された場合は、手順を行わずに一時停止します（#18）。
        // ［再開］を押されたら、同じ手順からやり直します。やり直す前に、もう一度画面を調べます。
        if (error instanceof AuthRequired) {
          index = error.resumeIndex ?? index;
          await pauseRun(runId, flow, tabId, index, error.message);
          continue;
        }
        throw error;
      }

      index += 1;
      // 手順と手順の間に、フローの設定の範囲から毎回決めた時間だけ待ちます（#15）。最後の手順の後には待ちません。
      if (index < steps.length) {
        await waitWithStopCheck(runId, pickDelay(stepInterval(flow)));
      }
    }
    await finishRun(runId, { status: 'done', stepIndex: steps.length - 1 });
  } catch (error) {
    if (error instanceof StopRequested) {
      // stepIndex は、停止した時点で完了していた手順の数と同じです。
      await finishRun(runId, { status: 'stopped', stepIndex: index });
      return;
    }
    if (error instanceof Halted) {
      handOver = true;
      await finishRun(runId, { status: 'halted', stepIndex: index, error: error.message });
      return;
    }
    await finishRun(runId, {
      status: 'failed',
      stepIndex: index,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (handOver) {
      // 確定ボタンの手前などで実行を終えた場合は、以降を人が操作することを示します（#13）。
      // タブのページが移動すると、Chrome がアイコンの文字を消し、枠も content script とともに消えます。
      await showWaitBadge(tabId).catch(() => {});
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    }
    await chrome.tabs
      .sendMessage(
        tabId,
        { kind: 'runner/finish', indicator: handOver ? 'handOver' : undefined },
        { frameId: 0 },
      )
      .catch(() => {});
  }
}

/**
 * 一時停止を求められているかを返します（#37）。
 * @param {string} runId
 * @returns {Promise<boolean>}
 */
async function isPauseRequested(runId) {
  return (await getRunState(runId))?.status === 'pausing';
}

/**
 * 実行を一時停止し、［再開］を押されるまで待ちます（#37）。
 *
 * 待っている間も短い間隔で実行の状態とタブを問い合わせます。拡張機能の API を呼ぶたびに
 * Service Worker の停止までの時間が数え直されるため、長い一時停止の間も停止しません。
 * 実行時に入力した値はこのファイルの変数にだけ置いているため、Service Worker が停止すると再開できません。
 * https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
 * @param {string} runId
 * @param {Flow} flow
 * @param {number} tabId
 * @param {number} nextIndex 再開したときに実行する手順の番号
 * @param {string} [note] 一時停止の手順の説明
 */
async function pauseRun(runId, flow, tabId, nextIndex, note) {
  await updateRunState(runId, { status: 'paused', stepIndex: nextIndex, note });
  const deadline = Date.now() + PAUSE_LIMIT_MS;
  /** 枠を表示したページの識別子です。人がページを移動したら、移動後のページに表示し直します。 */
  let shownDocument;
  for (;;) {
    const state = await getRunState(runId);
    if (!state || state.status === 'stopping') {
      throw new StopRequested('停止を指示されました。');
    }
    if (state.status === 'running') {
      await setIndicator(tabId, 'running');
      return;
    }
    if (Date.now() > deadline) {
      throw new Halted(
        `${PAUSE_LIMIT_MS / 60_000} 分間［再開］が押されなかったため、実行を終了しました。続きは手で操作してください。`,
      );
    }
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error('実行中のタブが閉じられたため、停止しました。');
    }
    const documentId = await getDocumentId(tabId);
    if (tab.status === 'complete' && documentId !== shownDocument) {
      shownDocument = documentId;
      // ページが移動すると、Chrome がアイコンの文字を消すため、設定し直します。
      await showWaitBadge(tabId).catch(() => {});
      await showPausedFrame(flow, tabId, tab.url);
    }
    await sleep(STOP_CHECK_INTERVAL_MS);
  }
}

/**
 * 一時停止中の枠と文字を、ページに表示します（#37）。
 * フローのサイトのページにだけ表示します。そのほかのサイトには、スクリプトを読み込む許可がないためです。
 * @param {Flow} flow
 * @param {number} tabId
 * @param {string | undefined} url
 */
async function showPausedFrame(flow, tabId, url) {
  if (!url || !isWebUrl(url) || new URL(url).origin !== flow.origin) {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: CONTENT_FILES,
    });
    await setIndicator(tabId, 'paused');
  } catch {
    // 読み込めないページ（エラーの画面など）では、アイコンの文字だけで示します。
  }
}

/**
 * ページの枠と文字を、実行中または一時停止中の表示に切り替えます（#37）。
 * @param {number} tabId
 * @param {'running' | 'paused'} indicator
 */
async function setIndicator(tabId, indicator) {
  await chrome.tabs
    .sendMessage(tabId, { kind: 'runner/indicator', indicator }, { frameId: 0 })
    .catch(() => {});
}

/**
 * 一時停止中、または以降を人が操作することを、ツールバーのアイコンに紫の「WAIT」で示します（#13、#37）。
 * @param {number} tabId
 */
async function showWaitBadge(tabId) {
  await chrome.action.setBadgeText({ tabId, text: 'WAIT' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: PAUSED_BADGE_COLOR });
  await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
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
 * runInPage を行い、要素が見つからなかった場合は MAX_RETRIES 回までやり直します（#18）。
 * やり直す前には、フローの手順の間隔（#15）と同じ時間だけ待ちます。要素が見つからない場合は、
 * ページに何も操作していないため、やり直しても操作が重なることはありません。
 * @param {string} runId
 * @param {Flow} flow
 * @param {number} tabId
 * @param {Step} step
 * @param {string | undefined} expectedUrl 手順の前に表示しているはずのページの URL
 * @returns {Promise<{ documentId: string | undefined, response: Record<string, any> }>}
 */
async function runInPageWithRetry(runId, flow, tabId, step, expectedUrl) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runInPage(runId, flow, tabId, step, expectedUrl);
    } catch (error) {
      if (!(error instanceof ElementNotFound)) {
        throw error;
      }
      if (attempt >= MAX_RETRIES) {
        throw new Error(
          `${error.message}${MAX_RETRIES} 回やり直しましたが、見つかりませんでした。`,
          {
            cause: error,
          },
        );
      }
      await waitWithStopCheck(runId, pickDelay(stepInterval(flow)));
    }
  }
}

/**
 * ページに認証の画面の印があり、手順を行わずに一時停止すべき場合に、AuthRequired を投げます（#18）。
 * フローのサイト以外のページでは調べません。そのサイトにはスクリプトを読み込む許可がなく、
 * 手順の処理がフローのサイト以外のページとして止めるためです。
 * @param {string} runId
 * @param {Flow} flow
 * @param {number} tabId
 * @param {Step} step
 * @param {string | undefined} expectedUrl
 */
async function checkAuthScreen(runId, flow, tabId, step, expectedUrl) {
  await waitForLoad(runId, tabId, () => true, '');
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !isWebUrl(tab.url) || new URL(tab.url).origin !== flow.origin) {
    return;
  }
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: CONTENT_FILES });
  await throwIfAuthScreen(runId, tabId, tab.url, step, expectedUrl);
}

/**
 * ページの移動の手順の後に、認証の画面に転送されていれば AuthRequired を投げます（#18）。
 * 表示中の URL のパスが移動先と異なり、認証の画面の印がある場合です。再開したときは次の手順から続けます。
 * @param {string} runId
 * @param {Flow} flow
 * @param {number} tabId
 * @param {Step} step ページの移動の手順
 * @param {number} index その手順の番号
 */
async function checkAuthAfterNavigation(runId, flow, tabId, step, index) {
  if (step.type !== 'navigate') {
    return;
  }
  try {
    await checkAuthScreen(runId, flow, tabId, step, step.url);
  } catch (error) {
    if (error instanceof AuthRequired) {
      throw new AuthRequired(authPauseNoteForPage(step.url), index + 1);
    }
    if (error instanceof StopRequested) {
      throw error;
    }
    // 転送の途中のページや、エラーの画面ではスクリプトを読み込めないことがあります。その場合は調べずに
    // 進みます。移動先のページで止まるべき場合は、次の手順の前の確認で止まります。
  }
}

/**
 * content script を読み込んだページで、認証の画面の印を調べます（#18）。
 * @param {string} runId
 * @param {number} tabId
 * @param {string} currentUrl
 * @param {Step} step
 * @param {string | undefined} expectedUrl
 */
async function throwIfAuthScreen(runId, tabId, currentUrl, step, expectedUrl) {
  const { signals } = await requestPage(runId, tabId, { kind: 'runner/authSignals' });
  const checked = {
    password: signals?.password === true,
    oneTimeCode: signals?.oneTimeCode === true,
    captcha: signals?.captcha === true,
  };
  if (shouldPauseForAuth({ signals: checked, currentUrl, expectedUrl, step })) {
    throw new AuthRequired(AUTH_PAUSE_NOTE);
  }
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
 * @param {string | undefined} expectedUrl 手順の前に表示しているはずのページの URL（#18）
 * @returns {Promise<{ documentId: string | undefined, response: Record<string, any> }>}
 *   documentId は手順を実行する前に表示していたページの識別子、response はページからの応答です
 */
async function runInPage(runId, flow, tabId, step, expectedUrl) {
  await waitForLoad(runId, tabId, () => true, '');
  // クリックで移動した場合に、新しいページに切り替わったかを判定できるよう、操作の前に控えます（#51）。
  const documentId = await getDocumentId(tabId);
  const tab = await chrome.tabs.get(tabId);
  // 別のサイトに移動していた場合は、入力値を別のサイトに入力しないよう停止します（#14）。
  if (!tab.url || new URL(tab.url).origin !== flow.origin) {
    throw new Error(`フローのサイト（${flow.origin}）とは別のページに移動したため、停止しました。`);
  }

  // サイトごとの「必ず止まる場所」の指定（#54）です。止める画面では、クリック・入力・選択を行いません。
  const rule = await getStopRule(flow.origin);
  const stopPath = findStopPath(rule, tab.url);
  if (stopPath !== undefined) {
    throw new Halted(stopRuleNote('path', stopPath));
  }

  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: CONTENT_FILES });
  // ログインの有効期限切れなどで認証の画面が表示されている場合は、操作せずに一時停止します（#18）。
  await throwIfAuthScreen(runId, tabId, tab.url, step, expectedUrl);

  if (step.type === 'click') {
    const inspected = await requestPage(runId, tabId, {
      kind: 'runner/inspect',
      step,
      timeoutMs: ELEMENT_TIMEOUT_MS,
      stopSelectors: rule.selectors,
    });
    // 利用者が明示した指定のため、文言による判定より先に確かめます。
    // ページから届いた値は、指定の一覧に含まれるものだけを受け付けます。
    if (
      typeof inspected.matchedSelector === 'string' &&
      rule.selectors.includes(inspected.matchedSelector)
    ) {
      throw new Halted(stopRuleNote('selector', inspected.matchedSelector));
    }
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
  const response = await requestPage(runId, tabId, {
    kind: 'runner/step',
    step,
    timeoutMs: ELEMENT_TIMEOUT_MS,
  });
  return { documentId, response };
}

/**
 * 表示中のページを PDF にして、ダウンロード先フォルダーに保存します（#16）。
 * PDF は chrome.debugger の Page.printToPDF で作ります。既定は印刷用の表示で、mode が screen の場合は
 * 画面の表示で作ります（#73）。
 * @param {string} runId
 * @param {Flow} flow
 * @param {number} tabId
 * @param {import('../shared/flow.js').SavePdfStep} step
 * @param {Record<string, string>} pathValues 保存先に埋め込む値
 * @returns {Promise<string>} 保存したファイルのパス
 */
async function savePdf(runId, flow, tabId, step, pathValues) {
  await waitForLoad(runId, tabId, () => true, '');
  const tab = await chrome.tabs.get(tabId);
  // 別のサイトのページを、このフローの書類として保存しないよう停止します。
  if (!tab.url || new URL(tab.url).origin !== flow.origin) {
    throw new Error(`フローのサイト（${flow.origin}）とは別のページに移動したため、停止しました。`);
  }
  const built = buildSavePath(step.path ?? DEFAULT_SAVE_PATH, pathValues);
  if (!built.ok) {
    throw new Error(built.error);
  }

  const data = await printPage(tabId, step.mode === 'screen');

  // Service Worker では URL.createObjectURL が使えないため、data: URL で渡します（#16 で作業環境で確認済み）。
  const downloadId = await chrome.downloads.download({
    url: `data:application/pdf;base64,${data}`,
    filename: built.path,
    conflictAction: step.onConflict === 'overwrite' ? 'overwrite' : 'uniquify',
    saveAs: false,
  });
  return waitForDownload(runId, downloadId);
}

/**
 * タブのページを PDF にし、その内容（Base64）を返します。
 * @param {number} tabId
 * @param {boolean} screen 画面の表示で作るか（#73）。false の場合は印刷用の表示で作ります
 * @returns {Promise<string>}
 */
async function printPage(tabId, screen) {
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (error) {
    throw new Error(
      `PDF を作れませんでした。このタブで開発者ツールを開いている場合は、閉じてから実行してください（${String(error)}）。`,
      { cause: error },
    );
  }
  try {
    if (screen) {
      // 実行中の枠と文字は @media print でだけ隠れるため、画面の表示では PDF に写らないよう隠します。
      await setOverlayHidden(tabId, true);
      await chrome.debugger.sendCommand(target, 'Emulation.setEmulatedMedia', { media: 'screen' });
    }
    const result = /** @type {{ data: string }} */ (
      await chrome.debugger.sendCommand(target, 'Page.printToPDF', { printBackground: true })
    );
    return result.data;
  } finally {
    if (screen) {
      // 切り離すと上書きも解除されると考えられますが、確かめていないため、明示的に戻します。
      await chrome.debugger
        .sendCommand(target, 'Emulation.setEmulatedMedia', { media: '' })
        .catch(() => {});
      await setOverlayHidden(tabId, false);
    }
    await chrome.debugger.detach(target).catch(() => {});
  }
}

/**
 * 実行中の枠と文字を、隠すか表示し直します（#73）。
 * ページを移動した後は content script がまだ読み込まれておらず、枠もないため、届かなくても誤りにしません。
 * @param {number} tabId
 * @param {boolean} hidden
 */
async function setOverlayHidden(tabId, hidden) {
  await chrome.tabs
    .sendMessage(tabId, { kind: 'runner/overlay', hidden }, { frameId: 0 })
    .catch(() => {});
}

/**
 * ダウンロードが終わるのを待ち、保存したファイルのパスを返します。
 * @param {string} runId
 * @param {number} downloadId
 * @returns {Promise<string>}
 */
async function waitForDownload(runId, downloadId) {
  const deadline = Date.now() + DOWNLOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.state === 'complete') {
      return item.filename;
    }
    if (item?.state === 'interrupted') {
      throw new Error(`PDF を保存できませんでした（${item.error ?? '理由は不明です'}）。`);
    }
    await throwIfStopRequested(runId);
    await sleep(STOP_CHECK_INTERVAL_MS);
  }
  throw new Error(
    `${Math.round(DOWNLOAD_TIMEOUT_MS / 1000)} 秒待ちましたが、PDF の保存が終わりませんでした。`,
  );
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
    const text = response?.error ?? 'ページから応答がありませんでした。';
    throw isRetryableFailure(response) ? new ElementNotFound(text) : new Error(text);
  }
  return response;
}

/**
 * 続けて記録された「ページの操作による移動」の手順のうち、最後の手順の番号を返します。
 * 転送が続く場合、実行時は途中のページを経ずに最後のページに着くことがあるため、まとめて扱います。
 * @param {Step[]} steps
 * @param {number} index 最初の移動の手順の番号
 * @returns {number}
 */
export function lastPageNavigationIndex(steps, index) {
  let last = index;
  while (last + 1 < steps.length) {
    const next = steps[last + 1];
    if (next.type !== 'navigate' || next.cause !== 'page') {
      break;
    }
    last += 1;
  }
  return last;
}

/**
 * 新しいページの読み込みが終わったかを判定します。
 * ページの識別子（documentId）が移動の前と異なり、読み込みが完了している場合に true を返します。
 * @param {string | undefined} before 移動の前のページの識別子。取得できなかった場合は undefined です。
 * @param {{ documentId?: string, status?: string }} current 現在のページの識別子と、タブの読み込みの状態
 * @returns {boolean}
 */
export function isNewPageLoaded(before, current) {
  return (
    current.status === 'complete' &&
    current.documentId !== undefined &&
    current.documentId !== before
  );
}

/**
 * タブの最上位のフレームに表示しているページの識別子を返します。取得できない場合は undefined です。
 * @param {number} tabId
 * @returns {Promise<string | undefined>}
 */
async function getDocumentId(tabId) {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  return frame?.documentId;
}

/**
 * ページの操作による移動で、新しいページの読み込みが終わるまで待ちます。
 * 読み込みの直後に続けて転送されることがあるため、同じページが 2 回続けて読み込み済みと
 * 判定されるまで待ちます。
 * @param {string} runId
 * @param {number} tabId
 * @param {string | undefined} documentBefore 移動の前のページの識別子
 * @param {string} recordedUrl 記録時の移動先（失敗時の表示に使います）
 */
async function waitForNewPage(runId, tabId, documentBefore, recordedUrl) {
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  let lastUrl = '';
  /** @type {string | undefined} */
  let loaded;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error('実行中のタブが閉じられたため、停止しました。');
    }
    lastUrl = tab.url ?? tab.pendingUrl ?? '';
    const documentId = await getDocumentId(tabId);
    if (isNewPageLoaded(documentBefore, { documentId, status: tab.status })) {
      if (loaded === documentId) {
        return;
      }
      loaded = documentId;
    } else {
      loaded = undefined;
    }
    await throwIfStopRequested(runId);
    await sleep(STOP_CHECK_INTERVAL_MS);
  }
  throw new Error(
    `${Math.round(NAVIGATION_TIMEOUT_MS / 1000)} 秒待ちましたが、新しいページが表示されませんでした` +
      `（記録時の移動先：${recordedUrl}）。現在のページ：${lastUrl || '不明'}`,
  );
}

/**
 * タブの読み込みが終わり、表示中の URL が条件を満たすまで待ちます。
 * Service Worker は操作がない状態が約 30 秒続くと停止するため、イベントを待つのではなく、
 * 短い間隔でタブの状態を問い合わせます。問い合わせのたびに停止までの時間が延びます。
 * @param {string} runId
 * @param {number} tabId
 * @param {(url: string) => boolean} isExpected
 * @param {string} description 待っているページの説明（失敗時の表示に使います）
 * @param {(documentId: string | undefined) => Promise<void>} [onOtherPage] 想定と異なるページの
 *   読み込みが終わったときに、ページごとに 1 回呼ぶ処理。例外を投げると、待つのをやめます（#18）
 */
async function waitForLoad(runId, tabId, isExpected, description, onOtherPage) {
  const deadline = Date.now() + NAVIGATION_TIMEOUT_MS;
  let lastUrl = '';
  /** onOtherPage を呼んだページの識別子です。 */
  let checked;
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
    if (onOtherPage && tab.status === 'complete' && lastUrl) {
      const documentId = await getDocumentId(tabId);
      if (documentId !== checked) {
        checked = documentId;
        await onOtherPage(documentId);
      }
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

/**
 * 指定した時間だけ待ちます（#15）。待っている間も停止の指示を確かめ、指示があれば StopRequested を投げます。
 * 一時停止を求められた場合は、その時点で待つのをやめます。
 * 確かめるたびに chrome.storage を読むため、Service Worker は長い待機の間も停止しません
 * （拡張機能の API の呼び出しで、停止までの時間が数え直されます）。
 * https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
 * @param {string} runId
 * @param {number} ms
 */
async function waitWithStopCheck(runId, ms) {
  const deadline = Date.now() + ms;
  for (let rest = ms; rest > 0; rest = deadline - Date.now()) {
    await throwIfStopRequested(runId);
    // 一時停止を求められた場合は、待つのをやめます（#37）。止まっている間に十分な時間が経つためです。
    if (await isPauseRequested(runId)) {
      return;
    }
    await sleep(Math.min(rest, STOP_CHECK_INTERVAL_MS));
  }
  await throwIfStopRequested(runId);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
