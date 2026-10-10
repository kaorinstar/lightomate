// 要素の選択モード（#139）で、一覧の行と、行の内側の要素の指定を作ります。
//
// content script は ES モジュールとして読み込めないため、通常のスクリプトとして読み込みます。
// selector.js の後、picker.js と recorder.js の前に読み込みます。picker.js、recorder.js（#167）と単体テスト
// （test/picker-rows.test.js）から使います。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。
//
// 行の見分けには、タグと class だけを使います。表示の文字は、翻訳で置き換わるため使いません（CLAUDE.md）。

/* global buildTarget, looksGenerated, pointsTo, structuralSelector, visibleText */
/* exported buildInnerTarget, buildPageTarget, buildRowsTarget, containingRow, originalElement, pagerSelectors, resolveRows, rowCandidates, rowsFromExamples */

/**
 * 押した要素が、Chrome の翻訳がページに差し込んだ要素であれば、その外側の本来の要素を返します。
 * 翻訳は、置き換えた文字を `<font style="vertical-align: inherit;">` の入れ子で包みます。この要素は翻訳していない
 * ページにはないため、指定に使うと、翻訳を無効にして実行したときに見つかりません（CLAUDE.md の翻訳の規則）。
 * 本来の font 要素（古い書き方のページ）も外側の要素にしますが、指す範囲が少し広がるだけで、別の要素にはなりません。
 * @param {Element} element
 * @returns {Element}
 */
function originalElement(element) {
  /** @type {Element} */
  let current = element;
  while (current.tagName === 'FONT' && current.parentElement) {
    current = current.parentElement;
  }
  return current;
}

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
 * 2 つの要素の形が近いかを判定します（#236）。タグが同じで、class が 2 つ以上共通し、違う class が合わせて 2 つ
 * 以下の場合です。1 件目の行だけ余白の class が入れ替わる一覧（楽天市場の購入履歴）の行を、同じ行とみなすためです。
 * class が少ない要素は、違いの 1 つが形の大半になるため、近いとみなしません。
 * @param {Element} a
 * @param {Element} b
 * @returns {boolean}
 */
function nearShape(a, b) {
  if (a.tagName !== b.tagName) {
    return false;
  }
  const first = new Set(Array.from(a.classList).filter((name) => name !== ''));
  const second = new Set(Array.from(b.classList).filter((name) => name !== ''));
  const common = [...first].filter((name) => second.has(name)).length;
  return common >= 2 && first.size - common + (second.size - common) <= 2;
}

/**
 * 要素と同じ行として並ぶ兄弟（要素を含む）と、それらすべてに一致する形のセレクターを返します。
 * 形（タグと class の組）が同じ兄弟を基本とします。形の近い兄弟（nearShape）を含めると行が増える場合は、それらに
 * 共通する class だけで形を作り、近い兄弟も行に含めます（#236）。共通する class だけの形が、親の子のうち近い兄弟
 * 以外にも一致する場合は、形が同じ兄弟だけにします。
 * @param {Element} element
 * @returns {{ shape: string, siblings: Element[] }}
 */
function rowGroup(element) {
  const shape = shapeSelector(element);
  const parent = element.parentElement;
  if (!parent) {
    return { shape, siblings: [element] };
  }
  const children = Array.from(parent.children);
  const exact = children.filter((child) => shapeSelector(child) === shape);
  const near = children.filter((child) => child === element || nearShape(element, child));
  if (near.length <= exact.length) {
    return { shape, siblings: exact };
  }
  const common = Array.from(element.classList)
    .filter((name) => name !== '' && near.every((child) => child.classList.contains(name)))
    .sort();
  if (common.length < 2) {
    return { shape, siblings: exact };
  }
  const loose =
    element.tagName.toLowerCase() + common.map((name) => `.${CSS.escape(name)}`).join('');
  const matched = children.filter((child) => child.matches(loose));
  return sameElements(matched, near)
    ? { shape: loose, siblings: near }
    : { shape, siblings: exact };
}

/**
 * 押した要素を含む、一覧の 1 行を探します。
 * 押した要素から親をたどり、同じ形か形の近い兄弟（rowGroup、#236）が 2 つ以上ある最初の階層の要素を行とします。
 * @param {Element} element 押した要素
 * @param {Document | Element} root 探す範囲。繰り返しの中の繰り返しでは、外側の行です
 * @returns {Element | null}
 */
