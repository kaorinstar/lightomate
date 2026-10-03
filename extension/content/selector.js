// 操作した要素を、後で再び見つけるための指定（Target）を作ります。
//
// content script は ES モジュールとして読み込めないため、通常のスクリプトとして読み込みます。
// recorder.js より先に読み込み、ここで宣言した関数を recorder.js から呼び出します。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。

/* exported buildTarget */

/**
 * 要素から Target を作ります。形式は extension/shared/flow.js の Target です。
 *
 * セレクターは、ページの構造が変わっても同じ要素を指しやすい順に並べます。
 * id、テスト用の属性、name、aria-label、placeholder を優先し、ページの構造に依存する指定
 * （何番目の要素か）は最後の手段とします。ページ内で 1 つの要素だけを指すものだけを残します。
 *
 * 要素が Shadow DOM（部品の中身を外から隠す仕組み）の中にある場合は、セレクターを部品の内側で作り、
 * 外側の部品（Shadow DOM を持つ要素）を指すセレクターを、最も外側から順に shadow に並べます（#20）。
 * @param {Element} element
 * @returns {{ selectors: string[], tag: string, label: string, text?: string, shadow?: string[] }}
 */
function buildTarget(element) {
  const tag = element.tagName.toLowerCase();
  const selectors = elementSelectors(element, ['aria-label', 'placeholder']);
  const shadow = shadowHosts(element);

  const text = visibleText(element);
  const label =
    element.getAttribute('aria-label') ||
    labelText(element) ||
    text ||
    element.getAttribute('placeholder') ||
    element.getAttribute('title') ||
    element.getAttribute('name') ||
    element.getAttribute('id') ||
    tag;

  return {
    selectors,
    tag,
    label: truncate(label),
    ...(text ? { text } : {}),
    ...(shadow.length > 0 ? { shadow } : {}),
  };
}

/**
 * 要素を指すセレクターを、優先する順に返します。最後は何番目の要素かをたどるセレクターです。
 * 要素と同じ範囲（ページ全体か、要素を含む Shadow DOM の内側）で 1 つの要素だけを指すものだけを残します。
 * @param {Element} element
 * @param {string[]} extraNames id、テスト用の属性、name に続けて使う属性の名前
 * @returns {string[]}
 */
function elementSelectors(element, extraNames) {
  const tag = element.tagName.toLowerCase();

  /** @type {string[]} */
  const candidates = [];

  const id = element.getAttribute('id');
  if (id && !looksGenerated(id)) {
    candidates.push(`#${CSS.escape(id)}`);
  }
  for (const name of ['data-testid', 'data-test', 'data-qa', 'name', ...extraNames]) {
    const value = element.getAttribute(name);
    if (value) {
      candidates.push(`${tag}[${name}=${quoteAttribute(value)}]`);
    }
  }

  const selectors = candidates.filter((selector) => pointsTo(selector, element));
  selectors.push(structuralSelector(element));
  return selectors;
}

/**
 * 要素を含む Shadow DOM の外側の部品を、最も外側から順に、それぞれを指すセレクターで返します（#20）。
 * Shadow DOM の中にない要素では空の配列です。
 *
 * 部品は、部品を含む範囲で 1 つだけを指すセレクターのうち、最も優先するもので指します。表示の文字は
 * Chrome の翻訳で置き換わるため、aria-label などの文字の属性は使いません（CLAUDE.md）。独自の部品
 * （タグ名に - を含む要素）は、タグ名だけで 1 つに決まる場合は、タグ名を id などの次に使います。
 * @param {Element} element
 * @returns {string[]}
 */
function shadowHosts(element) {
  /** @type {string[]} */
  const hosts = [];
  let root = element.getRootNode();
  while (root instanceof ShadowRoot) {
    const host = root.host;
    const tag = host.tagName.toLowerCase();
    const selectors = elementSelectors(host, []);
    const custom = tag.includes('-') && pointsTo(tag, host);
    // 何番目の要素かをたどるセレクター（最後の 1 つ）より、タグ名を優先します。
    const preferred = selectors.length > 1 ? selectors[0] : custom ? tag : selectors[0];
    hosts.unshift(preferred);
    root = host.getRootNode();
  }
  return hosts;
}

