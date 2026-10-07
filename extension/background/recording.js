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
  frameKey,
  isWebUrl,
  orderFlow,
  validateFlow,
  validateStep,
} from '../shared/flow.js';
import { guardRecordedStep } from '../shared/purchase-guard.js';
import { applyStopRuleToRecordedStep } from '../shared/stop-rules.js';
import { getStopRule } from '../common/stop-rules-store.js';
import { getConfirmDetection } from '../common/confirm-detection-store.js';
import { CONTROL_STEP_TYPES } from '../shared/control-flow.js';
import {
  attachPager,
  makeLoop,
  sanitizePagerHint,
  sanitizeRowHint,
} from '../shared/record-loop.js';
import { toClickDownload, toLinkDownload } from '../shared/file-link.js';
import {
  guideAfterPicked,
  guideAfterRemoval,
  guideAfterStep,
  guideBack,
  guideNext,
  startGuide,
  waitsForPick,
} from '../shared/guide.js';
import { DECLINED_SITES_KEY } from '../shared/site-notice.js';
import { visibleFrameOrigins } from '../shared/frame-visibility.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('../shared/flow.js').Step} Step */
/** @typedef {import('../shared/record-loop.js').RowHint} RowHint */
/** @typedef {import('../shared/record-loop.js').PagerHint} PagerHint */
/** @typedef {import('../shared/guide.js').GuideState} GuideState */

/**
 * 記録中の状態です。
 * @typedef {object} Recording
 * @property {number} tabId 記録しているタブ
 * @property {string} origin 記録を始めたページのオリジン
 * @property {string[]} [extraOrigins] 記録を始めたサイトのほかに、手順を記録したサイト（#41）
 * @property {string} startedAt 記録を始めた日時（ISO 8601）
 * @property {Step[]} steps 記録した手順
 * @property {RowHint[]} [rowHints] steps と同じ順の、操作した要素を含む一覧の行の候補（#167）。
 *   記録した手順を「各行で繰り返す」に変えるときに使います。フロー定義には含めません
 * @property {PagerHint[]} [pagerHints] steps と同じ順の、押した要素を繰り返しのページ送りに使う場合の指定（#182）。
 *   フロー定義には含めません
 * @property {import('../shared/params.js').Param[]} [params] 繰り返しにするときに加えたパラメータ（対象の月の
 *   条件の年月、#183）。記録を停止すると、フローの params になります
 * @property {boolean} [picking] 2 件目の同じものを押してもらうのを待っているか（#241）。サイドパネルが、待っている間の
 *   表示と、押された後に繰り返しの欄を開くために使います
 * @property {string} [lastHref] 最後に記録した手順がリンクのクリックの場合の、そのリンク先（#185）。直後にファイルへ
 *   移動したときに、同じ種類のリンクを探す指定を作るために使います。フロー定義には含めません
 * @property {number} [lastClickAt] 最後に記録した手順がクリックの場合の、記録した時刻（Date.now() の値、#223）。直後に
 *   始まったダウンロードを、そのクリックに結び付けるために使います。フロー定義には含めません
 * @property {GuideState} [guide] 案内付きの記録（#246）の、目的と今の段階。フロー定義には含めません
 */

/**
 * 記録中のタブが表示しているページのサイトと、そこで記録しているかです（#41）。サイドパネルが表示に使います。
 * 手順の記録と競合しないよう、記録中の状態とは別のキーに保存します。
 * @typedef {object} RecordingPage
 * @property {string} origin 表示中のページのオリジン
 * @property {boolean} allowed そのサイトを操作する許可があり、記録しているか
 * @property {string[]} [blockedFrames] 表示中のページに埋め込まれた iframe のうち、操作の許可がないため記録して
 *   いない、画面に見える iframe のサイト（#20、#230）。サイドパネルが上部の知らせを出すために使います
 */

const RECORDING_KEY = 'recording';
const RECORDING_PAGE_KEY = 'recordingPage';
const LAST_FLOW_KEY = 'lastFlow';
/** 保存前の手順（lastFlow の steps）と同じ順の、一覧の行の候補です（#167）。 */
const LAST_FLOW_HINTS_KEY = 'lastFlowRowHints';
/** 保存前の手順と同じ順の、ページ送りに使う場合の指定です（#182）。 */
const LAST_FLOW_PAGERS_KEY = 'lastFlowPagerHints';

/** 手順の削除を、表示が古いために断ったときの理由です。 */
const STALE_STEPS_ERROR =
  '手順の一覧が変わったため、削除しませんでした。一覧を確かめてから押し直してください。';

/**
 * ページへ読み込むスクリプトです。selector.js、overlay.js、element-text.js、picker-rows.js の関数を
 * recorder.js が使うため、この順で読み込みます。picker-rows.js は selector.js の関数を使います。
 */
