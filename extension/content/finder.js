// 記録した要素の指定（Target）から、ページの要素を探します。
//
// content script は ES モジュールとして読み込めないため、通常のスクリプトとして読み込みます。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。

/* exported waitForTarget, findAllTargets, searchRoot, missingShadowHost */
/* global shadowRootOf */

/**
 * 要素が見つかるまで待ちます。見つからないまま上限の時間を過ぎた場合は null を返します。
 *
 * ページの読み込みが遅い場合や、操作の後に要素が表示される場合に備え、ページの変化を
 * MutationObserver で監視します。表示・非表示の切り替えは監視で捉えられないことがあるため、
 * 一定の間隔でも探し直します。
 * Shadow DOM の中の変化は監視で捉えられないため、Shadow DOM の中の要素（#20）は、一定の間隔で探し直して待ちます。
 * @param {{ selectors: string[], tag: string, text?: string, shadow?: string[] }} target
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
 * 1 つのセレクターに複数の要素が一致する場合は、表示されている最初の要素を使います。前に開いて隠した小さな枠の
 * リンクが、ページの先にある場合などに備えます（#185）。
 * どのセレクターでも見つからない場合は、タグ名と表示文字列が一致する要素が 1 つだけあれば、それを使います。
 * 指定に shadow がある場合は、外側の部品の Shadow DOM の内側で探します（#20）。
 * @param {{ selectors: string[], tag: string, text?: string, shadow?: string[] }} target
 * @param {Document | Element} [base] 探す範囲
 * @returns {Element | null}
 */
function findTarget(target, base = document) {
  const root = shadowSearchRoot(target, base);
  if (!root) {
    return null;
  }
  for (const selector of target.selectors) {
    /** @type {Element[]} */
    let elements = [];
    try {
      elements = Array.from(root.querySelectorAll(selector));
    } catch {
      // 誤ったセレクター（JSON を手で編集した場合など）は飛ばします。
    }
    const element = elements.find(isDisplayed);
    if (element) {
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
 * 指定に shadow がある場合は、外側の部品の Shadow DOM の内側で探します（#20）。
 * @param {{ selectors: string[], shadow?: string[] }} items
 * @param {Document | Element} [base] 探す範囲
 * @returns {Element[]}
 */
function findAllTargets(items, base = document) {
  const root = shadowSearchRoot(items, base);
  if (!root) {
    return [];
  }
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
 * 要素を探す範囲を返します。指定に shadow がない場合は base です。shadow がある場合は、外側の部品を最も外側から
 * 順にたどった、最も内側の部品の Shadow DOM です（#20）。部品が見つからない場合は null です。
 * @param {{ shadow?: string[] }} target
 * @param {Document | Element} base
 * @returns {Document | Element | ShadowRoot | null}
 */
function shadowSearchRoot(target, base) {
  /** @type {Document | Element | ShadowRoot} */
  let root = base;
  for (const host of target.shadow ?? []) {
    const shadowRoot = findShadowRoot(host, root);
    if (!shadowRoot) {
      return null;
    }
    root = shadowRoot;
  }
  return root;
}

/**
 * セレクターに一致する部品のうち、Shadow DOM を持つ最初の部品の Shadow DOM を返します（#20）。
 * 部品そのものは表示の大きさを持たない場合（display: contents など）があるため、表示されているかは問いません。
 * @param {string} selector
 * @param {Document | Element | ShadowRoot} root
 * @returns {ShadowRoot | null}
 */
function findShadowRoot(selector, root) {
  /** @type {Element[]} */
  let hosts = [];
  try {
    hosts = Array.from(root.querySelectorAll(selector));
  } catch {
    // 誤ったセレクターは、部品が見つからないものとして扱います。
  }
  for (const host of hosts) {
    const shadowRoot = shadowRootOf(host);
    if (shadowRoot) {
      return shadowRoot;
    }
  }
  return null;
}

/**
 * 指定の外側の部品のうち、見つからない最初の部品のセレクターを返します（#20）。すべて見つかる場合と、
 * 指定に shadow がない場合は undefined です。要素が見つからなかったときの説明に使います。
 * @param {{ shadow?: string[] }} target
 * @param {Document | Element} base
 * @returns {string | undefined}
 */
function missingShadowHost(target, base) {
  /** @type {Document | Element | ShadowRoot} */
  let root = base;
  for (const host of target.shadow ?? []) {
    const shadowRoot = findShadowRoot(host, root);
    if (!shadowRoot) {
      return host;
    }
    root = shadowRoot;
  }
  return undefined;
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
