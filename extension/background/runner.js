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
 * @property {'running' | 'stopping' | 'done' | 'failed' | 'stopped' | 'halted'} status
 *   halted は、確定ボタンの手前、または一時停止の手順で実行を終えたことを示します（#29）。
 * @property {string} [error] 失敗した理由。halted の場合は、止まった理由の説明です。
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
  try {
    while (index < steps.length) {
      await throwIfStopRequested(runId);
      await updateRunState(runId, { stepIndex: index });
      // タブのページが移動すると、Chrome はそのタブ用のアイコンの文字を消します。手順ごとに設定し直します。
      await showRunBadge(tabId);

      const step = steps[index];
      if (step.type === 'navigate' && step.cause === 'page') {
        // ページの操作による移動は、直前のクリックなどの結果です。新しいページの読み込みが
        // 終わるのを待ちます。移動先の URL は比べません。サイトが記録時と異なる画面に転送する
        // ことがあるためです（#51）。想定と異なるページに着いた場合は、次の手順の要素が
        // 見つからずに止まります。転送が続いて記録された移動は、まとめて 1 回の移動として扱います。
        await waitForNewPage(runId, tabId, documentBefore, step.url);
        index = lastPageNavigationIndex(steps, index);
        documentBefore = await getDocumentId(tabId);
      } else if (step.type === 'wait') {
        await waitWithStopCheck(runId, step.ms);
      } else if (step.type === 'pause') {
        throw new Halted(step.note ?? '一時停止の手順です。以降の操作は手で行ってください。');
      } else if (step.type === 'navigate') {
        if (index > 0) {
          await chrome.tabs.update(tabId, { url: step.url });
        }
        await waitForLoad(runId, tabId, (url) => samePage(url, step.url), step.url);
        documentBefore = await getDocumentId(tabId);
      } else if (step.type === 'savePdf') {
        const file = await savePdf(runId, flow, tabId, step, pathValues);
        savedFiles.get(runId)?.push(file);
        documentBefore = await getDocumentId(tabId);
      } else {
        const done = await runInPage(runId, flow, tabId, step);
        documentBefore = done.documentId;
        if (step.type === 'extract') {
          const text = typeof done.response.text === 'string' ? done.response.text : '';
          if (!text) {
            throw new Error(`「${step.target.label}」から文字を読み取れませんでした（空でした）。`);
          }
          pathValues[step.name] = text.slice(0, EXTRACT_MAX_LENGTH);
          // 読み取った値は個人情報を含む場合があるため、実行履歴の理由には残しません。
          redactions.get(runId)?.push(pathValues[step.name]);
        }
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
      await finishRun(runId, { status: 'halted', stepIndex: index, error: error.message });
      return;
    }
    await finishRun(runId, {
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
 * @returns {Promise<{ documentId: string | undefined, response: Record<string, any> }>}
 *   documentId は手順を実行する前に表示していたページの識別子、response はページからの応答です
 */
async function runInPage(runId, flow, tabId, step) {
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
 * PDF は chrome.debugger の Page.printToPDF で作ります。印刷用の表示で作ります（#73 で画面の表示を加えます）。
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

  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
  } catch (error) {
    throw new Error(
      `PDF を作れませんでした。このタブで開発者ツールを開いている場合は、閉じてから実行してください（${String(error)}）。`,
      { cause: error },
    );
  }
  /** @type {string} */
  let data;
  try {
    const result = /** @type {{ data: string }} */ (
      await chrome.debugger.sendCommand(target, 'Page.printToPDF', { printBackground: true })
    );
    data = result.data;
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }

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
    throw new Error(response?.error ?? 'ページから応答がありませんでした。');
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

/**
 * 指定した時間だけ待ちます（#15）。待っている間も停止の指示を確かめ、指示があれば StopRequested を投げます。
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
    await sleep(Math.min(rest, STOP_CHECK_INTERVAL_MS));
  }
  await throwIfStopRequested(runId);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