const CONTENT_FILES = [
  'content/selector.js',
  'content/overlay.js',
  'content/element-text.js',
  'content/picker-rows.js',
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
      rowHints: [null],
      pagerHints: [null],
    };
    await chrome.storage.session.set({ [RECORDING_KEY]: recording });
    await chrome.storage.session.remove([
      LAST_FLOW_KEY,
      LAST_FLOW_HINTS_KEY,
      LAST_FLOW_PAGERS_KEY,
      DECLINED_SITES_KEY,
    ]);
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
      await chrome.storage.session.remove([RECORDING_KEY, RECORDING_PAGE_KEY, DECLINED_SITES_KEY]);
      await detach(recording.tabId);
      return { ok: true, flow: null, errors: [] };
    }

    /** @type {Flow} */
    const flow = {
      schemaVersion: SCHEMA_VERSION,
      name: `記録 ${new Date(recording.startedAt).toLocaleString('ja-JP')}`,
      origin: recording.origin,
      ...(recording.extraOrigins?.length ? { extraOrigins: recording.extraOrigins } : {}),
      ...(recording.params?.length ? { params: recording.params } : {}),
      steps: recording.steps,
    };
    await chrome.storage.session.set({
      [LAST_FLOW_KEY]: flow,
      [LAST_FLOW_HINTS_KEY]: alignHints(recording.steps, recording.rowHints),
      [LAST_FLOW_PAGERS_KEY]: alignHints(recording.steps, recording.pagerHints),
    });
    await chrome.storage.session.remove([RECORDING_KEY, RECORDING_PAGE_KEY, DECLINED_SITES_KEY]);
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
      const rowHints = /** @type {RowHint[]} */ (
        withoutStep(alignHints(recording.steps, recording.rowHints), index, count)
      );
      const pagerHints = /** @type {PagerHint[]} */ (
        withoutStep(alignHints(recording.steps, recording.pagerHints), index, count)
      );
      /** @type {Recording} */
      const next = { ...recording, steps, rowHints, pagerHints };
      // 手順を削除した後の最後の手順は、控えた時刻のクリックとは限らないため、ダウンロードを結び付けません（#223）。
      delete next.lastClickAt;
      // 削除した手順を使って終えた案内の段階は、終えていないことにします（#246）。
      if (next.guide && typeof index === 'number') {
        next.guide = guideAfterRemoval(next.guide, index);
      }
      await chrome.storage.session.set({ [RECORDING_KEY]: next });
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
      await chrome.storage.session.remove([
        LAST_FLOW_KEY,
        LAST_FLOW_HINTS_KEY,
        LAST_FLOW_PAGERS_KEY,
      ]);
    } else {
      const hints = alignHints(lastFlow.steps, await getLastFlowHints());
      const pagers = alignHints(lastFlow.steps, await getLastFlowPagers());
      await chrome.storage.session.set({
        [LAST_FLOW_KEY]: { ...lastFlow, steps },
        [LAST_FLOW_HINTS_KEY]: withoutStep(hints, index, count),
        [LAST_FLOW_PAGERS_KEY]: withoutStep(pagers, index, count),
      });
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
    await chrome.storage.session.remove([
      RECORDING_KEY,
      LAST_FLOW_KEY,
      LAST_FLOW_HINTS_KEY,
      LAST_FLOW_PAGERS_KEY,
      RECORDING_PAGE_KEY,
      DECLINED_SITES_KEY,
    ]);
    if (recording) {
      await detach(recording.tabId);
    }
    return { ok: true };
  });
}

