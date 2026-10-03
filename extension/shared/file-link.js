// 記録中に、リンクのクリックでファイル（PDF など）へ移動した場合に、そのクリックを「リンク先のファイルを保存する」
// 指定（click の download の from: link）に変えます（#172）。
//
// Chrome は PDF などのファイルを表示画面で開くため、記録したままでは、実行してもファイルは保存されません。
// 判定には、移動先の URL の拡張子と、クリックした要素がリンク（a）であることを使います。表示の文字は、
// 翻訳で置き換わるため使いません（CLAUDE.md）。

/** @typedef {import('./flow.js').Step} Step */

/** ファイルとみなす、URL の末尾の拡張子です。 */
export const FILE_EXTENSIONS = ['pdf', 'csv', 'zip', 'xlsx', 'xls', 'docx', 'doc'];

/**
 * 記録で変えた手順の、既定の保存先です。拡張子は、保存するときにファイルに合わせて付けます。
 * 同じ名前のファイルは番号を付けて別名で保存するため、繰り返しの中でも上書きしません。
 */
export const DEFAULT_LINK_DOWNLOAD_PATH =
  'Lightomate/{{flow.name}}/{{run.yyyy}}{{run.mm}}{{run.dd}}_{{run.hhmmss}}';

/**
 * URL がファイル（FILE_EXTENSIONS の拡張子で終わるパス）を指すかを判定します。
 * @param {string} url
 * @returns {boolean}
 */
export function isFileUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const match = /\.([a-z0-9]+)$/i.exec(pathname);
  return match !== null && FILE_EXTENSIONS.includes(match[1].toLowerCase());
}

/**
 * パスの区切りのうち、注文ごとに変わる部分（ID）とみなすものです。3 桁以上の数字か、8 文字以上の 16 進数を
 * 含む区切りです。例：`59183340-a13f-4750-9b15-b6b280429a13`、`503-6386150-5460603`
 */
const VARIABLE_SEGMENT = /\d{3,}|[0-9a-f]{8,}/i;

/**
 * リンク先の URL のパスから、注文ごとに変わる部分を除いた形で、同じ種類のリンクを探すセレクターを作ります（#185）。
 * 例：`/documents/download/<ID>/invoice.pdf` から `a[href*="/documents/download/"][href*="/invoice.pdf"]`
 * 表示の文字と、注文ごとに変わる id を使わないため、翻訳しても、明細書の数が変わっても見つかります。
 * href の値が相対でも絶対でも一致するよう、前後の部分を含むか（*=）で比べます。クエリは使いません。
 * 変わらない部分が短すぎる場合（`/` だけなど）は、ほかのリンクにも一致するため null です。
 * @param {string} href リンク先の URL（絶対 URL）
 * @returns {string | null}
 */
export function hrefPatternSelector(href) {
  let pathname;
  try {
    pathname = new URL(href).pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/');
  const first = segments.findIndex((segment) => VARIABLE_SEGMENT.test(segment));
  if (first === -1) {
    return pathname.length > 1 ? `a[href*=${JSON.stringify(pathname)}]` : null;
  }
  const last = segments.findLastIndex((segment) => VARIABLE_SEGMENT.test(segment));
  const prefix = `${segments.slice(0, first).join('/')}/`;
  const suffix = last === segments.length - 1 ? '' : `/${segments.slice(last + 1).join('/')}`;
  const parts = [prefix, suffix].filter((part) => part.length > 1);
  return parts.length > 0
    ? `a${parts.map((part) => `[href*=${JSON.stringify(part)}]`).join('')}`
    : null;
}

/**
 * ページの操作による移動の直前の手順が、リンクのクリックで、移動先がファイルの場合に、そのクリックを
 * リンク先のファイルを保存する指定に変えた手順を返します。変えない場合は null です。
 * 押したリンクの href から同じ種類のリンクを探す指定を作れた場合は、その指定を要素の指定の先頭に加え、一致する
 * リンクをすべて保存する指定（all）にします（#185）。明細書が複数ある注文で、すべての明細書を保存するためです。
 * @param {Step | undefined} previous 直前に記録した手順
 * @param {string} url 移動先の URL
 * @param {'user' | 'page'} cause 移動の理由
 * @param {string} [href] 押したリンクの href（絶対 URL）。ない場合は移動先の URL を使います
 * @returns {Step | null}
 */
export function toLinkDownload(previous, url, cause, href) {
  if (
    cause !== 'page' ||
    !isFileUrl(url) ||
    previous?.type !== 'click' ||
    previous.target.tag !== 'a' ||
    previous.download !== undefined ||
    previous.newTab !== undefined
  ) {
    return null;
  }
  const pattern = hrefPatternSelector(href ?? url);
  if (pattern === null) {
    return {
      ...previous,
      download: { path: DEFAULT_LINK_DOWNLOAD_PATH, onConflict: 'rename', from: 'link' },
    };
  }
  return {
    ...previous,
    target: {
      ...previous.target,
      selectors: [pattern, ...previous.target.selectors.filter((selector) => selector !== pattern)],
    },
    download: { path: DEFAULT_LINK_DOWNLOAD_PATH, onConflict: 'rename', from: 'link', all: true },
  };
}
