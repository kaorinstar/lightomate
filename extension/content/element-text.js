// 要素の文言を集めます。確定ボタンかどうかの判定（#29）に使います。
//
// 判定そのものは Service Worker で行います（extension/shared/purchase-guard.js）。content script は
// ES モジュールの extension/shared/ を読み込めないため、ここでは文言を集めて送るだけにします。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。

/* exported elementTexts, matchStopSelector */

/**
 * 要素の表示文字列、aria-label、title、value と、要素の中の画像の alt を返します。
 * @param {Element} element
 * @returns {string[]}
 */
function elementTexts(element) {
  // 1 つの文言の長さの上限です。一覧の行全体のような大きな要素の文字列を送らないためです。
  // 同じページに 2 回読み込まれても誤りにならないよう、定数も関数の中に置きます。
  const limit = 200;
  /** @type {string[]} */
  const texts = [];
  const add = (/** @type {string | null | undefined} */ text) => {
    const trimmed = text?.replace(/\s+/g, ' ').trim();
    if (trimmed) {
      texts.push(trimmed.slice(0, limit));
    }
  };

  add(element instanceof HTMLElement ? element.innerText : element.textContent);
  for (const name of ['aria-label', 'title', 'alt']) {
    add(element.getAttribute(name));
  }
  if (element instanceof HTMLInputElement && ['submit', 'button', 'image'].includes(element.type)) {
    add(element.value);
  }
  for (const image of element.querySelectorAll('img[alt], [role="img"][aria-label]')) {
    add(image.getAttribute('alt') ?? image.getAttribute('aria-label'));
  }
  return texts;
}

/**
 * 要素、またはその祖先の要素が、止める要素の指定（CSS セレクター）のどれかに一致すれば、
 * その指定を返します（#54）。構文に誤りのある指定は飛ばします。
 * @param {Element} element
 * @param {unknown} selectors Service Worker から受け取った、止める要素の指定
 * @returns {string | undefined}
 */
function matchStopSelector(element, selectors) {
  if (!Array.isArray(selectors)) {
    return undefined;
  }
  return selectors.find((selector) => {
    try {
      return typeof selector === 'string' && element.closest(selector) !== null;
    } catch {
      return false;
    }
  });
}
