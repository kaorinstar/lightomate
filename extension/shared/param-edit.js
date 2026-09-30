// フローの詳細の［手順］タブで、パラメータ（実行時に入力する値）の定義を編集するための処理です（#9）。
// 画面の入力欄の値からパラメータの定義を作り、名前を変えた場合は、手順の中の参照（{{名前}}）も合わせて変えます。
// chrome.* を使わないため、Node.js の単体テストから読み込めます。

import { validateParams } from './params.js';

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

/**
 * 入力の誤りです。何番目の値の、どの欄の誤りかを持ちます。
 * @typedef {object} ParamRowError
 * @property {number} index 何番目の値か（0 から数えます）
 * @property {'name' | 'label' | 'type' | 'options' | 'default'} field 欄
 * @property {string} message 欄の直下に出す文
 */

/**
 * 画面の入力を検証し、欄ごとの誤りを返します（#9）。
 * 検証は保存の前の検証（params.js の validateParams）と同じもので行い、誤りの文だけを、
 * 欄の直下に出す指示の形に書き換えます。「params[1].name」のような形式の位置は、利用者には分からないためです。
 * @param {ParamRow[]} rows
 * @returns {ParamRowError[]}
 */
export function paramRowErrors(rows) {
  const { params } = paramsFromRows(rows);
  /** @type {ParamRowError[]} */
  const errors = [];
  for (const text of validateParams(params)) {
    const match = text.match(/^params\[(\d+)\]\.(name|label|type|options|default)(.*)$/);
    if (!match) {
      continue;
    }
    const field = /** @type {ParamRowError['field']} */ (match[2]);
    const rest = match[3];
    errors.push({ index: Number(match[1]), field, message: rowMessage(field, rest) });
  }
  return errors;
}

/**
 * 検証の文を、欄の直下に出す文にします。
 * @param {ParamRowError['field']} field
 * @param {string} rest 検証の文のうち、欄の名前より後ろの部分
 * @returns {string}
 */
function rowMessage(field, rest) {
  switch (field) {
    case 'name':
      return rest.includes('重複')
        ? '同じ名前の値がほかにあります。別の名前にしてください。'
        : '名前は、英字で始め、英数字と _ だけで入力してください。例：month';
    case 'label':
      return '表示名を入力してください。';
    case 'type':
      return '種類を選んでください。';
    case 'options':
      return '選択肢を 1 つ以上、「、」で区切って入力してください。';
    case 'default':
      return `既定値の誤りです。${rest.replace(/^:\s*/, '')}`;
  }
}

/**
 * 値の定義を保存できなかった理由（保存の前の検証の誤り）を、利用者に分かる文にします（#9）。
 * 値を削除したのに手順がまだその値を参照している場合は、参照している名前を挙げ、直し方を示します。
 * それ以外の誤りは、そのまま返します。
 * @param {string[]} errors validateFlow の誤りの一覧
 * @returns {string}
 */
export function describeParamSaveErrors(errors) {
  const names = [
    ...new Set(
      errors
        .filter((error) => error.includes('パラメータ'))
        .flatMap((error) => [...error.matchAll(/「([^」]+)」/g)].map((match) => match[1])),
    ),
  ];
  if (names.length === 0) {
    return `誤りがあるため、保存しませんでした。\n${errors.join('\n')}`;
  }
  const list = names.map((name) => `{{${name}}}`).join('、');
  return `手順の中で ${list} を使っているため、保存しませんでした。この値を削除する場合は、先に手順のブロックの中の ${list} を書き換えてください。`;
}
