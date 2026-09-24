// 記録した要素の指定（Target）から、ページの要素を探します。
//
// content script は ES モジュールとして読み込めないため、通常のスクリプトとして読み込みます。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。

/* exported waitForTarget */

/**
 * 要素が見つかるまで待ちます。見つからないまま上限の時間を過ぎた場合は null を返します。
 *
 * ページの読み込みが遅い場合や、操作の後に要素が表示される場合に備え、ページの変化を
 * MutationObserver で監視します。表示・非表示の切り替えは監視で捉えられないことがあるため、
 * 一定の間隔でも探し直します。
 * @param {{ selectors: string[], tag: string, text?: string }} target
 * @param {number} timeoutMs 待つ上限（ミリ秒）
 * @returns {Promise<Element | null>}
 */
function waitForTarget(target, timeoutMs) {
  const found = findTarget(target);
  if (found) {
    return Promise.resolve(found);
  }

  return new Promise((resolve) => {
    /** @param {Element | null} element */
    const finish = (element) => {
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timeout);
      resolve(element);
    };
    const retry = () => {
      const element = findTarget(target);
      if (element) {
        finish(element);
      }
    };
    const observer = new MutationObserver(retry);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const interval = setInterval(retry, 250);
    const timeout = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * 要素を探します。セレクターを優先する順に試し、表示されている要素だけを対象にします。
 * どのセレクターでも見つからない場合は、タグ名と表示文字列が一致する要素が 1 つだけあれば、それを使います。
 * @param {{ selectors: string[], tag: string, text?: string }} target
 * @returns {Element | null}
 */
function findTarget(target) {
  for (const selector of target.selectors) {
    let element = null;
    try {
      element = document.querySelector(selector);
    } catch {
      // 誤ったセレクター（JSON を手で編集した場合など）は飛ばします。
    }
    if (element && isDisplayed(element)) {
      return element;
    }
  }

  if (target.text) {
    let candidates;
    try {
      candidates = Array.from(document.querySelectorAll(target.tag));
    } catch {
      return null;
    }
    const matches = candidates.filter(
      (element) => isDisplayed(element) && displayedText(element) === target.text,
    );
    if (matches.length === 1) {
      return matches[0];
    }
  }
  return null;
}

/**
 * 要素が画面上に表示されているかを判定します。
 * @param {Element} element
 * @returns {boolean}
 */
function isDisplayed(element) {
  return element.isConnected && element.getClientRects().length > 0;
}

/**
 * 要素の表示文字列を、記録時（selector.js の visibleText）と同じ方法で返します。
 * @param {Element} element
 * @returns {string}
 */
function displayedText(element) {
  if (element instanceof HTMLInputElement) {
    if (['button', 'submit', 'reset'].includes(element.type)) {
      return element.value.replace(/\s+/g, ' ').trim();
    }
    return element.type === 'image'
      ? (element.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim()
      : '';
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return '';
  }
  const text = element instanceof HTMLElement ? element.innerText : element.textContent;
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > 100 ? `${normalized.slice(0, 100)}…` : normalized;
}
