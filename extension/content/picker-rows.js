// 要素の選択モード（#139）で、一覧の行と、行の内側の要素の指定を作ります。
//
// content script は ES モジュールとして読み込めないため、通常のスクリプトとして読み込みます。
// selector.js の後、picker.js の前に読み込みます。picker.js と単体テスト（test/picker-rows.test.js）から使います。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。
//
// 行の見分けには、タグと class だけを使います。表示の文字は、翻訳で置き換わるため使いません（CLAUDE.md）。

/* global buildTarget, looksGenerated, visibleText */
/* exported buildInnerTarget, buildPageTarget, buildRowsTarget, containingRow, resolveRows */

/**
 * 要素の形（タグと class の組）を、CSS セレクターとして返します。例：`tr.order-row`
 * class の順序は並べ替えます。同じ形かの比べにも使います。
 * @param {Element} element
 * @returns {string}
 */
function shapeSelector(element) {
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList)
    .filter((name) => name !== '')
    .sort();
  return tag + classes.map((name) => `.${CSS.escape(name)}`).join('');
}

/**
 * 押した要素を含む、一覧の 1 行を探します。
 * 押した要素から親をたどり、同じ形の兄弟が 2 つ以上ある最初の階層の要素を行とします。
 * @param {Element} element 押した要素
 * @param {Document | Element} root 探す範囲。繰り返しの中の繰り返しでは、外側の行です
 * @returns {Element | null}
 */