/**
 * 記録中、または保存前の手順の範囲を、一覧の各行で繰り返す手順に変えます（#167）。
 * 表示が古い状態で押された場合に別の手順を変えないよう、表示していた手順の件数を受け取り、
 * 今の件数と一致しない場合は変えません。
 * @param {unknown} from 範囲の先頭（0 から数えます）
 * @param {unknown} to 範囲の末尾（この手順を含みます）
 * @param {unknown} key 選んだ行の候補（shared/record-loop.js の candidateKey の値）
 * @param {unknown} count 表示していた手順の件数
 * @param {unknown} [names] ファイル名に使う手順の番号（#179）
 * @param {unknown} [withSite] ファイル名の先頭にサイト名を入れるか（#179）
 * @param {unknown} [nextPage] 次のページへ送るクリックの番号（#182）。ページ送りをしない場合は省きます
 * @param {unknown} [dateStep] 対象の月の行だけを行う条件に使う日付の手順の番号（#183）。条件を付けない場合は省きます
 * @param {unknown} [stopAtOlder] 対象の月より古い行に達したら繰り返しを終えるか（#183）
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function makeRecordedLoop(
  from,
  to,
  key,
  count,
  names,
  withSite,
  nextPage,
  dateStep,
  stopAtOlder,
) {
  return enqueue(async () => {
    const recording = await getRecording();
    const lastFlow = recording ? undefined : await getLastFlow();
    const steps = recording?.steps ?? lastFlow?.steps;
    if (!steps) {
      return { ok: false, error: '繰り返しにする手順がありません。' };
    }
    if (count !== steps.length) {
      return {
        ok: false,
        error:
          '手順の一覧が変わったため、繰り返しにしませんでした。一覧を確かめてから押し直してください。',
      };
    }
    const hints = alignHints(steps, recording ? recording.rowHints : await getLastFlowHints());
    const pagers = alignHints(steps, recording ? recording.pagerHints : await getLastFlowPagers());
    const params = (recording ? recording.params : lastFlow?.params) ?? [];
    const result = makeLoop(
      steps,
      hints,
      from,
      to,
      key,
      names,
      withSite,
      { index: nextPage, pagers },
      { index: dateStep, stopAtOlder, params },
    );
    if (!result.ok) {
      return result;
    }
    const nextParams = result.param ? [...params, result.param] : params;
    if (recording) {
      /** @type {Recording} */
      const next = {
        ...recording,
        steps: result.steps,
        rowHints: result.hints,
        pagerHints: result.pagers,
        ...(nextParams.length > 0 ? { params: nextParams } : {}),
      };
      // 繰り返しに変えた後は、最後の手順が控えた時刻のクリックとは限らないため、ダウンロードを結び付けません（#223）。
      delete next.lastClickAt;
      // 繰り返しにした後は手順の番号が変わるため、案内（#246）を終えます。
      delete next.guide;
      await chrome.storage.session.set({ [RECORDING_KEY]: next });
    } else if (lastFlow) {
      await chrome.storage.session.set({
        [LAST_FLOW_KEY]: {
          ...lastFlow,
          ...(nextParams.length > 0 ? { params: nextParams } : {}),
          steps: result.steps,
        },
        [LAST_FLOW_HINTS_KEY]: result.hints,
        [LAST_FLOW_PAGERS_KEY]: result.pagers,
      });
    }
    return { ok: true };
  });
}

/**
 * 繰り返しを作った後に記録した「次へ」のクリックを、その繰り返しのページ送りにします（#237）。
 * 記録中の手順と、記録を停止した後の保存前の手順のどちらにも使えます。
 * @param {unknown} index 「次へ」のクリックの番号（0 から数えます）
 * @param {unknown} count 表示していた手順の件数
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function attachRecordedPager(index, count) {
  return enqueue(async () => {
    const recording = await getRecording();
    const lastFlow = recording ? undefined : await getLastFlow();
    const steps = recording?.steps ?? lastFlow?.steps;
    if (!steps) {
      return { ok: false, error: 'ページ送りにする手順がありません。' };
    }
    if (count !== steps.length) {
      return {
        ok: false,
        error:
          '手順の一覧が変わったため、ページ送りにしませんでした。一覧を確かめてから押し直してください。',
      };
    }
    const hints = alignHints(steps, recording ? recording.rowHints : await getLastFlowHints());
    const pagers = alignHints(steps, recording ? recording.pagerHints : await getLastFlowPagers());
    const result = attachPager(steps, hints, pagers, index);
    if (!result.ok) {
      return result;
    }
    if (recording) {
      await chrome.storage.session.set({
        [RECORDING_KEY]: {
          ...recording,
          steps: result.steps,
          rowHints: result.hints,
          pagerHints: result.pagers,
        },
      });
    } else if (lastFlow) {
      await chrome.storage.session.set({
        [LAST_FLOW_KEY]: { ...lastFlow, steps: result.steps },
        [LAST_FLOW_HINTS_KEY]: result.hints,
        [LAST_FLOW_PAGERS_KEY]: result.pagers,
      });
    }
    return { ok: true };
  });
}

/**
 * 記録の目的を選びます（#246）。「自由に記録する」を選ぶと、案内を終えます。
 * @param {unknown} purpose
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function setRecordingGuide(purpose) {
  return enqueue(async () => {
    const recording = await getRecording();
    if (!recording) {
      return { ok: false, error: '記録中ではありません。' };
    }
    const guide = startGuide(purpose, recording.steps.length);
    /** @type {Recording} */
    const next = { ...recording };
    if (guide) {
      next.guide = guide;
    } else {
      delete next.guide;
    }
    await chrome.storage.session.set({ [RECORDING_KEY]: next });
    return { ok: true };
  });
}

