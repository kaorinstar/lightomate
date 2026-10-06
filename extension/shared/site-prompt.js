// 記録中に許可がないサイトへ移動したときに開く、許可を求める小さい窓（#209）の判定と位置です。
// 窓は拡張機能の画面（sidepanel/allow-site.html）で、記録中のブラウザの窓の上部中央に重ねて開きます。
// 許可がないサイトのページの中には、拡張機能は何も表示できないためです。
// chrome.* は使いません。Node.js のテストから読み込むためです。

/** 許可を求める窓の幅です（ピクセル）。 */
export const SITE_PROMPT_WIDTH = 460;

/** 許可を求める窓の高さです（ピクセル）。OS が付けるタイトルバーを含むため、本文より余裕を持たせます。 */
export const SITE_PROMPT_HEIGHT = 330;

/**
 * 許可を求める窓の上端を、ブラウザの窓の上端からどれだけ下げるかです（ピクセル）。
 * タブとアドレスバーに重ねず、ページの上部に重ねるためです。
 */
export const SITE_PROMPT_TOP_OFFSET = 90;

/**
 * 許可を求める窓を開くかを判定します。次をすべて満たす場合だけ開きます。
 * - 表示中のページのサイトを操作する許可がない
 * - 記録を始めたサイトではない
 * - 同じ記録の間に、まだそのサイトで窓を開いていない（［記録しない］や［×］で閉じた後に開き直さないためです）
 * - 記録できるサイトの上限に達していない（許可しても記録できないためです）
 * @param {object} state
 * @param {string} state.origin 表示中のページのサイト
 * @param {boolean} state.allowed そのサイトを操作する許可があるか
 * @param {string} state.recordingOrigin 記録を始めたサイト
 * @param {string[]} state.extraOrigins 記録を始めたサイトのほかに、手順を記録したサイト
 * @param {string[]} state.prompted 同じ記録の間に、窓を開いたサイト
 * @param {number} state.maxExtraOrigins 記録を始めたサイトのほかに記録できるサイトの件数
 * @returns {boolean}
 */
export function shouldOpenSitePrompt({
  origin,
  allowed,
  recordingOrigin,
  extraOrigins,
  prompted,
  maxExtraOrigins,
}) {
  if (allowed || origin === recordingOrigin || prompted.includes(origin)) {
    return false;
  }
  return extraOrigins.includes(origin) || extraOrigins.length < maxExtraOrigins;
}

/**
 * 許可を求める窓の位置を、ブラウザの窓の上部中央にします。
 * ブラウザの窓が許可を求める窓より狭い場合は、左端をそろえます。画面の外に出さないためです。
 * @param {{ left?: number, top?: number, width?: number }} browserWindow 記録中のブラウザの窓
 * @returns {{ left: number, top: number }}
 */
export function sitePromptPosition(browserWindow) {
  const left = browserWindow.left ?? 0;
  const top = browserWindow.top ?? 0;
  const width = browserWindow.width ?? SITE_PROMPT_WIDTH;
  return {
    left: left + Math.max(0, Math.round((width - SITE_PROMPT_WIDTH) / 2)),
    top: top + SITE_PROMPT_TOP_OFFSET,
  };
}
