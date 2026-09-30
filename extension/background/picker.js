// 要素の選択モード（#139）を管理します。
//
// 管理画面のブロックの［ページで選ぶ］から始まり、フローのサイトのタブで利用者が要素を押すと、その指定を
// 管理画面へ返します。受け渡しは次のメッセージで行います。
// - 管理画面 → Service Worker：picker/start
// - ページのスクリプト（content/picker.js）→ Service Worker：picker/result
// - Service Worker → 管理画面：picker/done
// 選択の途中の状態は chrome.storage.session に保存します。利用者が選んでいる間に Service Worker が
// 止まっても、結果を受け取れるようにするためです。

import { isWebOrigin, isWebUrl, validateTarget } from '../shared/flow.js';

/**
 * 選択の途中の状態です。
 * @typedef {object} PickerState
 * @property {string} requestId 選択を区別する値。管理画面が結果を照らし合わせるのに使います
 * @property {number} optionsTabId 選択を始めた管理画面のタブ
 * @property {number} tabId 要素を選んでいるページのタブ
 */

const PICKER_KEY = 'picker';

/** ページへ読み込むスクリプトです。selector.js と picker-rows.js の関数を picker.js が使うため、この順で読み込みます。 */
const PICKER_FILES = ['content/selector.js', 'content/picker-rows.js', 'content/picker.js'];

/** ページの読み込みを待つ上限の時間（ミリ秒）です。 */
const LOAD_TIMEOUT_MS = 30_000;

/** @returns {Promise<PickerState | undefined>} */
async function getState() {
  const stored = await chrome.storage.session.get(PICKER_KEY);
  return /** @type {PickerState | undefined} */ (stored[PICKER_KEY]);
}

/**
 * 選択モードを始めます。フローのサイトを表示しているタブのうち最後に使ったタブを前面に出し、ない場合は
 * フローの最初のページを新しいタブで開きます。
 * @param {unknown} request 管理画面からの指示 { origin, url, mode, chain }
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<{ ok: true, requestId: string } | { ok: false, error: string }>}
 */
export async function startPicker(request, sender) {
  const optionsTabId = sender.tab?.id;
  const { origin, url, mode, chain } = /** @type {Record<string, unknown>} */ (request ?? {});
  if (
    optionsTabId === undefined ||
    typeof origin !== 'string' ||
    !isWebOrigin(origin) ||
    (url !== undefined && (typeof url !== 'string' || !isWebUrl(url))) ||
    (mode !== 'element' && mode !== 'rows') ||
    !Array.isArray(chain) ||
    chain.some((items) => validateTarget(items).length > 0)
  ) {
    return { ok: false, error: '選択を始める指示の形が正しくありません。' };
  }
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
    return { ok: false, error: `${origin} を操作する許可がありません。` };
  }
  await stopPicker();

  const tabs = (await chrome.tabs.query({ url: `${origin}/*` })).filter(
    (tab) => tab.id !== undefined && tab.id !== optionsTabId,
  );
  tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const optionsTab = await chrome.tabs.get(optionsTabId);
  const tab =
    tabs[0] ??
    (await chrome.tabs.create({
      url: url && new URL(url).origin === origin ? url : `${origin}/`,
      windowId: optionsTab.windowId,
    }));
  const tabId = /** @type {number} */ (tab.id);
  await chrome.tabs.update(tabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  await waitForLoad(tabId);

  const loaded = await chrome.tabs.get(tabId);
  if (!loaded.url || !isWebUrl(loaded.url) || new URL(loaded.url).origin !== origin) {
    await focusTab(optionsTabId);
    return {
      ok: false,
      error: `タブが ${origin} のページを表示していないため、選択を始められませんでした。`,
    };
  }

  const requestId = crypto.randomUUID();
  /** @type {PickerState} */
  const state = { requestId, optionsTabId, tabId };
  await chrome.storage.session.set({ [PICKER_KEY]: state });
  try {
    // 選択モードのスクリプトは extension/shared/ を読み込めないため、設定は値として先に置きます。
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (/** @type {object} */ config) => {
        /** @type {Record<string, unknown>} */ (
          /** @type {unknown} */ (globalThis)
        ).__lightomatePicker = config;
      },
      args: [{ requestId, mode, chain }],
    });
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: PICKER_FILES,
    });
  } catch (error) {
    await chrome.storage.session.remove(PICKER_KEY);
    await focusTab(optionsTabId);
    return { ok: false, error: `ページで選択を始められませんでした。${String(error)}` };
  }
  return { ok: true, requestId };
}

