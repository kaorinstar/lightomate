// 操作の記録を管理します。
//
// 記録中の状態と記録した手順は chrome.storage.session に保存します。Service Worker は操作がない
// 状態が約 30 秒続くと停止し、変数の内容は失われるためです。storage.session はメモリー上にあり、
// Chrome を終了すると消えます。content script からは読み書きできません。

import {
  MAX_STEPS,
  SCHEMA_VERSION,
  isWebUrl,
  orderFlow,
  validateFlow,
  validateStep,
} from '../shared/flow.js';
import { guardRecordedStep } from '../shared/purchase-guard.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('../shared/flow.js').Step} Step */

/**
 * 記録中の状態です。
 * @typedef {object} Recording
 * @property {number} tabId 記録しているタブ
 * @property {string} origin 記録を始めたページのオリジン
 * @property {string} startedAt 記録を始めた日時（ISO 8601）
 * @property {Step[]} steps 記録した手順
 */

const RECORDING_KEY = 'recording';
const LAST_FLOW_KEY = 'lastFlow';

/**
 * ページへ読み込むスクリプトです。selector.js、overlay.js、element-text.js の関数を recorder.js が
 * 使うため、この順で読み込みます。
 */
const CONTENT_FILES = [
  'content/selector.js',
  'content/overlay.js',
  'content/element-text.js',
  'content/recorder.js',
];

/**
 * 状態の読み書きを 1 つずつ順に行うための待ち行列です。
 * 手順が短い間隔で届いた場合に、読み込みと書き込みが入れ違って手順が失われることを防ぎます。
 */
let queue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueue(task) {
  const result = queue.then(task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** @returns {Promise<Recording | undefined>} */
async function getRecording() {
  const stored = await chrome.storage.session.get(RECORDING_KEY);
  return /** @type {Recording | undefined} */ (stored[RECORDING_KEY]);
}

/**
 * 指定したタブで記録を始めます。
 * サイトの操作の許可は、あらかじめサイドパネルで得ておく必要があります。
 * @param {number} tabId
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function startRecording(tabId) {
  return enqueue(async () => {
    if (await getRecording()) {
      return { ok: false, error: 'すでに記録中です。' };
    }

    const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (!frame || !isWebUrl(frame.url)) {
      return { ok: false, error: 'このページは記録できません。' };
    }
    const origin = new URL(frame.url).origin;
    if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
      return { ok: false, error: `${origin} を操作する許可がありません。` };
    }

    /** @type {Recording} */
    const recording = {
      tabId,
      origin,
      startedAt: new Date().toISOString(),
      // 実行時に同じページから始められるよう、記録を始めたページを最初の手順にします。
      steps: [{ type: 'navigate', url: frame.url, cause: 'user' }],
    };
    await chrome.storage.session.set({ [RECORDING_KEY]: recording });
    await chrome.storage.session.remove(LAST_FLOW_KEY);
    await attach(recording);
    return { ok: true };
  });
}

/**
 * 記録を停止し、記録した手順からフロー定義を作ります。
 * @returns {Promise<{ ok: true, flow: Flow, errors: string[] } | { ok: false, error: string }>}
 */
export function stopRecording() {
  return enqueue(async () => {
    const recording = await getRecording();
    if (!recording) {
      return { ok: false, error: '記録していません。' };
    }

    /** @type {Flow} */
    const flow = {
      schemaVersion: SCHEMA_VERSION,
      name: `記録 ${new Date(recording.startedAt).toLocaleString('ja-JP')}`,
      origin: recording.origin,
      steps: recording.steps,
    };
    await chrome.storage.session.set({ [LAST_FLOW_KEY]: flow });
    await chrome.storage.session.remove(RECORDING_KEY);
    await detach(recording.tabId);
    return { ok: true, flow: orderFlow(flow), errors: validateFlow(flow) };
  });
}

/**
 * content script から届いた手順を、記録中の手順に加えます。
 * 送信元が記録中のタブの、記録を始めたサイトのページであることを確認します。
 *
 * 確定ボタンのクリックは、クリックではなく一時停止の手順として記録し、ページにその旨を表示します（#29）。
 * 実行時に確定ボタンを押さないためです。利用者が記録中に押したクリックそのものは止めません。
 * @param {unknown} step
 * @param {chrome.runtime.MessageSender} sender
 * @param {unknown} texts クリックした要素の文言（content/element-text.js）
 * @returns {Promise<void>}
 */
