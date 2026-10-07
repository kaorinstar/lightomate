// 読み取った値の変化を知らせるかの判定です（#251）。
// chrome.* を使いません。前回の値の保存と通知は、background/watch-store.js と runner.js で行います。

/**
 * 値が変わったと判定した後、読み直すまで待つ時間（ミリ秒）です。Chrome の翻訳は、表示の後に少し遅れて
 * 文字を置き換えます。置き換えの途中の文字で知らせないよう、待ってから同じ要素を読み直し、2 回とも同じ
 * 値だった場合だけ知らせます。
 */
export const WATCH_RECHECK_MS = 3000;

/** 通知の本文に載せる値の長さの上限です。長い値は末尾を「…」にします。 */
export const WATCH_MESSAGE_VALUE_LENGTH = 40;

/**
 * 1 回目に読み取った値を、前回の値と比べます。
 * - remember：前回の値がありません（初回の実行）。知らせずに、値を覚えます。
 * - same：前回と同じ値です。何もしません。
 * - recheck：前回と異なります。待ってから読み直します（watchDecision）。
 * @param {string | undefined} previous 前回の実行で覚えた値
 * @param {string} first 今回読み取った値
 * @returns {'remember' | 'same' | 'recheck'}
 */
export function firstDecision(previous, first) {
  if (previous === undefined) {
    return 'remember';
  }
  return previous === first ? 'same' : 'recheck';
}

/**
 * 読み直した値から、知らせるかを決めます。
 * - notify：2 回とも同じ値で、前回と異なります。知らせて、値を覚えます。
 * - unsettled：1 回目と読み直した値が異なります。翻訳などで文字が置き換わる途中だったと考え、知らせず、
 *   値も覚えません。次の実行で、もう一度前回の値と比べます。
 * - same：読み直した値が前回と同じです（1 回目だけが置き換えの途中だった場合）。何もしません。
 * @param {string} previous 前回の実行で覚えた値
 * @param {string} first 1 回目に読み取った値
 * @param {string} second 待ってから読み直した値
 * @returns {'notify' | 'unsettled' | 'same'}
 */
export function watchDecision(previous, first, second) {
  if (second === previous) {
    return 'same';
  }
  return first === second ? 'notify' : 'unsettled';
}

/**
 * 通知の本文に載せる形に、値を短くします。
 * @param {string} value
 * @returns {string}
 */
function shorten(value) {
  return value.length > WATCH_MESSAGE_VALUE_LENGTH
    ? `${value.slice(0, WATCH_MESSAGE_VALUE_LENGTH)}…`
    : value;
}

/**
 * 通知の本文です。
 * @param {string} label 読み取った要素の説明（手順の target.label）
 * @param {string} previous
 * @param {string} current
 * @returns {string}
 */
export function watchMessage(label, previous, current) {
  return `「${label}」の値が変わりました：前回 ${shorten(previous)} → 今回 ${shorten(current)}`;
}
