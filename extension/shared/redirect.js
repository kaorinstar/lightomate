// 記録時に起きた転送が、実行時に起きなかったかを判定します（#90）。chrome.* は使いません。
//
// ページの読み込みが終わった後にサイトのスクリプトが転送すると、記録には「移動」と「転送による移動」
// （navigate、cause が page）が続けて残ります。ログアウトした状態で記録し、ログイン済みの状態で実行する
// 場合など、実行時にその転送が起きないと、転送を待つ手順は新しいページが現れないまま 30 秒待って止まります。
// そのため、直前の手順も移動の手順である場合に限り、移動が始まらない状態が一定の時間続いたら、転送が
// 起きなかったと判定し、転送を待つ手順を飛ばします。
//
// クリックなどの操作の後の移動は対象にしません。操作が効かなかった可能性があり、止める側が安全だからです。

import { pageUrlForHistory } from './history.js';

/** 移動が始まらない状態がこの時間続いたら、転送が起きなかったと判定します。 */
export const MISSING_REDIRECT_MS = 5_000;

/** @typedef {import('./flow.js').Step} Step */

/**
 * 転送を待つ手順が、転送が起きなかったかを判定する対象かを返します。
 * 直前に実行した手順も移動の手順である場合だけが対象です。
 * @param {Step} step 転送を待つ手順
 * @param {Step | undefined} previous 直前に実行した手順。条件分岐や繰り返しの判定を挟んだ場合は undefined です
 * @returns {boolean}
 */
export function isRedirectAfterLoad(step, previous) {
  return step.type === 'navigate' && step.cause === 'page' && previous?.type === 'navigate';
}

/**
 * タブの状態の 1 回分の観測です。
 * @typedef {object} TabSample
 * @property {string | undefined} documentId 最上位のフレームのページの識別子
 * @property {string | undefined} status タブの読み込みの状態（loading、complete）
 * @property {string | undefined} pendingUrl 始まっている移動の移動先
 */

/**
 * タブの状態を観測した結果から、転送が起きなかったかを判定します。
 * - missing：移動が始まらない状態が MISSING_REDIRECT_MS 続きました。転送は起きなかったと判定します。
 * - navigating：移動が始まったか、ページが変わりました。転送を待つ処理に移ります。
 * - waiting：まだ判定できません。
 * @param {string} documentBefore 直前の移動の後のページの識別子
 * @param {TabSample} sample
 * @param {number} since 観測を始めた時刻（ミリ秒）
 * @param {number} now 現在の時刻（ミリ秒）
 * @returns {'missing' | 'navigating' | 'waiting'}
 */
export function observeRedirect(documentBefore, sample, since, now) {
  if (
    sample.documentId !== documentBefore ||
    sample.status !== 'complete' ||
    (sample.pendingUrl !== undefined && sample.pendingUrl !== '')
  ) {
    return 'navigating';
  }
  return now - since >= MISSING_REDIRECT_MS ? 'missing' : 'waiting';
}

/**
 * 転送を飛ばした後に実行が失敗した場合に、止まった理由の最後に加える説明です。
 * URL は、実行履歴と同じく ? 以降と # 以降を除きます。
 * @param {string} url 記録時の転送先
 * @returns {string}
 */
export function skippedRedirectNote(url) {
  const shown = pageUrlForHistory(url, []) ?? url;
  return `この実行では、記録時にあった転送（${shown}）が起きなかったため、転送を待つ手順を飛ばしました。`;
}
