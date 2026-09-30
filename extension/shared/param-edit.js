// フローの詳細の［手順］タブで、パラメータ（実行時に入力する値）の定義を編集するための処理です（#9）。
// 画面の入力欄の値からパラメータの定義を作り、名前を変えた場合は、手順の中の参照（{{名前}}）も合わせて変えます。
// chrome.* を使わないため、Node.js の単体テストから読み込めます。

/** @typedef {import('./params.js').Param} Param */

/**
 * 画面のパラメータの 1 行の入力です。
 * @typedef {object} ParamRow
 * @property {string} originalName 編集を始めたときの名前。新しく足した行は空の文字列です
 * @property {string} name
 * @property {string} label
 * @property {string} type
 * @property {string} options 選択肢。「、」または「,」で区切ります
 * @property {string} default 既定値。空の文字列の場合は既定値なしです
 */

/**
 * 画面の入力から、パラメータの定義と、名前の変更の一覧を作ります。
 * 名前や種類の誤りはここでは確かめず、保存の前の検証（validateFlow）に任せます。
 * @param {ParamRow[]} rows
 * @returns {{ params: Param[], renames: { from: string, to: string }[] }}
 */
export function paramsFromRows(rows) {
  /** @type {Param[]} */
  const params = rows.map((row) => {
    /** @type {Record<string, unknown>} */
    const param = { name: row.name.trim(), label: row.label.trim(), type: row.type };
    if (row.type === 'select') {
      param.options = row.options
        .split(/[、,]/)
        .map((option) => option.trim())
        .filter(Boolean);
    }
    if (row.default.trim() !== '') {
      param.default = row.default.trim();
    }
    return /** @type {Param} */ (param);
  });
  const renames = rows
    .filter((row) => row.originalName !== '' && row.originalName !== row.name.trim())
    .map((row) => ({ from: row.originalName, to: row.name.trim() }));
  return { params, renames };
}

/**
 * パラメータの定義を、画面の入力の行にします。
 * @param {Param[]} params
 * @returns {ParamRow[]}
 */
export function rowsFromParams(params) {
  return params.map((param) => ({
    originalName: param.name,
    name: param.name,
    label: param.label,
    type: param.type,
    options: (param.options ?? []).join('、'),
    default: param.default ?? '',
  }));
}

/**
 * 値の中の文字列にある参照（{{名前}} と {{名前.year}} など）の名前を変えます。元の値は変更しません。
 * 手順のすべての文字列の項目が対象です。参照を書ける項目（入力の値、URL、保存先、条件の値など）を
 * 個別に数え上げると、項目を加えたときに漏れるためです。
 * @template T
 * @param {T} value
 * @param {string} from
 * @param {string} to
 * @returns {T}
 */
export function renameParamReferences(value, from, to) {
  const pattern = new RegExp(
    `(\\{\\{\\s*)${escapeRegExp(from)}(?=\\s*(?:\\.[A-Za-z]+)?\\s*\\}\\})`,
    'g',
  );
  /** @param {unknown} item @returns {unknown} */
  const walk = (item) => {
    if (typeof item === 'string') {
      return item.replace(pattern, `$1${to}`);
    }
    if (Array.isArray(item)) {
      return item.map(walk);
    }
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, walk(entry)]));
    }
    return item;
  };
  return /** @type {T} */ (walk(value));
}

/**
 * 正規表現の特殊文字をエスケープします。パラメータの名前は英数字と _ だけですが、念のため行います。
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