/**
 * 案内の段階を、サイドパネルのボタンで進める・飛ばす・戻ります（#246）。
 * 戻る場合は、前の段階の始まりより後に記録した手順を削除します。
 * @param {unknown} action next（［このページから始める］など）、skip（［飛ばす］）、back（［ひとつ戻る］）
 * @param {unknown} count 表示していた手順の件数
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function stepRecordingGuide(action, count) {
  return enqueue(async () => {
    const recording = await getRecording();
    if (!recording?.guide) {
      return { ok: false, error: '案内付きの記録ではありません。' };
    }
    if (count !== recording.steps.length) {
      return { ok: false, error: STALE_STEPS_ERROR };
    }
    /** @type {Recording} */
    const next = { ...recording };
    if (action === 'next' && waitsForPick(recording.guide)) {
      // 一覧のページへ戻った後に、2 件目の同じものを押してもらうのを待ち始めます（#247）。
      if (pickCandidates(recording.steps).length === 0) {
        return { ok: false, error: '1 件目の操作を記録してから押してください。' };
      }
      next.picking = true;
      await chrome.storage.session.set({ [RECORDING_KEY]: next });
      await sendPickSecond(next);
      return { ok: true };
    } else if (action === 'back' && recording.picking && waitsForPick(recording.guide)) {
      // 待っている間の［ひとつ戻る］は、待つのをやめます。
      delete next.picking;
      await chrome.storage.session.set({ [RECORDING_KEY]: next });
      await chrome.tabs
        .sendMessage(recording.tabId, { kind: 'recorder/pickCancel' }, { frameId: 0 })
        .catch(() => {});
      return { ok: true };
    } else if (action === 'next' || action === 'skip') {
      next.guide = guideNext(
        recording.guide,
        recording.steps.length,
        action === 'next' ? 'button' : 'skip',
      );
    } else if (action === 'back') {
      const back = guideBack(recording.guide);
      if (!back) {
        return { ok: false, error: '最初の段階のため、戻れません。' };
      }
      next.guide = back.guide;
      next.steps = recording.steps.slice(0, back.keep);
      next.rowHints = alignHints(recording.steps, recording.rowHints).slice(0, back.keep);
      next.pagerHints = alignHints(recording.steps, recording.pagerHints).slice(0, back.keep);
      delete next.lastClickAt;
      delete next.lastHref;
    } else {
      return { ok: false, error: '案内の操作が正しくありません。' };
    }
    await chrome.storage.session.set({ [RECORDING_KEY]: next });
    return { ok: true };
  });
}

/**
 * 記録した手順が変わった後に、案内付きの記録（#246、#247）の段階を確かめ直します。
 * @param {Recording} recording 変更する記録中の状態
 */
function refreshGuide(recording) {
  if (recording.guide) {
    recording.guide = guideAfterStep(recording.guide, recording.steps, recording.pagerHints);
  }
}

/**
 * 手順と同じ数の、手順に添える値（行の候補、ページ送りに使う場合の指定）の配列を返します。値を持たない記録
 * （この機能より前に始めた記録など）では、足りない分を null で補います。
 * @template T
 * @param {Step[]} steps
 * @param {T[] | undefined} hints
 * @returns {(T | null)[]}
 */
function alignHints(steps, hints) {
  const list = Array.isArray(hints) ? hints : [];
  return steps.map((_, index) => list[index] ?? null);
}

/** @returns {Promise<PagerHint[] | undefined>} */
async function getLastFlowPagers() {
  const stored = await chrome.storage.session.get(LAST_FLOW_PAGERS_KEY);
  return /** @type {PagerHint[] | undefined} */ (stored[LAST_FLOW_PAGERS_KEY]);
}

/** @returns {Promise<RowHint[] | undefined>} */
async function getLastFlowHints() {
  const stored = await chrome.storage.session.get(LAST_FLOW_HINTS_KEY);
  return /** @type {RowHint[] | undefined} */ (stored[LAST_FLOW_HINTS_KEY]);
}

/**
 * 指定した番号の手順を除いた、新しい手順の配列を返します。元の配列は変更しません。
 * 番号が範囲外の場合と、件数が一致しない場合は null を返します。
 * @template T
 * @param {T[]} steps
 * @param {unknown} index 削除する手順の番号（0 から数えます）
 * @param {unknown} count 削除を指示した画面が表示していた手順の件数
 * @returns {T[] | null}
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
 * @param {unknown} [rows] 操作した要素を含む一覧の行の候補（content/picker-rows.js の rowCandidates、#167）
 * @param {unknown} [pager] 押した要素をページ送りに使う場合の指定（content/picker-rows.js の pagerSelectors、#182）
 * @param {unknown} [href] 押したリンクのリンク先（#185）
 * @returns {Promise<void>}
 */
