// 操作の記録を管理します。
//
// 記録中の状態と記録した手順は chrome.storage.session に保存します。Service Worker は操作がない
// 状態が約 30 秒続くと停止し、変数の内容は失われるためです。storage.session はメモリー上にあり、
// Chrome を終了すると消えます。content script からは読み書きできません。

import {
  MAX_EXTRA_ORIGINS,
  MAX_STEPS,
  PAGE_STEP_TYPES,
  SCHEMA_VERSION,
  isWebUrl,
  orderFlow,
  validateFlow,
  validateStep,
} from '../shared/flow.js';
import { guardRecordedStep } from '../shared/purchase-guard.js';
import { applyStopRuleToRecordedStep } from '../shared/stop-rules.js';
import { getStopRule } from '../common/stop-rules-store.js';
import { CONTROL_STEP_TYPES } from '../shared/control-flow.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('../shared/flow.js').Step} Step */

/**
 * 記録中の状態です。
 * @typedef {object} Recording
 * @property {number} tabId 記録しているタブ
 * @property {string} origin 記録を始めたページのオリジン
 * @property {string[]} [extraOrigins] 記録を始めたサイトのほかに、手順を記録したサイト（#41）
 * @property {string} startedAt 記録を始めた日時（ISO 8601）
 * @property {Step[]} steps 記録した手順
 */

/**
 * 記録中のタブが表示しているページのサイトと、そこで記録しているかです（#41）。サイドパネルが表示に使います。
 * 手順の記録と競合しないよう、記録中の状態とは別のキーに保存します。
 * @typedef {object} RecordingPage
 * @property {string} origin 表示中のページのオリジン
 * @property {boolean} allowed そのサイトを操作する許可があり、記録しているか
 */

const RECORDING_KEY = 'recording';
const RECORDING_PAGE_KEY = 'recordingPage';
const LAST_FLOW_KEY = 'lastFlow';

/** 手順の削除を、表示が古いために断ったときの理由です。 */
const STALE_STEPS_ERROR =
  '手順の一覧が変わったため、削除しませんでした。一覧を確かめてから押し直してください。';

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
 * 手順をすべて削除していた場合は、フローを作らずに記録を破棄し、flow に null を返します。
 * @returns {Promise<{ ok: true, flow: Flow | null, errors: string[] } | { ok: false, error: string }>}
 */
export function stopRecording() {
  return enqueue(async () => {
    const recording = await getRecording();
    if (!recording) {
      return { ok: false, error: '記録していません。' };
    }
    if (recording.steps.length === 0) {
      await chrome.storage.session.remove([RECORDING_KEY, RECORDING_PAGE_KEY]);
      await detach(recording.tabId);
      return { ok: true, flow: null, errors: [] };
    }

    /** @type {Flow} */
    const flow = {
      schemaVersion: SCHEMA_VERSION,
      name: `記録 ${new Date(recording.startedAt).toLocaleString('ja-JP')}`,
      origin: recording.origin,
      ...(recording.extraOrigins?.length ? { extraOrigins: recording.extraOrigins } : {}),
      steps: recording.steps,
    };
    await chrome.storage.session.set({ [LAST_FLOW_KEY]: flow });
    await chrome.storage.session.remove([RECORDING_KEY, RECORDING_PAGE_KEY]);
    await detach(recording.tabId);
    return { ok: true, flow: orderFlow(flow), errors: validateFlow(flow) };
  });
}

