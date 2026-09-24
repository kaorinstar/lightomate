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
 * @param {Element} element
 * @returns {{ selectors: string[], tag: string, label: string, text?: string }}
 */
function buildTarget(element) {
  const tag = element.tagName.toLowerCase();

  /** @type {string[]} */
  const candidates = [];

  const id = element.getAttribute('id');
  if (id && !looksGenerated(id)) {
    candidates.push(`#${CSS.escape(id)}`);
  }
  for (const name of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder']) {
    const value = element.getAttribute(name);
    if (value) {
      candidates.push(`${tag}[${name}=${quoteAttribute(value)}]`);
    }
  }

  const selectors = candidates.filter((selector) => pointsTo(selector, element));
  selectors.push(structuralSelector(element));

  const text = visibleText(element);
  const label =
    element.getAttribute('aria-label') ||
    labelText(element) ||
    text ||
    element.getAttribute('placeholder') ||
    element.getAttribute('name') ||
    element.getAttribute('title') ||
    tag;

  return text
    ? { selectors, tag, label: truncate(label), text }
    : { selectors, tag, label: truncate(label) };
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
 * セレクターがページ内でその要素だけを指すかを判定します。
 * @param {string} selector
 * @param {Element} element
 * @returns {boolean}
 */
function pointsTo(selector, element) {
  try {
    const matches = element.ownerDocument.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/**
 * 何番目の要素かをたどるセレクターを作ります。
 * 途中に一意で安定した id を持つ要素があれば、そこから始めます。
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
 * 要素の表示文字列を、空白をまとめて返します。入力欄の値は含めません。
 * @param {Element} element
 * @returns {string}
 */
function visibleText(element) {
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
