// 記録した要素の指定（Target）から、ページの要素を探します。
//
// content script は ES モジュールとして読み込めないため、通常のスクリプトとして読み込みます。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。

/* exported waitForTarget, findAllTargets, searchRoot */

/**
 * 要素が見つかるまで待ちます。見つからないまま上限の時間を過ぎた場合は null を返します。
 *
 * ページの読み込みが遅い場合や、操作の後に要素が表示される場合に備え、ページの変化を
 * MutationObserver で監視します。表示・非表示の切り替えは監視で捉えられないことがあるため、
 * 一定の間隔でも探し直します。
 * @param {{ selectors: string[], tag: string, text?: string }} target
 * @param {number} timeoutMs 待つ上限（ミリ秒）
 * @param {AbortSignal} signal 停止を指示されたときに、待つのをやめるためのもの
 * @param {Document | Element} [root] 探す範囲。繰り返しで処理中の行の内側だけを探す場合に指定します（#6）
 * @returns {Promise<Element | null>}
 */
function waitForTarget(target, timeoutMs, signal, root = document) {
  const found = findTarget(target, root);
  if (found || signal.aborted) {
    return Promise.resolve(found);
  }

  return new Promise((resolve) => {
    /** @param {Element | null} element */
    const finish = (element) => {
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve(element);
    };
    const onAbort = () => finish(null);
    const retry = () => {
      const element = findTarget(target, root);
      if (element) {
        finish(element);
      }
    };
    const observer = new MutationObserver(retry);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const interval = setInterval(retry, 250);
    const timeout = setTimeout(() => finish(null), timeoutMs);
    signal.addEventListener('abort', onAbort);
  });
}

/**
 * 要素を探します。セレクターを優先する順に試し、表示されている要素だけを対象にします。
 * どのセレクターでも見つからない場合は、タグ名と表示文字列が一致する要素が 1 つだけあれば、それを使います。
 * @param {{ selectors: string[], tag: string, text?: string }} target
 * @param {Document | Element} [root] 探す範囲
 * @returns {Element | null}
 */
function findTarget(target, root = document) {
  for (const selector of target.selectors) {
    let element = null;
    try {
      element = root.querySelector(selector);
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
      candidates = Array.from(root.querySelectorAll(target.tag));
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
 * 一覧の各行を探します（#6）。セレクターを優先する順に試し、表示されている要素が 1 つ以上見つかった
 * 最初のセレクターの、表示されている要素をすべて返します。表示文字列による手がかりは使いません。
 * @param {{ selectors: string[] }} items
 * @param {Document | Element} [root] 探す範囲
 * @returns {Element[]}
 */
function findAllTargets(items, root = document) {
  for (const selector of items.selectors) {
    /** @type {Element[]} */
    let elements = [];
    try {
      elements = Array.from(root.querySelectorAll(selector)).filter(isDisplayed);
    } catch {
      // 誤ったセレクターは飛ばします。
    }
    if (elements.length > 0) {
      return elements;
    }
  }
  return [];
}

/**
 * 要素を探す範囲を決めます（#6）。要素の指定に scope: item がある場合は、繰り返しで処理中の行です。
 * 行は、外側の繰り返しから順に、行の指定（items）と何件目か（index）をたどって探し直します。
 * 行の指定に scope: item がある場合は、1 つ外側の行の内側で探します。
 * @param {{ scope?: string }} target
 * @param {unknown} scope Service Worker から届いた、繰り返しの段ごとの行の指定と何件目か
 * @returns {{ ok: true, root: Document | Element } | { ok: false, error: string }}
 */
function searchRoot(target, scope) {
  if (target.scope !== 'item') {
    return { ok: true, root: document };
  }
  const levels = Array.isArray(scope) ? scope : [];
  if (levels.length === 0) {
    return {
      ok: false,
      error: '繰り返しの外で、行の内側の要素（scope: item）を探そうとしました。',
    };
  }
  /** @type {Document | Element} */
  let row = document;
  for (const level of levels) {
    const base = level?.items?.scope === 'item' ? row : document;
    const rows = findAllTargets(level.items, base);
    const found = rows[level.index];
    if (!found) {
      return {
        ok: false,
        error: `繰り返しの ${level.index + 1} 件目の行（${level.items.label}）が見つかりません。`,
      };
    }
    row = found;
  }
  return { ok: true, root: row };
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