export function addStep(step, sender, texts) {
  return enqueue(async () => {
    const recording = await getRecording();
    if (
      !recording ||
      sender.tab?.id !== recording.tabId ||
      sender.frameId !== 0 ||
      !sender.url ||
      new URL(sender.url).origin !== recording.origin ||
      validateStep(step).length > 0 ||
      recording.steps.length >= MAX_STEPS
    ) {
      return;
    }
    const guarded = guardRecordedStep(
      /** @type {Step} */ (step),
      Array.isArray(texts) ? texts.filter((text) => typeof text === 'string') : [],
    );
    recording.steps.push(guarded.step);
    await chrome.storage.session.set({ [RECORDING_KEY]: recording });
    if (guarded.confirmText !== undefined) {
      await chrome.tabs
        .sendMessage(
          recording.tabId,
          {
            kind: 'recorder/notice',
            text: '確定ボタンのため、クリックの代わりに一時停止を記録しました。実行はこの手前で止まります。',
          },
          { frameId: 0 },
        )
        .catch(() => {});
    }
  });
}

/**
 * 記録中のタブでページを移動したときに、移動を手順として記録します。
 * @param {chrome.webNavigation.WebNavigationTransitionCallbackDetails} details
 * @returns {Promise<void>}
 */
export function onCommitted(details) {
  return enqueue(async () => {
    const recording = await getRecording();
    if (!recording || details.tabId !== recording.tabId || details.frameId !== 0) {
      return;
    }
    if (!isWebUrl(details.url) || recording.steps.length >= MAX_STEPS) {
      return;
    }
    recording.steps.push({ type: 'navigate', url: details.url, cause: navigationCause(details) });
    await chrome.storage.session.set({ [RECORDING_KEY]: recording });
  });
}

/**
 * 記録中のタブで新しいページが読み込まれたときに、記録用のスクリプトを読み込み直します。
 * ページを移動すると、それまでのスクリプトは失われるためです。
 * @param {chrome.webNavigation.WebNavigationFramedCallbackDetails} details
 * @returns {Promise<void>}
 */
export async function onDOMContentLoaded(details) {
  const recording = await getRecording();
  if (recording && details.tabId === recording.tabId && details.frameId === 0) {
    await attach(recording);
  }
}

/**
 * 記録中のタブが閉じられたときに、記録を停止します。記録した手順は残します。
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function onTabRemoved(tabId) {
  const recording = await getRecording();
  if (recording?.tabId === tabId) {
    await stopRecording();
  }
}

/**
 * 記録中であることをツールバーのアイコンに表示し、記録を始めたサイトのページであれば
 * 記録用のスクリプトを読み込みます。別のサイトのページには読み込みません。
 * @param {Recording} recording
 */
async function attach(recording) {
  await chrome.action.setBadgeText({ tabId: recording.tabId, text: 'REC' });
  await chrome.action.setBadgeBackgroundColor({ tabId: recording.tabId, color: '#d93025' });

  const frame = await chrome.webNavigation.getFrame({ tabId: recording.tabId, frameId: 0 });
  if (!frame || !isWebUrl(frame.url) || new URL(frame.url).origin !== recording.origin) {
    return;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: recording.tabId, frameIds: [0] },
      files: CONTENT_FILES,
    });
  } catch (error) {
    // 読み込みの途中でページを移動した場合などに失敗します。移動先のページで読み込み直します。
    console.warn('記録用のスクリプトを読み込めませんでした。', error);
  }
}

/**
 * 記録の表示を消し、ページの記録用のスクリプトを止めます。
 * @param {number} tabId
 */
async function detach(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.tabs.sendMessage(tabId, { kind: 'recorder/stop' }, { frameId: 0 });
  } catch {
    // タブが閉じられた場合や、記録用のスクリプトがないページ（別のサイト）の場合は失敗します。
  }
}

/**
 * 移動が利用者の操作によるものか、ページの操作によるものかを判定します。
 * 実行時、ページの操作による移動は、直前の手順（クリックなど）の結果として待つだけにします。
 * @param {{ transitionType: string, transitionQualifiers: string[] }} details
 * @returns {'user' | 'page'}
 */
export function navigationCause({ transitionType, transitionQualifiers }) {
  if (
    transitionQualifiers.includes('client_redirect') ||
    transitionQualifiers.includes('server_redirect')
  ) {
    return 'page';
  }
  if (
    transitionQualifiers.includes('forward_back') ||
    transitionQualifiers.includes('from_address_bar')
  ) {
    return 'user';
  }
  return ['link', 'form_submit', 'auto_subframe', 'manual_subframe'].includes(transitionType)
    ? 'page'
    : 'user';
}