export function addStep(step, sender, texts, matchedSelector, keys, rows, pager, href) {
  return enqueue(async () => {
    const recording = await getRecording();
    if (
      !recording ||
      sender.tab?.id !== recording.tabId ||
      sender.frameId === undefined ||
      !sender.url ||
      !isWebUrl(sender.url) ||
      validateStep(step).length > 0 ||
      // 条件分岐と繰り返し（#6）は記録では作りません。ページから届いた場合も受け付けません。
      CONTROL_STEP_TYPES.includes(String(/** @type {{ type?: unknown }} */ (step).type)) ||
      recording.steps.length >= MAX_STEPS
    ) {
      return;
    }
    // iframe の中の操作（#20）は、最上位のページに直接埋め込まれた iframe のものだけを受け付けます。
    // 手順の origin は最上位のページのサイトにし、iframe のサイトは要素の指定（target の frame）に残します。
    const inFrame = sender.frameId !== 0;
    const pageUrl = inFrame ? await topFrameUrl(recording.tabId, sender.frameId) : sender.url;
    if (pageUrl === undefined) {
      return;
    }
    const origin = new URL(pageUrl).origin;
    const frameOrigin = new URL(sender.url).origin;
    const extraOrigins = recording.extraOrigins ?? [];
    const isExtra = origin !== recording.origin;
    /** 新しく extraOrigins に加えるサイトです。 */
    const added = [...new Set([origin, frameOrigin])].filter(
      (site) => site !== recording.origin && !extraOrigins.includes(site),
    );
    if (extraOrigins.length + added.length > MAX_EXTRA_ORIGINS) {
      return;
    }
    for (const site of added) {
      if (!(await chrome.permissions.contains({ origins: [`${site}/*`] }))) {
        return;
      }
    }
    // content script から届いた origin は使いません。
    const received = { .../** @type {Record<string, unknown>} */ (step) };
    delete received.origin;
    // サイトごとの指定を先に確かめます。利用者が明示した指定のため、文言による判定より優先します。
    // iframe の中の操作では、要素がある iframe のサイトの指定を使います（#20）。
    const ruled = applyStopRuleToRecordedStep(
      /** @type {Step} */ (received),
      recording.steps.at(-1),
      await getStopRule(frameOrigin),
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
    } else if (await getConfirmDetection()) {
      // 確定ボタンの自動検出を無効にしている間（#47）は、文言による判定を行わず、クリックのまま記録します。
      // 上のサイトごとの指定は、利用者が明示した指定のため、設定にかかわらず確かめます。
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
      }
      // iframe の中の要素には、その iframe の指定を付けます（#20）。ページから届いた指定は使いません。
      if ('target' in recorded) {
        const target = { ...recorded.target };
        delete target.frame;
        const key = inFrame ? frameKey(sender.url) : undefined;
        recorded = /** @type {Step} */ ({
          ...recorded,
          target: key === undefined ? target : { ...target, frame: { url: key } },
        });
      }
      if (added.length > 0) {
        recording.extraOrigins = [...extraOrigins, ...added];
      }
      // 一時停止に変えた手順は要素を操作しないため、行の候補を添えません。iframe の中の要素も、一覧の行は
      // 最上位のページで探すため、添えません（#20）。
      const hint = recorded.type === received.type && !inFrame ? sanitizeRowHint(rows) : null;
      recording.rowHints = [...alignHints(recording.steps, recording.rowHints), hint];
      // ページ送りに使えるのは、最上位のページでそのまま記録したクリックだけです（#182）。
      const pagerHint =
        recorded.type === 'click' && received.type === 'click' && !inFrame
          ? sanitizePagerHint(pager)
          : null;
      recording.pagerHints = [...alignHints(recording.steps, recording.pagerHints), pagerHint];
      // 押したリンクのリンク先は、そのページと同じサイトの URL だけを残します（#185）。
      if (
        !inFrame &&
        recorded.type === 'click' &&
        typeof href === 'string' &&
        isWebUrl(href) &&
        new URL(href).origin === origin
      ) {
        recording.lastHref = href;
      } else {
        delete recording.lastHref;
      }
      // クリックの時刻は、直後に始まったダウンロードを結び付けるために控えます（#223）。
      if (recorded.type === 'click') {
        recording.lastClickAt = Date.now();
      } else {
        delete recording.lastClickAt;
      }
      recording.steps.push(recorded);
      // 案内付きの記録（#246）では、記録した手順で次の段階へ進むかを決めます。
      if (recording.guide) {
        recording.guide = guideAfterStep(recording.guide, recording.steps, recording.pagerHints);
      }
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
    // リンクのクリックで PDF などのファイルへ移動した場合は、移動を記録せず、クリックをリンク先のファイルを
    // 保存する指定に変えます（#172）。表示画面で開くだけでは、ファイルが保存されないためです。
    const cause = navigationCause(details);
    const converted = toLinkDownload(
      recording.steps.at(-1),
      details.url,
      cause,
      recording.lastHref,
    );
    delete recording.lastHref;
    delete recording.lastClickAt;
    if (converted) {
      recording.steps[recording.steps.length - 1] = converted;
      refreshGuide(recording);
      await chrome.storage.session.set({ [RECORDING_KEY]: recording });
      return;
    }
    recording.rowHints = [...alignHints(recording.steps, recording.rowHints), null];
    recording.pagerHints = [...alignHints(recording.steps, recording.pagerHints), null];
    recording.steps.push({ type: 'navigate', url: details.url, cause });
    refreshGuide(recording);
    await chrome.storage.session.set({ [RECORDING_KEY]: recording });
  });
}

