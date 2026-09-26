// Chrome の翻訳の有無による、止まった理由の説明です（#99）。chrome.* は使いません。
//
// Chrome の翻訳は、表示の文字を置き換えます。記録時と実行時で翻訳の有無が異なると、表示の文字を手がかりに
// 要素や選択肢を探す処理（content/finder.js の findTarget、content/runner.js の selectOptions）で
// 見つからなくなります。止まる側の誤りのため安全ですが、利用者には原因が分からないため、止まった理由に
// 翻訳の有無を加えます。翻訳の有無は、ページの html 要素の class（translated-ltr、translated-rtl）で
// 判定します（content/element-text.js の isPageTranslated）。

/** @typedef {import('./flow.js').Flow} Flow */
/** @typedef {import('./flow.js').Step} Step */

/** 手順の translated を使える最も古い版です（#99）。 */
export const TRANSLATED_MIN_SCHEMA_VERSION = 8;

/**
 * 手順を記録したときに、ページが翻訳されていたかを返します。
 * 版 8 より古いフローは、記録時の翻訳の有無を残していないため、undefined（不明）を返します。
 * @param {Pick<Flow, 'schemaVersion'>} flow
 * @param {Step} step
 * @returns {boolean | undefined}
 */
export function recordedTranslation(flow, step) {
  if (flow.schemaVersion < TRANSLATED_MIN_SCHEMA_VERSION) {
    return undefined;
  }
  return 'translated' in step && step.translated === true;
}

/**
 * 要素や選択肢が見つからなかったときに、止まった理由に加える翻訳の説明を返します。
 * 説明が不要な場合は undefined を返します。
 * - 記録時と実行時で翻訳の有無が異なる場合は、その旨を返します。
 * - 記録時の翻訳の有無が不明（版 7 以前のフロー）で、実行時に翻訳されている場合は、翻訳が原因の
 *   可能性を返します。記録時も翻訳されていた可能性があるため、異なるとは断定しません。
 * - 実行時の翻訳の有無が不明（ページから届かなかった）の場合は、何も返しません。
 * @param {boolean | undefined} recorded 記録時に翻訳されていたか。不明な場合は undefined
 * @param {unknown} current 実行時に翻訳されているか（ページから届いた値）
 * @returns {string | undefined}
 */
export function translationNote(recorded, current) {
  if (typeof current !== 'boolean') {
    return undefined;
  }
  if (recorded === undefined) {
    return current
      ? 'ページは Chrome の翻訳で表示の文字が置き換わっています。翻訳が原因で見つからない場合があります。翻訳をやめて原文の表示に戻してから、実行し直してください。'
      : undefined;
  }
  if (recorded === current) {
    return undefined;
  }
  return current
    ? '記録時と実行時で、ページの翻訳の有無が異なります。記録時は翻訳していませんでしたが、実行時は Chrome の翻訳で表示の文字が置き換わっています。翻訳をやめて原文の表示に戻してから、実行し直してください。'
    : '記録時と実行時で、ページの翻訳の有無が異なります。記録時は Chrome の翻訳で表示の文字が置き換わっていましたが、実行時は翻訳していません。記録時と同じくページを翻訳してから実行し直してください。';
}
