// 手順の要素が見つからずに止まったときに、原因を調べるための、ページの構造を集めます（#203）。
//
// 集めるのは、タグの名前と、翻訳で変わらず個人情報を含みにくい属性だけです。表示の文字と、文字に近い属性
// （value、placeholder、aria-label、title、alt）は集めません。iframe の一覧だけは title を含めます。iframe の
// 見分けに使え、ページの表示の文字ではないためです。集めた値は Service Worker が、入力した値を伏せてから
// 実行履歴に記録します（shared/history-report.js の redactPageStructure）。
//
// content script は ES モジュールとして読み込めないため、通常のスクリプトとして読み込みます。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。
// 件数と長さの上限は redactPageStructure でも確かめます。ここでは送る量を抑えるために切ります。

/* exported pageStructure, frameList */

/**
 * 要素が見つからなかった手順の、セレクターごとの要素の数と、同じタグの要素の骨組みです。
 * @param {{ selectors: string[], tag: string }} target
 * @param {Document | Element} root 探した範囲（繰り返しの中では処理中の行）
 * @returns {{ counts: { selector: string, count: number }[], tag: string, total: number, elements: Record<string, string | boolean>[] }}
 *   count が -1 のセレクターは、セレクターとして読めなかったものです
 */
function pageStructure(target, root) {
  const maxElements = 30;
  const counts = target.selectors.map((selector) => {
    try {
      return { selector, count: root.querySelectorAll(selector).length };
    } catch {
      return { selector, count: -1 };
    }
  });
  const tag = /^[a-z][a-z0-9-]*$/.test(target.tag) ? target.tag : '';
  const all = tag ? [...root.querySelectorAll(tag)] : [];
  return {
    counts,
    tag,
    total: all.length,
    elements: all.slice(0, maxElements).map((element) => {
      /** @type {Record<string, string | boolean>} */
      const item = { tag: element.localName };
      for (const name of ['id', 'name', 'type', 'role']) {
        const value = element.getAttribute(name);
        if (value) {
          item[name] = value;
        }
      }
      const classes = [...element.classList].slice(0, 5).join(' ');
      if (classes) {
        item.class = classes;
      }
      for (const name of ['href', 'src']) {
        const value = element.getAttribute(name);
        if (value) {
          item[name] = urlWithoutQuery(value);
        }
      }
      if (element.getClientRects().length === 0) {
        item.hidden = true;
      }
      return item;
    }),
  };
}

/**
 * 最上位のページの iframe の一覧です。要素を含む枠が見つからない場合と、一致する枠が複数ある場合に使います。
 * @returns {{ total: number, frames: Record<string, string | boolean>[] }}
 */
function frameList() {
  const maxFrames = 20;
  const all = [...document.querySelectorAll('iframe')];
  return {
    total: all.length,
    frames: all.slice(0, maxFrames).map((frame) => {
      /** @type {Record<string, string | boolean>} */
      const item = {};
      const src = frame.getAttribute('src');
      if (src) {
        item.src = urlWithoutQuery(src);
      }
      for (const name of ['name', 'id', 'title']) {
        const value = frame.getAttribute(name);
        if (value) {
          item[name] = value;
        }
      }
      if (frame.getClientRects().length === 0) {
        item.hidden = true;
      }
      return item;
    }),
  };
}

/**
 * URL を、クエリ（? 以降）とフラグメント（# 以降）を除いた絶対 URL にします。検索語やセッションの識別子が
 * 含まれることが多いためです。https:// と http:// 以外（javascript: など）は、スキームだけを返します。
 * @param {string} value
 * @returns {string}
 */
function urlWithoutQuery(value) {
  try {
    const url = new URL(value, document.baseURI);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? `${url.origin}${url.pathname}`
      : url.protocol;
  } catch {
    return '';
  }
}