/**
 * 記録中にダウンロードが始まったときに、直前に記録したクリックで始まったものであれば、そのクリックを
 * ダウンロードを保存する指定に変えます（#223）。実行するときは、クリックで始まったファイルを、指定の保存先に
 * 保存します。記録中のダウンロードそのものは止めず、Chrome の通常のダウンロードのままにします。
 * @param {chrome.downloads.DownloadItem} item
 * @returns {Promise<void>}
 */
export function onDownloadCreated(item) {
  return enqueue(async () => {
    const recording = await getRecording();
    const previous = recording?.steps.at(-1);
    if (!recording || recording.lastClickAt === undefined || !previous) {
      return;
    }
    const site = ('origin' in previous ? previous.origin : undefined) ?? recording.origin;
    const converted = toClickDownload(previous, item, site, Date.now() - recording.lastClickAt);
    if (!converted) {
      return;
    }
    // 1 回のクリックで複数のファイルが始まった場合も、変えるのは 1 回だけです。
    delete recording.lastClickAt;
    recording.steps[recording.steps.length - 1] = converted;
    // ダウンロードの保存に変わったクリックで、案内の「保存」の段階を終えます（#247）。
    refreshGuide(recording);
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
  if (!recording || details.tabId !== recording.tabId) {
    return;
  }
  if (details.frameId === 0) {
    await attach(recording);
  } else if (details.parentFrameId === 0) {
    // 最上位のページに埋め込まれた iframe が読み込まれた場合です（#20）。最上位のページで記録している場合だけ、
    // iframe にも読み込みます。
    const stored = await chrome.storage.session.get(RECORDING_PAGE_KEY);
    const page = /** @type {RecordingPage | undefined} */ (stored[RECORDING_PAGE_KEY]);
    if (page?.allowed) {
      await attachFrames(recording, page);
    }
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
  const frame = await chrome.webNavigation.getFrame({ tabId: recording.tabId, frameId: 0 });
  if (!frame || !isWebUrl(frame.url)) {
    await setRecordingBadge(recording.tabId, true);
    await chrome.storage.session.remove(RECORDING_PAGE_KEY);
    return;
  }
  const origin = new URL(frame.url).origin;
  const allowed =
    origin === recording.origin ||
    (await chrome.permissions.contains({ origins: [`${origin}/*`] }));
  await setRecordingBadge(recording.tabId, allowed);
  /** @type {RecordingPage} */
  const page = { origin, allowed };
  await chrome.storage.session.set({ [RECORDING_PAGE_KEY]: page });
  if (!allowed) {
    return;
  }
  await injectRecorder(recording.tabId, 0, origin);
  // 2 件目を押してもらうのを待っている間にページを移動した場合（詳細のページから一覧へ戻った場合など）は、
  // 読み込み直したスクリプトにも待つよう伝えます（#241）。
  if (recording.picking) {
    await sendPickSecond(recording);
  }
  await attachFrames(recording, page);
}

/**
 * 1 件目で記録した手順のうち、ページで要素を探せる手順の番号と指定を返します（#241）。iframe と Shadow DOM の中の
 * 要素と、すでに繰り返しの中にある手順は、最上位のページから指定だけでは探せないため除きます。
 * @param {Step[]} steps
 * @returns {{ index: number, selectors: string[] }[]}
 */
function pickCandidates(steps) {
  return steps.flatMap((step, index) =>
    PAGE_STEP_TYPES.includes(step.type) &&
    'target' in step &&
    step.target.frame === undefined &&
    step.target.shadow === undefined &&
    step.target.scope === undefined
      ? [{ index, selectors: [...step.target.selectors] }]
      : [],
  );
}

/**
 * 記録中のタブのページに、2 件目の同じものを押してもらうのを待つよう伝えます（#241）。
 * @param {Recording} recording
 * @returns {Promise<boolean>} 伝えられたか
 */
async function sendPickSecond(recording) {
  return chrome.tabs
    .sendMessage(
      recording.tabId,
      { kind: 'recorder/pickSecond', candidates: pickCandidates(recording.steps) },
      { frameId: 0 },
    )
    .then(
      () => true,
      () => false,
    );
}

/**
 * 繰り返しにする前に、2 件目の同じものを押してもらうのを待ち始めます（#241）。押された 2 か所から 1 件分を決め
 * （onSecondPicked）、利用者に件数や枠を選ばせないためです。
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export function startPickSecond() {
  return enqueue(async () => {
    const recording = await getRecording();
    if (!recording) {
      return {
        ok: false,
        error: '記録中に行ってください。記録を始め直し、1 件目の操作を記録してください。',
      };
    }
    if (pickCandidates(recording.steps).length === 0) {
      return { ok: false, error: '1 件目の操作を記録してから押してください。' };
    }
    await chrome.storage.session.set({ [RECORDING_KEY]: { ...recording, picking: true } });
    await sendPickSecond(recording);
    return { ok: true };
  });
}

/**
 * 2 件目の同じものを押してもらうのをやめます（#241）。
 * @returns {Promise<{ ok: true }>}
 */
export function cancelPickSecond() {
  return enqueue(async () => {
    const recording = await getRecording();
    if (recording?.picking) {
      /** @type {Recording} */
      const next = { ...recording };
      delete next.picking;
      await chrome.storage.session.set({ [RECORDING_KEY]: next });
      await chrome.tabs
        .sendMessage(recording.tabId, { kind: 'recorder/pickCancel' }, { frameId: 0 })
        .catch(() => {});
    }
    return { ok: true };
  });
}

/**
 * ページで 2 件目が押され、1 件分の行が決まったときに、手順に添える行の候補を、その行だけにします（#241）。
 * 行の中の手順には、その行の候補を 1 つだけ添え、ほかの手順の候補は除きます。繰り返しの欄が、この行で範囲と
 * 「1 件の中」の手順を決めるためです。送信元が記録中のタブの最上位のページであることを確かめます。
 * @param {unknown} result content/picker-rows.js の rowsFromExamples の値
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<void>}
 */
export function onSecondPicked(result, sender) {
  return enqueue(async () => {
    const recording = await getRecording();
    if (
      !recording?.picking ||
      sender.tab?.id !== recording.tabId ||
      sender.frameId !== 0 ||
      typeof result !== 'object' ||
      result === null
    ) {
      return;
    }
    const { items, count, inners } = /** @type {Record<string, any>} */ (result);
    if (typeof inners !== 'object' || inners === null) {
      return;
    }
    /** @type {RowHint[]} */
    const rowHints = recording.steps.map((_, index) =>
      Object.hasOwn(inners, String(index))
        ? sanitizeRowHint([{ items, count, inner: inners[String(index)] }])
        : null,
    );
    if (!rowHints.some((hint) => hint !== null)) {
      return;
    }
    /** @type {Recording} */
    const next = { ...recording, rowHints };
    delete next.picking;
    // 案内付きの記録では、2 件目の段階を終えます（#247）。
    if (next.guide) {
      next.guide = guideAfterPicked(next.guide, next.steps.length);
    }
    await chrome.storage.session.set({ [RECORDING_KEY]: next });
  });
}

/**
 * 記録中であることを、ツールバーのアイコンに表示します。許可がないサイトのページでは、記録が止まっていることを
 * 「許可」（黄）で示します（#209）。利用者はサイトの画面に集中しているため、画面の近くで変化に気づけるようにします。
 * @param {number} tabId
 * @param {boolean} allowed 表示中のページで記録しているか
 */
async function setRecordingBadge(tabId, allowed) {
  await chrome.action.setBadgeText({ tabId, text: allowed ? 'REC' : '許可' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: allowed ? '#d93025' : '#f59f00' });
  await chrome.action.setBadgeTextColor({ tabId, color: allowed ? '#ffffff' : '#1d273b' });
}

/**
 * 記録用のスクリプトを、タブの 1 つのフレームに読み込みます。
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} origin そのフレームのページのサイト。サイトごとの止める要素の指定（#54）を選ぶために使います
 */
async function injectRecorder(tabId, frameId, origin) {
  try {
    // サイトごとの止める要素の指定（#54）を、記録用のスクリプトより先にページへ置きます。
    // 記録用のスクリプトは extension/shared/ を読み込めないため、値として渡します。
    const { selectors } = await getStopRule(origin);
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (/** @type {string[]} */ stopSelectors) => {
        /** @type {Record<string, unknown>} */ (
          /** @type {unknown} */ (globalThis)
        ).__lightomateStopSelectors = stopSelectors;
      },
      args: [selectors],
    });
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: CONTENT_FILES,
    });
  } catch (error) {
    // 読み込みの途中でページを移動した場合などに失敗します。移動先のページで読み込み直します。
    console.warn('記録用のスクリプトを読み込めませんでした。', error);
  }
}

