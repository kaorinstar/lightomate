// 記録中のページに埋め込まれた枠（iframe）が、画面に見えるかを判定します（#230）。
// 許可がない枠のうち、画面に見える枠についてだけ、記録が止まっていることを知らせます。広告や計測のための
// 見えない枠（1×1px や非表示）について許可を求めると、利用者が操作しない枠のために作業を妨げるためです。
// 広告のサイトの一覧は持たず、枠の大きさと表示の状態で判定します。一覧の保守が要らないようにするためです。
// 大きさは最上位のページの記録用のスクリプト（content/recorder.js）が測り、判定はここで行います。
// chrome.* は使いません。Node.js のテストから読み込むためです。

/** 画面に見える枠とみなす、幅と高さの下限です（ピクセル）。計測用の枠は 1×1px や 0×0px が多いためです。 */
export const MIN_VISIBLE_FRAME_SIZE = 30;

/**
 * 最上位のページの、1 つの枠の大きさと表示の状態です。
 * @typedef {object} FrameMeasure
 * @property {string} origin 枠の src のサイト。読み取れない場合は空の文字列
 * @property {number} width 表示の幅
 * @property {number} height 表示の高さ
 * @property {string} display 計算後の display
 * @property {string} visibility 計算後の visibility
 * @property {number} opacity 計算後の opacity
 * @property {number} right ページの左上から見た、枠の右端の位置
 * @property {number} bottom ページの左上から見た、枠の下端の位置
 */

/**
 * 枠が画面に見えるかを判定します。
 * 幅か高さが下限未満、非表示（display: none、visibility: hidden、透明度 0）、画面の外（左上の外側）の枠は
 * 見えないとします。
 * @param {FrameMeasure} measure
 * @returns {boolean}
 */
export function isVisibleFrame(measure) {
  return (
    measure.display !== 'none' &&
    measure.visibility !== 'hidden' &&
    measure.opacity > 0 &&
    measure.width >= MIN_VISIBLE_FRAME_SIZE &&
    measure.height >= MIN_VISIBLE_FRAME_SIZE &&
    measure.right > 0 &&
    measure.bottom > 0
  );
}

/**
 * 画面に見える枠のサイトを返します。同じサイトの枠が複数ある場合は、1 つでも見えれば含めます。
 * ページから届いた値のため、形が正しくないものは捨てます。
 * @param {unknown} measures
 * @returns {Set<string>}
 */
export function visibleFrameOrigins(measures) {
  /** @type {Set<string>} */
  const origins = new Set();
  if (!Array.isArray(measures)) {
    return origins;
  }
  for (const measure of measures) {
    if (isFrameMeasure(measure) && measure.origin && isVisibleFrame(measure)) {
      origins.add(measure.origin);
    }
  }
  return origins;
}

/**
 * @param {unknown} value
 * @returns {value is FrameMeasure}
 */
function isFrameMeasure(value) {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof item.origin === 'string' &&
    typeof item.display === 'string' &&
    typeof item.visibility === 'string' &&
    ['width', 'height', 'opacity', 'right', 'bottom'].every((key) => Number.isFinite(item[key]))
  );
}