/**
 * ページのタブの読み込みが終わるまで待ちます。上限の時間を過ぎた場合も、待つのをやめて続けます。
 * @param {number} tabId
 */
async function waitForLoad(tabId) {
  if ((await chrome.tabs.get(tabId)).status === 'complete') {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(done, LOAD_TIMEOUT_MS);
    /**
     * @param {number} updatedId
     * @param {chrome.tabs.OnUpdatedInfo} info
     */
    function onUpdated(updatedId, info) {
      if (updatedId === tabId && info.status === 'complete') {
        done();
      }
    }
    function done() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(undefined);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * タブとそのウィンドウを前面に出します。タブが閉じられている場合は何もしません。
 * @param {number} tabId
 */
async function focusTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch {
    // 管理画面のタブが閉じられている場合です。
  }
}

/**
 * 選択の結果を、管理画面へ知らせて選択を終えます。管理画面のタブを前面に戻します。
 * @param {PickerState} state
 * @param {object} result { target } | { items, count } | { cancelled: true } | { error }
 */
async function finish(state, result) {
  await chrome.storage.session.remove(PICKER_KEY);
  await chrome.runtime
    .sendMessage({ kind: 'picker/done', requestId: state.requestId, result })
    .catch(() => {
      // 管理画面が開いていない場合は、届け先がありません。
    });
  await focusTab(state.optionsTabId);
}

/**
 * ページのスクリプトから届いた結果を受け取ります。選択中のタブと区別の値が一致するものだけを扱います。
 * @param {unknown} message
 * @param {chrome.runtime.MessageSender} sender
 */
export async function onPickerResult(message, sender) {
  const state = await getState();
  const { requestId, result } = /** @type {Record<string, any>} */ (message ?? {});
  if (!state || requestId !== state.requestId || sender.tab?.id !== state.tabId) {
    return;
  }
  if (result?.cancelled === true) {
    await finish(state, { cancelled: true });
  } else if (result?.target && validateTarget(result.target).length === 0) {
    await finish(state, { target: result.target });
  } else if (
    result?.items &&
    validateTarget(result.items).length === 0 &&
    Number.isInteger(result.count)
  ) {
    await finish(state, { items: result.items, count: result.count });
  } else {
    await finish(state, { error: 'ページから届いた要素の指定の形が正しくありません。' });
  }
}

/** 選択の途中であれば、ページの選択モードを終わらせます。結果は管理画面へ知らせません。 */
export async function stopPicker() {
  const state = await getState();
  if (!state) {
    return;
  }
  await chrome.storage.session.remove(PICKER_KEY);
  await chrome.tabs.sendMessage(state.tabId, { kind: 'picker/stop' }).catch(() => {});
}

/**
 * タブが閉じられたときの処理です。管理画面のタブなら選択モードを終わらせ、ページのタブなら管理画面に知らせます。
 * @param {number} tabId
 */
export async function onPickerTabRemoved(tabId) {
  const state = await getState();
  if (state?.optionsTabId === tabId) {
    await stopPicker();
  } else if (state?.tabId === tabId) {
    await finish(state, { error: '要素を選んでいたタブが閉じられたため、選択を終えました。' });
  }
}

/**
 * ページが移動したときの処理です。選択モードのスクリプトは移動で消えるため、選択を終えて管理画面に知らせます。
 * @param {{ tabId: number, frameId: number }} details
 */
export async function onPickerCommitted({ tabId, frameId }) {
  const state = await getState();
  if (frameId === 0 && state?.tabId === tabId) {
    await finish(state, {
      error: 'ページが移動したため、選択を終えました。もう一度［ページで選ぶ］を押してください。',
    });
  }
}