/**
 * 自動で生成されたとみられる id かを判定します。表示のたびに変わる可能性があるためです。
 * 例：ember123、react-select-3-input、a1b2c3d4e5
 * @param {string} id
 * @returns {boolean}
 */
function looksGenerated(id) {
  return /\d{3,}|[0-9a-f]{8,}|^:r|-\d+-/i.test(id);
}

/**
 * 属性の値を、CSS セレクターの文字列として引用符で囲みます。
 * @param {string} value
 * @returns {string}
 */
function quoteAttribute(value) {
  return `"${value.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')}"`;
}

/**
 * セレクターが、要素と同じ範囲（ページ全体か、要素を含む Shadow DOM の内側）でその要素だけを指すかを判定します。
 * @param {string} selector
 * @param {Element} element
 * @returns {boolean}
 */
function pointsTo(selector, element) {
  try {
    const root = element.getRootNode();
    const scope = root instanceof ShadowRoot ? root : element.ownerDocument;
    const matches = scope.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/**
 * 何番目の要素かをたどるセレクターを作ります。
 * 途中に一意で安定した id を持つ要素があれば、そこから始めます。
 * Shadow DOM の中の要素では、Shadow DOM の内側の最も外側の要素から始めます（#20）。
 * @param {Element} element
 * @returns {string}
 */
function structuralSelector(element) {
  /** @type {string[]} */
  const parts = [];
  /** @type {Element | null} */
  let current = element;

  while (current && current !== current.ownerDocument.documentElement) {
    const id = current.getAttribute('id');
    if (current !== element && id && !looksGenerated(id)) {
      const anchor = `#${CSS.escape(id)}`;
      if (pointsTo(anchor, current)) {
        parts.unshift(anchor);
        return parts.join(' > ');
      }
    }

    const tag = current.tagName.toLowerCase();
    /** @type {Element | null} */
    const parent = current.parentElement;
    if (!parent) {
      const shadowRoot = current.parentNode;
      if (shadowRoot instanceof ShadowRoot) {
        const sameTag = Array.from(shadowRoot.children).filter(
          (child) => child.tagName === current?.tagName,
        );
        parts.unshift(
          sameTag.length === 1 ? tag : `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})`,
        );
        return parts.join(' > ');
      }
      parts.unshift(tag);
      break;
    }
    const sameTag = Array.from(parent.children).filter(
      (child) => child.tagName === current?.tagName,
    );
    parts.unshift(
      sameTag.length === 1 ? tag : `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})`,
    );
    current = parent;
  }

  parts.unshift('html');
  return parts.join(' > ');
}

/**
 * 要素の表示文字列を、空白をまとめて返します。入力欄に入力された値は含めません。
 * @param {Element} element
 * @returns {string}
 */
function visibleText(element) {
  // ボタンとして表示される input 要素は、表示される文字が value（画像の場合は alt）にあります。
  if (element instanceof HTMLInputElement) {
    if (['button', 'submit', 'reset'].includes(element.type)) {
      return truncate(element.value.replace(/\s+/g, ' ').trim());
    }
    if (element.type === 'image') {
      return truncate((element.getAttribute('alt') ?? '').replace(/\s+/g, ' ').trim());
    }
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return '';
  }
  const text = element instanceof HTMLElement ? element.innerText : element.textContent;
  return truncate((text ?? '').replace(/\s+/g, ' ').trim());
}

/**
 * 入力欄に対応する label 要素の表示文字列を返します。入力欄の説明に使います。
 * @param {Element} element
 * @returns {string}
 */
function labelText(element) {
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement) &&
    !(element instanceof HTMLSelectElement)
  ) {
    return '';
  }
  const label = element.labels?.[0];
  return label ? truncate(label.innerText.replace(/\s+/g, ' ').trim()) : '';
}

/**
 * @param {string} value
 * @returns {string}
 */
function truncate(value) {
  return value.length > 100 ? `${value.slice(0, 100)}…` : value;
}
