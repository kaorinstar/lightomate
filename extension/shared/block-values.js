// ブロックの文字の欄に入れられる値（{{名前}}）の一覧を作ります（#147）。
// ブロックの右クリックのメニューの［値を入れる］で使います。Blockly も chrome.* も使わないため、
// Node.js の単体テストから読み込めます。
//
// 一覧に出すのは、保存の前の検証（validateFlow）を通る値だけです。
// - 保存先（PDF の保存先、ダウンロードの保存先）：パラメータ、前の「読み取り」の名前、決まった値
// - そのほかの欄（URL、入力する値、条件の値）：パラメータだけ。検証が、読み取りの名前と決まった値を誤りとするためです

import { conditionUsesValues } from './blocks.js';
import { PARAM_NAME_PATTERN } from './params.js';
import { BUILTIN_REFERENCES, RESERVED_NAMES } from './save-path.js';

/** @typedef {import('./blocks.js').BlockState} BlockState */
/** @typedef {import('./blocks.js').WorkspaceState} WorkspaceState */
/** @typedef {import('./params.js').Param} Param */

/**
 * 値を入れられる欄です。kind は、使える値の範囲です。path は保存先、template はそのほかの欄です。
 * @typedef {object} ValueField
 * @property {string} field ブロックの欄の名前
 * @property {string} label 利用者に示す欄の名前
 * @property {'path' | 'template'} kind
 */

/**
 * 一覧に出す値です。
 * @typedef {object} InsertableValue
 * @property {string} text 欄に入れる文字（例：{{no}}）
 * @property {string} label 値の説明
 * @property {'param' | 'extract' | 'builtin'} group 値のまとまり
 */

/** ブロックの種類ごとの、値を入れられる欄です。条件のブロックは、条件の種類で欄が変わるため別に扱います。 */
/** @type {Record<string, ValueField[]>} */
const FIELDS = {
  lm_navigate: [{ field: 'URL', label: 'URL', kind: 'template' }],
  lm_click: [{ field: 'DOWNLOAD', label: 'ダウンロードの保存先', kind: 'path' }],
  lm_input: [{ field: 'VALUE', label: '入力する値', kind: 'template' }],
  lm_savePdf: [{ field: 'PATH', label: '保存先', kind: 'path' }],
};

/** 決まった値の説明です。 */
/** @type {Record<(typeof BUILTIN_REFERENCES)[number], string>} */
const BUILTIN_LABELS = {
  'flow.name': 'フローの名前',
  'site.host': 'サイトのホスト名（例：www.example.com）',
  'run.yyyy': '実行した年（4 桁）',
  'run.mm': '実行した月（2 桁）',
  'run.dd': '実行した日（2 桁）',
  'run.hhmmss': '実行した時刻（時分秒の 6 桁）',
};

/**
 * ブロックの、値を入れられる欄を返します。条件のブロックでは、値を使う条件のときだけ欄を返します。
 * @param {string} blockType
 * @param {Record<string, unknown>} fields ブロックの欄の値。条件のブロックでは COND を使います
 * @returns {ValueField[]}
 */
export function valueFields(blockType, fields) {
  if (blockType !== 'lm_if' && blockType !== 'lm_while') {
    return FIELDS[blockType] ?? [];
  }
  const kind = String(fields.COND ?? '');
  const uses = conditionUsesValues(kind);
  if (!uses.value) {
    return [];
  }
  return uses.value2
    ? [
        { field: 'VALUE', label: '期間の始め', kind: 'template' },
        { field: 'VALUE2', label: '期間の終わり', kind: 'template' },
      ]
    : [{ field: 'VALUE', label: '条件の値', kind: 'template' }];
}

/**
 * 欄に入れられる値の一覧を作ります。
 * @param {WorkspaceState} state Blockly の配置の保存形式
 * @param {string} blockId 値を入れるブロック
 * @param {'path' | 'template'} kind 欄の種類
 * @param {Param[]} params フローのパラメータ
 * @returns {InsertableValue[]}
 */
export function insertableValues(state, blockId, kind, params) {
  /** @type {InsertableValue[]} */
  const values = [];
  for (const param of params) {
    const label = param.label || param.name;
    values.push({ text: `{{${param.name}}}`, label, group: 'param' });
    if (param.type === 'month') {
      values.push(
        { text: `{{${param.name}.year}}`, label: `${label}の年（4 桁）`, group: 'param' },
        {
          text: `{{${param.name}.month}}`,
          label: `${label}の月（先頭に 0 を付けない）`,
          group: 'param',
        },
        { text: `{{${param.name}.mm}}`, label: `${label}の月（2 桁）`, group: 'param' },
      );
    }
  }
  if (kind !== 'path') {
    return values;
  }
  const paramNames = new Set(params.map((param) => param.name));
  const seen = new Set();
  for (const { name, target } of extractedBefore(state.blocks?.blocks ?? [], blockId) ?? []) {
    if (!paramNames.has(name) && !seen.has(name)) {
      seen.add(name);
      values.push({
        text: `{{${name}}}`,
        label: target ? `「${target}」を読み取った値` : '「読み取り」で覚えた値',
        group: 'extract',
      });
    }
  }
  for (const reference of BUILTIN_REFERENCES) {
    values.push({ text: `{{${reference}}}`, label: BUILTIN_LABELS[reference], group: 'builtin' });
  }
  return values;
}

/**
 * 「読み取り」で覚えた名前と、読み取る要素の説明です。
 * @typedef {object} Extracted
 * @property {string} name
 * @property {string} [target] 読み取る要素の説明（例：注文番号）
 */

/**
 * ブロックより前にある「読み取り」の名前を、前から順に返します。
 * ブロックと同じ並び、またはそれを囲む並びにある読み取りだけを含めます。もし・繰り返しの内側にある読み取りは、
 * その内側のブロックにだけ含めます。繰り返しの後では最後の行の値になり、条件の内側では値がない場合もあるためです。
 * @param {BlockState[]} tops 最上位のブロック（並びの先頭）
 * @param {string} blockId
 * @returns {Extracted[] | undefined} ブロックが見つからない場合は undefined
 */
function extractedBefore(tops, blockId) {
  for (const top of tops) {
    const found = searchChain(top, blockId, []);
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * 並びの中でブロックを探し、見つかった時点までに覚えた名前を返します。
 * @param {BlockState | undefined} first 並びの先頭
 * @param {string} blockId
 * @param {Extracted[]} names 囲む並びで、ここまでに覚えた名前
 * @returns {Extracted[] | undefined}
 */
function searchChain(first, blockId, names) {
  const known = [...names];
  for (let block = first; block; block = block.next?.block) {
    if (block.id === blockId) {
      return known;
    }
    for (const input of Object.values(block.inputs ?? {})) {
      const found = searchChain(input.block, blockId, known);
      if (found) {
        return found;
      }
    }
    if (block.type === 'lm_extract') {
      const name = String(block.fields?.NAME ?? '');
      if (PARAM_NAME_PATTERN.test(name) && !RESERVED_NAMES.includes(name)) {
        const target = /** @type {{ label?: unknown } | undefined} */ (
          block.extraState?.step?.target
        );
        known.push(typeof target?.label === 'string' ? { name, target: target.label } : { name });
      }
    }
  }
  return undefined;
}
