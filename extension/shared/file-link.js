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
 * ページの操作による移動の直前の手順が、リンクのクリックで、移動先がファイルの場合に、そのクリックを
 * リンク先のファイルを保存する指定に変えた手順を返します。変えない場合は null です。
 * @param {Step | undefined} previous 直前に記録した手順
 * @param {string} url 移動先の URL
 * @param {'user' | 'page'} cause 移動の理由
 * @returns {Step | null}
 */
export function toLinkDownload(previous, url, cause) {
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
  return {
    ...previous,
    download: { path: DEFAULT_LINK_DOWNLOAD_PATH, onConflict: 'rename', from: 'link' },
  };
}