function findRowElement(element, root) {
  /** @type {Element | null} */
  let current = element;
  const top = root instanceof Document ? root.body : root;
  while (current && current !== top && current.parentElement) {
    if (rowGroup(current).siblings.length >= 2) {
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
  return row ? rowsTargetOf(row, root) : null;
}

/**
 * 行の要素から、同じ形の行すべてに一致する、繰り返しの行の指定を作ります。buildRowsTarget の本体です。
 * @param {Element} row 行の要素
 * @param {Document | Element} root 探す範囲
 * @returns {{ items: { selectors: string[], tag: string, label: string, scope?: 'item' }, rows: Element[] } | null}
 *   すべての行に一致するセレクターを作れない場合は null
 */
function rowsTargetOf(row, root) {
  const parent = row.parentElement;
  if (!parent) {
    return null;
  }
  const { shape, siblings } = rowGroup(row);
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
 * 記録した操作の要素を含む、一覧の行の候補を、内側から順に返します（#167）。
 * 記録を終えた後に、記録した手順を「各行で繰り返す」に変えるときに使います。ページを移動すると要素を
 * 調べられなくなるため、操作した時点で求めます。
 * 要素の親をたどり、同じ形か形の近い兄弟（rowGroup、#236）が 2 つ以上ある階層を、それぞれ候補にします。
 * 要素そのものは候補にしません。
 * 翻訳が差し込んだ要素（font）を押した場合は、その外側の本来の要素を、操作した要素とします。
 * 行の内側の指定は、行を起点にするため、行と要素が同じでは作れないためです。
 * @param {Element} element 操作した要素
 * @returns {{ items: { selectors: string[], tag: string, label: string }, count: number,
 *   inner: { selectors: string[], tag: string, label: string, text?: string, scope: 'item' } }[]}
 */
function rowCandidates(element) {
  // 記録した手順 1 件に添える候補の数の上限です。最上位に定数を置くと、2 回目の読み込みで誤りになるため、ここに置きます。
  const maxCandidates = 5;
  /** @type {ReturnType<typeof rowCandidates>} */
  const candidates = [];
  // 翻訳が差し込んだ要素（font）は、翻訳していないページにないため、その外側の本来の要素を指します。
  const base = originalElement(element);
  let current = base.parentElement;
  while (
    current &&
    current !== document.body &&
    current.parentElement &&
    candidates.length < maxCandidates
  ) {
    if (rowGroup(current).siblings.length >= 2) {
      const built = rowsTargetOf(current, document);
      if (built) {
        candidates.push({
          items: built.items,
          count: built.rows.length,
          inner: buildInnerTarget(base, current),
        });
      }
    }
    current = current.parentElement;
  }
  return candidates;
}

/**
 * 1 件目と 2 件目で押した同じ種類の要素から、1 件分の範囲（行）を求めます（#241）。1 件目の要素を含み、2 件目の
 * 要素を含まない、いちばん大きい要素です。2 つの要素の共通の親の直下にある、1 件目の側の子になります。
 * 一方がもう一方を含む場合と、同じ要素の場合は null です。
 * @param {Element} first
 * @param {Element} second
 * @returns {Element | null}
 */
function exampleRow(first, second) {
  if (first === second || first.contains(second) || second.contains(first)) {
    return null;
  }
  /** @type {Element} */
  let row = first;
  while (row.parentElement && !row.parentElement.contains(second)) {
    row = row.parentElement;
  }
  return row.parentElement && row.parentElement !== document.documentElement ? row : null;
}

/**
 * 2 件目で押した要素と、1 件目で記録した手順の要素から、繰り返しの行の指定と、行の中の手順の指定を求めます
 * （#241）。利用者に行の候補を選ばせる代わりに、2 件目の同じものを押してもらって 1 件分を決めるためです。
 * 2 件目と同じ形（タグと class）の 1 件目の要素を先に、同じタグの要素を後に試します。行の指定が 2 件目の行にも
 * 一致する最初の組を使います。どの組でも決められない場合は null です。
 * 表示の文字は使いません。翻訳で置き換わるためです（CLAUDE.md）。
 * @param {Element} second 2 件目で押した要素
 * @param {{ index: number, element: Element }[]} examples 記録した手順の番号と、ページで見つかったその要素
 * @returns {{ items: { selectors: string[], tag: string, label: string }, count: number,
 *   inners: Record<number, { selectors: string[], tag: string, label: string, text?: string, scope: 'item' }> } | null}
 */
function rowsFromExamples(second, examples) {
  const base = originalElement(second);
  // 翻訳が差し込んだ要素（font）は、どちらの側も外側の本来の要素にそろえます。
  const firsts = examples.map(({ index, element }) => ({
    index,
    element: originalElement(element),
  }));
  const shape = shapeSelector(base);
  const ordered = [
    ...firsts.filter(({ element }) => shapeSelector(element) === shape),
    ...firsts.filter(
      ({ element }) => element.tagName === base.tagName && shapeSelector(element) !== shape,
    ),
  ];
  for (const { element } of ordered) {
    const row = exampleRow(element, base);
    const built = row ? rowsTargetOf(row, document) : null;
    if (!row || !built || !built.rows.some((other) => other !== row && other.contains(base))) {
      continue;
    }
    /** @type {Record<number, ReturnType<typeof buildInnerTarget>>} */
    const inners = {};
    for (const first of firsts) {
      if (first.element !== row && row.contains(first.element)) {
        inners[first.index] = buildInnerTarget(first.element, row);
      }
    }
    return { items: built.items, count: built.rows.length, inners };
  }
  return null;
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

/**
 * 記録で押したリンクかボタンを、繰り返しのページ送り（nextPage）に使う場合の指定を返します（#182）。
 * ページ番号の数で位置が変わらない指定だけを返します。何番目の要素かをたどる指定（buildTarget の最後の
 * 指定）は、ページ番号のリンクを押したり、最後のページで別のページへ戻ったりするため含めません。
 * 表示の文字を値に持つ属性（aria-label、placeholder）の指定も含めません。翻訳で文字が変わると見つからず、
 * 途中のページで繰り返しが終わるためです（CLAUDE.md の翻訳の規則）。
 * 作れない場合は空の配列です。
 * @param {Element} element
 * @returns {string[]}
 */
function pagerSelectors(element) {
  const tag = element.tagName.toLowerCase();
  if (tag !== 'a' && tag !== 'button') {
    return [];
  }
  const selectors = buildPageTarget(element)
    .selectors.slice(0, -1)
    .filter((selector) => !/\[(aria-label|placeholder)=/.test(selector));
  // rel="next" は、次のページへのリンクであることをページ自身が示す属性です。
  const rel = `${tag}[rel~="next"]`;
  if ((element.getAttribute('rel') ?? '').split(/\s+/).includes('next') && pointsTo(rel, element)) {
    selectors.unshift(rel);
  }
  const last = lastOfTypeSelector(element);
  if (last !== null && !selectors.includes(last)) {
    selectors.push(last);
  }
  return selectors;
}

/**
 * 何番目の要素かをたどる指定のうち、要素から 3 段上までを「同じタグの最後の要素」でたどる指定を返します（#182）。
 * 例：`#pager > ul > li:last-of-type > a`。class のないページ送りで、「次へ」が常に最後にある場合に使います。
 * 3 段の中に、最後でも唯一でもない要素がある場合は、位置で変わるため null です。それより上は、何番目の要素かを
 * たどる指定のままです。ページ送りの部品より外側の並びは、ページ番号の数で変わらないためです。
 * @param {Element} element
 * @returns {string | null}
 */
function lastOfTypeSelector(element) {
  /** @type {string[]} */
  const parts = [];
  /** @type {Element} */
  let current = element;
  for (let depth = 0; depth < 3; depth += 1) {
    const parent = current.parentElement;
    if (!parent || parent === document.documentElement) {
      break;
    }
    const tag = current.tagName.toLowerCase();
    const sameTag = Array.from(parent.children).filter(
      (child) => child.tagName === current.tagName,
    );
    if (sameTag.length === 1) {
      parts.unshift(tag);
    } else if (sameTag.at(-1) === current) {
      parts.unshift(`${tag}:last-of-type`);
    } else {
      return null;
    }
    current = parent;
  }
  if (parts.length === 0) {
    return null;
  }
  const selector = `${structuralSelector(current)} > ${parts.join(' > ')}`;
  return pointsTo(selector, element) ? selector : null;
}