/**
 * 記録中、または記録を停止した後で保存前の手順から、指定した番号の手順を 1 件削除します。
 * サイドパネルの表示が古い状態で押された場合に別の手順を消さないよう、表示していた手順の件数を
 * 受け取り、今の件数と一致しない場合は削除しません。
 * 記録の停止後にすべての手順を削除した場合は、記録を破棄した状態（lastFlow なし）にします。
 * 保存済みのフロー（chrome.storage.local）には影響しません。
 * @param {unknown} index 削除する手順の番号（0 から数えます）
 * @param {unknown} count 表示していた手順の件数
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function removeRecordedStep(index, count) {
  return enqueue(async () => {
    const recording = await getRecording();
    if (recording) {
      const steps = withoutStep(recording.steps, index, count);
      if (!steps) {
        return { ok: false, error: STALE_STEPS_ERROR };
      }
      await chrome.storage.session.set({ [RECORDING_KEY]: { ...recording, steps } });
      return { ok: true };
    }

    const lastFlow = await getLastFlow();
    if (!lastFlow) {
      return { ok: false, error: '削除する手順がありません。' };
    }
    const steps = withoutStep(lastFlow.steps, index, count);
    if (!steps) {
      return { ok: false, error: STALE_STEPS_ERROR };
    }
    if (steps.length === 0) {
      await chrome.storage.session.remove(LAST_FLOW_KEY);
    } else {
      await chrome.storage.session.set({ [LAST_FLOW_KEY]: { ...lastFlow, steps } });
    }
    return { ok: true };
  });
}

/**
 * 記録した手順を破棄します。記録中の場合は、記録を停止してから破棄します。
 * 保存済みのフロー（chrome.storage.local）には影響しません。
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function resetRecording() {
  return enqueue(async () => {
    const recording = await getRecording();
    const lastFlow = await getLastFlow();
    if (!recording && !lastFlow) {
      return { ok: false, error: '破棄する記録がありません。' };
    }
    await chrome.storage.session.remove([RECORDING_KEY, LAST_FLOW_KEY, RECORDING_PAGE_KEY]);
    if (recording) {
      await detach(recording.tabId);
    }
    return { ok: true };
  });
}

/**
 * 指定した番号の手順を除いた、新しい手順の配列を返します。元の配列は変更しません。
 * 番号が範囲外の場合と、件数が一致しない場合は null を返します。
 * @param {Step[]} steps
 * @param {unknown} index 削除する手順の番号（0 から数えます）
 * @param {unknown} count 削除を指示した画面が表示していた手順の件数
 * @returns {Step[] | null}
 */
export function withoutStep(steps, index, count) {
  if (
    !Number.isInteger(index) ||
    count !== steps.length ||
    /** @type {number} */ (index) < 0 ||
    /** @type {number} */ (index) >= steps.length
  ) {
    return null;
  }
  return steps.filter((_, i) => i !== index);
}

/** @returns {Promise<Flow | undefined>} */
async function getLastFlow() {
  const stored = await chrome.storage.session.get(LAST_FLOW_KEY);
  return /** @type {Flow | undefined} */ (stored[LAST_FLOW_KEY]);
}

/**
 * content script から届いた手順を、記録中の手順に加えます。
 * 送信元が記録中のタブの、操作の許可があるサイトのページであることを確認します。
 * 記録を始めたサイト以外で記録した手順には、そのサイトを origin として付け、フローの extraOrigins に
 * 加えます（#41）。サイトは content script から届いた値ではなく、送信元の URL から決めます。
 *
 * 確定ボタンのクリックは、クリックではなく一時停止の手順として記録し、ページにその旨を表示します（#29）。
 * 実行時に確定ボタンを押さないためです。利用者が記録中に押したクリックそのものは止めません。
 * @param {unknown} step
 * @param {chrome.runtime.MessageSender} sender
 * サイトごとの「必ず止まる場所」の指定（#54）に一致するクリックも、同じように一時停止として記録します。
 * @param {unknown} step
 * @param {chrome.runtime.MessageSender} sender
 * @param {unknown} texts クリックした要素の文言（content/element-text.js）
 * @param {unknown} matchedSelector クリックした要素が一致した、止める要素の指定
 * @param {unknown} [keys] クリックした要素の、翻訳で変わらない手がかり（content/element-text.js、#97）
 * @returns {Promise<void>}
 */