function findRowElement(element, root) {
  /** @type {Element | null} */
  let current = element;
  const top = root instanceof Document ? root.body : root;
  while (current && current !== top && current.parentElement) {
    const shape = shapeSelector(current);
    const siblings = Array.from(current.parentElement.children).filter(
      (child) => shapeSelector(child) === shape,
    );
    if (siblings.length >= 2) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * セレクターで範囲の中を探した結果です。誤ったセレクターの場合は空の配列です。
 * @param {Document | Element} root
 * @param {string} selector
 * @returns {Element[]}
 */
function queryAll(root, selector) {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * 2 つの要素の一覧が、同じ要素を同じ順に含むかを判定します。
 * @param {Element[]} a
 * @param {Element[]} b
 * @returns {boolean}
 */
function sameElements(a, b) {
  return a.length === b.length && a.every((element, index) => element === b[index]);
}

/**
 * 範囲の中で、要素だけを指すセレクターを作ります。範囲がページ全体の場合は、安定した id を優先します。
 * 範囲が行の場合は、行を起点にした `:scope > …` の形にします。
 * @param {Element} element
 * @param {Document | Element} root
 * @returns {string}
 */
function uniqueSelectorWithin(element, root) {
  if (element === root) {
    return ':scope';
  }
  const id = element.getAttribute('id');
  if (id && !looksGenerated(id)) {
    const selector = `#${CSS.escape(id)}`;
    if (sameElements(queryAll(root, selector), [element])) {
      return selector;
    }
  }
  /** @type {string[]} */
  const parts = [];
  /** @type {Element | null} */
  let current = element;
  while (current && current !== root && current.parentElement) {
    /** @type {Element} */
    const parent = current.parentElement;
    const tag = current.tagName.toLowerCase();
    const sameTag = Array.from(parent.children).filter(
      (child) => child.tagName === current?.tagName,
    );
    parts.unshift(
      sameTag.length === 1 ? tag : `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})`,
    );
    // 途中に一意で安定した id を持つ要素があれば、そこから始めます。
    const parentId = parent.getAttribute('id');
    if (parent !== root && parentId && !looksGenerated(parentId)) {
      const anchor = `#${CSS.escape(parentId)}`;
      if (sameElements(queryAll(root, anchor), [parent])) {
        return [anchor, ...parts].join(' > ');
      }
    }
    current = parent;
  }
  if (root instanceof Document) {
    return parts.join(' > ');
  }
  return [':scope', ...parts].join(' > ');
}

/**
 * 押した要素から、同じ形の行すべてに一致する、繰り返しの行の指定（forEach の items）を作ります。
 * 形のセレクター（例：`tr.order-row`）だけで兄弟の行と過不足なく一致する場合は、それを使います。
 * 一致しない場合は、親を一意に指すセレクターに `> 形` を続けます。
 * @param {Element} element 押した要素
 * @param {Document | Element} root 探す範囲。繰り返しの中の繰り返しでは、外側の行です
 * @returns {{ items: { selectors: string[], tag: string, label: string, scope?: 'item' }, rows: Element[] } | null}
 *   行が見つからない場合は null
 */
function buildRowsTarget(element, root) {
  const row = findRowElement(element, root);
  const parent = row?.parentElement;
  if (!row || !parent) {
    return null;
  }
  const shape = shapeSelector(row);
  const siblings = Array.from(parent.children).filter((child) => shapeSelector(child) === shape);
  const selectors = [];
  if (sameElements(queryAll(root, shape), siblings)) {
    selectors.push(shape);
  }
  const withParent = `${uniqueSelectorWithin(parent, root)} > ${shape}`;
  if (sameElements(queryAll(root, withParent), siblings)) {
    selectors.push(withParent);
  }
  if (selectors.length === 0) {
    return null;
  }
  /** @type {{ selectors: string[], tag: string, label: string, scope?: 'item' }} */
  const items = { selectors, tag: row.tagName.toLowerCase(), label: `一覧の行（${shape}）` };
  if (!(root instanceof Document)) {
    items.scope = 'item';
  }
  return { items, rows: siblings };
}

/**
 * 行の内側の要素の指定（scope: item）を作ります。セレクターは行を起点にし、行の中でその要素だけを指すものに
 * します。属性、形（タグと class）、何番目の要素かの順に優先します。
 * @param {Element} element 押した要素
 * @param {Element} row 要素を含む行
 * @returns {{ selectors: string[], tag: string, label: string, text?: string, scope: 'item' }}
 */
function buildInnerTarget(element, row) {
  const tag = element.tagName.toLowerCase();
  /** @type {string[]} */
  const candidates = [];
  for (const name of ['data-testid', 'data-test', 'data-qa', 'name']) {
    const value = element.getAttribute(name);
    if (value) {
      candidates.push(`${tag}[${name}="${value.replace(/["\\]/g, '\\$&')}"]`);
    }
  }
  const shape = shapeSelector(element);
  if (shape !== tag) {
    candidates.push(shape);
  }
  const selectors = candidates.filter((selector) =>
    sameElements(queryAll(row, selector), [element]),
  );
  selectors.push(uniqueSelectorWithin(element, row));

  const text = visibleText(element);
  const label =
    element.getAttribute('aria-label') ||
    text ||
    element.getAttribute('title') ||
    element.getAttribute('name') ||
    tag;
  const target = {
    selectors,
    tag,
    label: label.length > 100 ? `${label.slice(0, 100)}…` : label,
    scope: /** @type {const} */ ('item'),
  };
  return text ? { ...target, text } : target;
}

/**
 * 繰り返しの段ごとの行の指定（外側から順）から、各段の行を探します。
 * 行の指定に scope: item がある段は、1 つ外側の段の行の内側で探します。
 * @param {{ selectors: string[], scope?: string }[]} chain
 * @returns {Element[][]} 段ごとの行
 */
function resolveRows(chain) {
  /** @type {Element[][]} */
  const levels = [];
  for (const items of chain) {
    const roots = items.scope === 'item' ? (levels.at(-1) ?? []) : [document];
    /** @type {Element[]} */
    let rows = [];
    for (const selector of items.selectors) {
      rows = roots.flatMap((base) => queryAll(base, selector));
      if (rows.length > 0) {
        break;
      }
    }
    levels.push(rows);
  }
  return levels;
}

/**
 * 要素を含む、最も内側の段の行を返します。どの行にも含まれない場合は null です。
 * @param {Element} element
 * @param {Element[][]} levels resolveRows の結果
 * @returns {Element | null}
 */
function containingRow(element, levels) {
  const innermost = levels.at(-1) ?? [];
  return innermost.find((row) => row.contains(element)) ?? null;
}

/**
 * ページ全体を基準にした要素の指定を作ります。記録と同じ buildTarget の指定に、class を使う候補
 * （例：`li.next > a`）を、何番目の要素かをたどる指定より前に加えます。
 * 何番目かをたどる指定は、ページ送りで［前へ］が加わるなど、並びが変わると別の要素を指すためです。
 * class は翻訳で変わりません。
 * @param {Element} element
 * @returns {{ selectors: string[], tag: string, label: string, text?: string }}
 */
function buildPageTarget(element) {
  const target = buildTarget(element);
  const shape = shapeSelector(element);
  const parent = element.parentElement;
  /** @type {string[]} */
  const candidates = [];
  if (shape !== element.tagName.toLowerCase()) {
    candidates.push(shape);
  }
  if (parent && shapeSelector(parent) !== parent.tagName.toLowerCase()) {
    candidates.push(`${shapeSelector(parent)} > ${shape}`);
  }
  const added = candidates.filter(
    (selector) =>
      !target.selectors.includes(selector) && sameElements(queryAll(document, selector), [element]),
  );
  const structural = target.selectors.slice(-1);
  return { ...target, selectors: [...target.selectors.slice(0, -1), ...added, ...structural] };
}