/**
 * 記録中のタブの、最上位のページに直接埋め込まれた iframe のうち、操作の許可があるサイトのものに、記録用の
 * スクリプトを読み込みます（#20）。許可がないサイトの iframe には読み込まず、そのうち画面に見える iframe のサイトを
 * サイドパネルに知らせ、ツールバーのアイコンを「許可」にします（#230）。広告や計測のための見えない iframe は知らせません。
 * 2 段以上の埋め込み（iframe の中の iframe）は対象にしません。
 * @param {Recording} recording
 * @param {RecordingPage} page 最上位のページの表示の状態。許可がない iframe のサイトを加えて保存し直します
 */
async function attachFrames(recording, page) {
  const frames =
    (await chrome.webNavigation.getAllFrames({ tabId: recording.tabId }).catch(() => null)) ?? [];
  /** @type {Set<string>} */
  const blocked = new Set();
  for (const frame of frames) {
    if (frame.frameId === 0 || frame.parentFrameId !== 0 || !isWebUrl(frame.url)) {
      continue;
    }
    const origin = new URL(frame.url).origin;
    const allowed =
      origin === recording.origin ||
      (await chrome.permissions.contains({ origins: [`${origin}/*`] }));
    if (allowed) {
      await injectRecorder(recording.tabId, frame.frameId, origin);
    } else {
      blocked.add(origin);
    }
  }
  if (blocked.size > 0) {
    const visible = await visibleFrames(recording.tabId);
    // 大きさを測れなかった場合は、知らせを出す側に寄せます。決済の枠を知らせずに見落とすことを避けるためです。
    if (visible) {
      for (const origin of [...blocked]) {
        if (!visible.has(origin)) {
          blocked.delete(origin);
        }
      }
    }
  }
  const stored = await chrome.storage.session.get(RECORDING_PAGE_KEY);
  const current = /** @type {RecordingPage | undefined} */ (stored[RECORDING_PAGE_KEY]);
  // 最上位のページを移動した後に、移動の前のページの iframe の結果で上書きしないためです。
  if (current && current.origin !== page.origin) {
    return;
  }
  await setRecordingBadge(recording.tabId, page.allowed && blocked.size === 0);
  /** @type {RecordingPage} */
  const next = { origin: page.origin, allowed: page.allowed };
  if (blocked.size > 0) {
    next.blockedFrames = [...blocked].sort();
  }
  await chrome.storage.session.set({ [RECORDING_PAGE_KEY]: next });
}