export function addStep(step, sender, texts, matchedSelector, keys) {
  return enqueue(async () => {
    const recording = await getRecording();
    if (
      !recording ||
      sender.tab?.id !== recording.tabId ||
      sender.frameId !== 0 ||
      !sender.url ||
      !isWebUrl(sender.url) ||
      validateStep(step).length > 0 ||
      // 条件分岐と繰り返し（#6）は記録では作りません。ページから届いた場合も受け付けません。
      CONTROL_STEP_TYPES.includes(String(/** @type {{ type?: unknown }} */ (step).type)) ||
      recording.steps.length >= MAX_STEPS
    ) {
      return;
    }
    const origin = new URL(sender.url).origin;
    const extraOrigins = recording.extraOrigins ?? [];
    const isExtra = origin !== recording.origin;
    if (
      isExtra &&
      !extraOrigins.includes(origin) &&
      (extraOrigins.length >= MAX_EXTRA_ORIGINS ||
        !(await chrome.permissions.contains({ origins: [`${origin}/*`] })))
    ) {
      return;
    }
    // content script から届いた origin は使いません。
    const received = { .../** @type {Record<string, unknown>} */ (step) };
    delete received.origin;
    // サイトごとの指定を先に確かめます。利用者が明示した指定のため、文言による判定より優先します。
    const ruled = applyStopRuleToRecordedStep(
      /** @type {Step} */ (received),
      recording.steps.at(-1),
      await getStopRule(origin),
      sender.url,
      typeof matchedSelector === 'string' ? matchedSelector : undefined,
    );
    /** @type {Step | null} */
    let recorded = ruled.step;
    /** @type {string | undefined} */
    let notice;
    if (ruled.note !== undefined) {
      notice =
        'サイトごとの指定に一致したため、クリックの代わりに一時停止を記録しました。実行はこの手前で止まります。';
    } else {
      const guarded = guardRecordedStep(
        /** @type {Step} */ (received),
        Array.isArray(texts) ? texts.filter((text) => typeof text === 'string') : [],
        Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : [],
      );
      recorded = guarded.step;
      if (guarded.confirmText !== undefined) {
        notice =
          '確定ボタンのため、クリックの代わりに一時停止を記録しました。実行はこの手前で止まります。';
      }
    }
    if (recorded) {
      if (isExtra && PAGE_STEP_TYPES.includes(recorded.type)) {
        recorded = /** @type {Step} */ ({ ...recorded, origin });
        if (!extraOrigins.includes(origin)) {
          recording.extraOrigins = [...extraOrigins, origin];
        }
      }
      recording.steps.push(recorded);
      await chrome.storage.session.set({ [RECORDING_KEY]: recording });
    }
    if (notice !== undefined) {
      await chrome.tabs
        .sendMessage(recording.tabId, { kind: 'recorder/notice', text: notice }, { frameId: 0 })
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
 * 記録中であることをツールバーのアイコンに表示し、操作の許可があるサイトのページであれば
 * 記録用のスクリプトを読み込みます。許可がないサイトのページには読み込みません。
 * 記録を始めたサイト以外でも、許可があれば確認を出さずに記録を続けます（#41）。Chrome はサイトの許可を
 * 保持するため、一度許可したサイトで毎回確認しないためです。表示中のページのサイトと、記録しているかを
 * サイドパネルに知らせます。
 * @param {Recording} recording
 */
async function attach(recording) {
  await chrome.action.setBadgeText({ tabId: recording.tabId, text: 'REC' });
  await chrome.action.setBadgeBackgroundColor({ tabId: recording.tabId, color: '#d93025' });

  const frame = await chrome.webNavigation.getFrame({ tabId: recording.tabId, frameId: 0 });
  if (!frame || !isWebUrl(frame.url)) {
    await chrome.storage.session.remove(RECORDING_PAGE_KEY);
    return;
  }
  const origin = new URL(frame.url).origin;
  const allowed =
    origin === recording.origin ||
    (await chrome.permissions.contains({ origins: [`${origin}/*`] }));
  /** @type {RecordingPage} */
  const page = { origin, allowed };
  await chrome.storage.session.set({ [RECORDING_PAGE_KEY]: page });
  if (!allowed) {
    return;
  }
  try {
    // サイトごとの止める要素の指定（#54）を、記録用のスクリプトより先にページへ置きます。
    // 記録用のスクリプトは extension/shared/ を読み込めないため、値として渡します。
    const { selectors } = await getStopRule(origin);
    await chrome.scripting.executeScript({
      target: { tabId: recording.tabId, frameIds: [0] },
      func: (/** @type {string[]} */ stopSelectors) => {
        /** @type {Record<string, unknown>} */ (
          /** @type {unknown} */ (globalThis)
        ).__lightomateStopSelectors = stopSelectors;
      },
      args: [selectors],
    });
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
 * 記録中のタブで表示しているサイトでも記録を始めます（#41）。サイドパネルの［このサイトを許可して記録］で、
 * 許可を得た後に呼び出します。記録中のタブが今そのサイトを表示していることと、許可があることを確かめます。
 * @param {unknown} origin
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function allowRecordingOrigin(origin) {
  const recording = await getRecording();
  if (!recording) {
    return { ok: false, error: '記録していません。' };
  }
  const frame = await chrome.webNavigation
    .getFrame({ tabId: recording.tabId, frameId: 0 })
    .catch(() => null);
  if (
    typeof origin !== 'string' ||
    !frame ||
    !isWebUrl(frame.url) ||
    new URL(frame.url).origin !== origin
  ) {
    return { ok: false, error: '記録中のタブが、そのサイトのページを表示していません。' };
  }
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
    return { ok: false, error: `${origin} を操作する許可がありません。` };
  }
  if (
    origin !== recording.origin &&
    !(recording.extraOrigins ?? []).includes(origin) &&
    (recording.extraOrigins ?? []).length >= MAX_EXTRA_ORIGINS
  ) {
    return {
      ok: false,
      error: `記録できるサイトは、記録を始めたサイトのほかに ${MAX_EXTRA_ORIGINS} 件までです。`,
    };
  }
  await attach(recording);
  return { ok: true };
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