/**
 * 最上位のページの記録用のスクリプトに枠の大きさを測らせ、画面に見える枠のサイトを返します（#230）。
 * 測れなかった場合（スクリプトがまだない場合など）は null です。
 * @param {number} tabId
 * @returns {Promise<Set<string> | null>}
 */
async function visibleFrames(tabId) {
  try {
    const measures = await chrome.tabs.sendMessage(
      tabId,
      { kind: 'recorder/frameSizes' },
      { frameId: 0 },
    );
    return Array.isArray(measures) ? visibleFrameOrigins(measures) : null;
  } catch {
    return null;
  }
}

/**
 * 最上位のページの枠の大きさが変わったときに、許可がない枠の知らせを判定し直します（#230）。
 * 最初は隠れていて、操作の後に表示される決済の枠を取りこぼさないためです。
 * 送信元が記録中のタブの最上位のページで、そのページで記録している場合だけ受け付けます。
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<void>}
 */
export async function onFramesChanged(sender) {
  const recording = await getRecording();
  if (!recording || sender.tab?.id !== recording.tabId || sender.frameId !== 0) {
    return;
  }
  const stored = await chrome.storage.session.get(RECORDING_PAGE_KEY);
  const page = /** @type {RecordingPage | undefined} */ (stored[RECORDING_PAGE_KEY]);
  if (!page?.allowed || !sender.url || !isWebUrl(sender.url)) {
    return;
  }
  if (new URL(sender.url).origin !== page.origin) {
    return;
  }
  await attachFrames(recording, page);
}

/**
 * iframe の送信元が、最上位のページに直接埋め込まれた iframe であれば、最上位のページの URL を返します（#20）。
 * そうでない場合と、最上位のページが Web ページでない場合は undefined です。
 * @param {number} tabId
 * @param {number} frameId
 * @returns {Promise<string | undefined>}
 */
async function topFrameUrl(tabId, frameId) {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId }).catch(() => null);
  if (!frame || frame.parentFrameId !== 0) {
    return undefined;
  }
  const top = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
  return top && isWebUrl(top.url) ? top.url : undefined;
}

/**
 * 記録中のタブで表示しているサイトでも記録を始めます（#41）。サイドパネルの［このサイトを許可して記録］で、
 * 許可を得た後に呼び出します。記録中のタブが今そのサイトを表示していることと、許可があることを確かめます。
 * 最上位のページに埋め込まれた iframe のサイト（#20）も、同じように受け付けます。
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
    (new URL(frame.url).origin !== origin && !(await hasChildFrame(recording.tabId, origin)))
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
 * 最上位のページに、指定したサイトの iframe が直接埋め込まれているかを判定します（#20）。
 * @param {number} tabId
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
async function hasChildFrame(tabId, origin) {
  const frames = (await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null)) ?? [];
  return frames.some(
    (frame) =>
      frame.frameId !== 0 &&
      frame.parentFrameId === 0 &&
      isWebUrl(frame.url) &&
      new URL(frame.url).origin === origin,
  );
}

/**
 * 記録の表示を消し、ページの記録用のスクリプトを止めます。iframe の中のスクリプト（#20）も止めます。
 * @param {number} tabId
 */
async function detach(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.tabs.sendMessage(tabId, { kind: 'recorder/stop' });
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
