// 実行履歴の［コピー］に添える、原因の調査のための情報です（#198）。chrome.* は使いません。
//
// 止まった時点の変数の値と、フロー定義（JSON）を、ユーザー名とパスワードを伏せて作ります。
// ユーザー名は、名前やラベルから判定せず、「入力の手順（input）で入力欄に入れた値は伏せる」で扱います。
// ユーザー名は必ず入力欄に入れるため、名前の付け方によらず伏せられます。

import { flattenSteps } from './control-flow.js';
import { orderFlow } from './flow.js';
import { REDACTED, redactValues } from './history.js';
import { findReferences, renderTemplate } from './params.js';

/** @typedef {import('./flow.js').Flow} Flow */
/** @typedef {import('./flow.js').Step} Step */

/**
 * 止まった時点の変数の 1 つです。伏せた変数は value を持たず、length（文字数）だけを持ちます。
 * 文字数は、値が空だったかを判別するために残します。
 * @typedef {object} HistoryVariable
 * @property {string} name 変数の名前（パラメータの name か、extract の name）
 * @property {string} [value] 値。ほかの伏せた値と一致する部分は「＊＊＊」に置き換えてあります
 * @property {number} [length] 伏せた値の文字数
 */

/** 履歴に記録する変数の値の長さの上限です。超えた分は切ります。保存容量を抑えるためです。 */
export const VARIABLE_MAX_LENGTH = 200;

/** フローの指紋の長さ（16 進数の文字数）です。 */
const FINGERPRINT_LENGTH = 16;

/**
 * 入力の手順（input）の value が {{名前}} で参照している変数の名前です。
 * 入れ子（if、forEach、while）の内側の手順も含めます。
 * @param {Step[]} steps
 * @returns {Set<string>}
 */
export function inputReferenceNames(steps) {
  const names = new Set();
  for (const { step } of flattenSteps(steps)) {
    if (step.type === 'input' && typeof step.value === 'string') {
      for (const { name } of findReferences(step.value)) {
        names.add(name);
      }
    }
  }
  return names;
}

/**
 * 入力欄に入れた文字の一覧です。参照を値に置き換えた後の文字と、値を記録していない欄の値です。
 * ほかの変数の値やフロー定義の中に同じ文字があれば伏せるために使います。
 * @param {Step[]} steps
 * @param {Record<string, string>} values 参照に当てはめる値
 * @param {Iterable<string>} secrets 値を記録していない欄（secret）に入力した値
 * @returns {string[]}
 */
export function enteredTexts(steps, values, secrets) {
  const texts = [...secrets];
  for (const { step } of flattenSteps(steps)) {
    if (step.type === 'input' && typeof step.value === 'string') {
      texts.push(renderTemplate(step.value, values));
    }
  }
  return texts;
}

/**
 * 止まった時点の変数の一覧を作ります。パラメータ、読み取った値（extract）の順です。
 * 値がまだない変数（止まった手順より後の extract など）は含めません。
 * 入力欄に入れた変数は値を伏せ、文字数だけを残します。それ以外の変数の値も、入力欄に入れた文字と
 * 一致する部分は伏せます。
 * @param {Flow} flow 実行したフロー
 * @param {Record<string, string>} values 止まった時点の値（パラメータと読み取った値）
 * @param {Iterable<string>} secrets 値を記録していない欄に入力した値
 * @returns {HistoryVariable[]}
 */
export function historyVariables(flow, values, secrets) {
  const hidden = inputReferenceNames(flow.steps);
  const entered = enteredTexts(flow.steps, values, secrets);
  const names = [
    ...(flow.params ?? []).map((param) => param.name),
    ...flattenSteps(flow.steps).flatMap(({ step }) => (step.type === 'extract' ? [step.name] : [])),
  ];
  /** @type {HistoryVariable[]} */
  const variables = [];
  for (const name of new Set(names)) {
    if (!Object.hasOwn(values, name)) {
      continue;
    }
    const value = values[name];
    if (hidden.has(name)) {
      variables.push({ name, length: [...value].length });
    } else {
      variables.push({ name, value: truncate(redactValues(value, entered)) });
    }
  }
  return variables;
}

/**
 * 文字列を VARIABLE_MAX_LENGTH 文字で切ります。切った場合は末尾に「…」を付けます。
 * @param {string} text
 * @returns {string}
 */
function truncate(text) {
  const chars = [...text];
  return chars.length > VARIABLE_MAX_LENGTH
    ? `${chars.slice(0, VARIABLE_MAX_LENGTH).join('')}…`
    : text;
}

/**
 * フローの指紋です。フロー定義の内容から計算した SHA-256 の先頭 16 文字（16 進数）です。
 * 実行した時点のフローと、コピーした時点のフローが同じかを比べるために使います。
 * chrome.storage は項目の順序を保たないため、項目を名前の順に並べてから計算します。
 * @param {Flow} flow
 * @returns {Promise<string>}
 */
export async function flowFingerprint(flow) {
  const data = new TextEncoder().encode(canonicalJson(flow));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, FINGERPRINT_LENGTH);
}

/**
 * オブジェクトの項目を名前の順に並べた JSON です。配列の順序は変えません。
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value);
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * コピーに含めるフロー定義の写しを作ります。元のフローは変更しません。
 * - 入力の手順（input）の value は、すべて「＊＊＊」にします。
 * - 入力欄に入れるパラメータの既定値（default）は「＊＊＊」にします。
 * - 移動の手順（navigate）の URL は、クエリ（? 以降）とフラグメント（# 以降）を「＊＊＊」にします。
 * - そのほかの文字（要素の説明、URL のパスなど）も、入力した値と一致する部分は「＊＊＊」にします。
 * @param {Flow} flow
 * @returns {Flow}
 */
export function redactFlowForReport(flow) {
  const hidden = inputReferenceNames(flow.steps);
  /** @type {string[]} */
  const texts = [];
  for (const { step } of flattenSteps(flow.steps)) {
    if (step.type === 'input' && typeof step.value === 'string') {
      // 参照を除いた文字です。「{{user}}@example.com」の「@example.com」なども伏せます。
      texts.push(...step.value.split(/\{\{[^}]*\}\}/));
    }
  }
  for (const param of flow.params ?? []) {
    if (hidden.has(param.name) && param.default !== undefined) {
      texts.push(param.default);
    }
  }

  /** @type {Flow} */
  const copy = structuredClone(flow);
  for (const param of copy.params ?? []) {
    if (hidden.has(param.name) && param.default !== undefined) {
      param.default = REDACTED;
    }
  }
  for (const { step } of flattenSteps(copy.steps)) {
    if (step.type === 'input' && step.value !== undefined) {
      step.value = REDACTED;
    } else if (step.type === 'navigate') {
      step.url = withoutQuery(step.url);
    }
  }
  return /** @type {Flow} */ (redactStrings(copy, texts));
}

/**
 * URL のクエリとフラグメントを「＊＊＊」にします。参照（{{名前}}）を含む URL も扱えるよう、
 * URL として解釈せずに、最初の ? か # の位置で分けます。
 * @param {string} url
 * @returns {string}
 */
function withoutQuery(url) {
  const match = /^([^?#]*)(\?[^#]*)?(#.*)?$/s.exec(url);
  if (!match) {
    return url;
  }
  return `${match[1]}${match[2] ? `?${REDACTED}` : ''}${match[3] ? `#${REDACTED}` : ''}`;
}

/**
 * オブジェクトの中の文字列の値を、すべて redactValues で伏せます。項目の名前は変えません。
 * JSON の文字列ではなく値を置き換えるため、伏せた後も JSON として正しい形のままです。
 * @param {unknown} value
 * @param {string[]} texts
 * @returns {unknown}
 */
function redactStrings(value, texts) {
  if (typeof value === 'string') {
    return redactValues(value, texts);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactStrings(item, texts));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactStrings(item, texts)]),
    );
  }
  return value;
}

/**
 * 変数の一覧の行です。伏せた変数は「＊＊＊（10 文字）」と表示します。
 * @param {HistoryVariable[]} variables
 * @returns {string[]}
 */
export function variableLines(variables) {
  return variables.map(({ name, value, length }) =>
    value === undefined ? `  ${name}：${REDACTED}（${length ?? 0} 文字）` : `  ${name}：${value}`,
  );
}

/**
 * 履歴の［コピー］に、historyEntryText の後へ続けるテキストです（#198）。
 * 変数の値と、伏せたフロー定義を含めます。改行は LF です。
 * @param {{ variables?: HistoryVariable[], flowHash?: string }} entry 履歴の 1 件
 * @param {Flow | undefined} flow コピーした時点の保存済みのフロー。削除されている場合は undefined
 * @param {string | undefined} fingerprint コピーした時点のフローの指紋（flowFingerprint）
 * @returns {string}
 */
export function historyReportText(entry, flow, fingerprint) {
  const lines = [];
  if (entry.variables && entry.variables.length > 0) {
    lines.push('', '変数（入力欄に入れた値は伏せています）：', ...variableLines(entry.variables));
  }
  lines.push('');
  if (!flow) {
    lines.push('フローの定義：このフローは削除されているため、含めていません。');
    return `${lines.join('\n')}\n`;
  }
  lines.push('フローの定義（入力した値と、ユーザー名・パスワードは伏せています）：');
  if (!entry.flowHash) {
    lines.push(
      '※ この履歴には実行した時点のフローの記録がないため、実行の後に変更されたかはわかりません。',
    );
  } else if (entry.flowHash !== fingerprint) {
    lines.push('※ このフローは実行の後に変更されています。次の定義は、コピーした時点のものです。');
  }
  // 保存したフローは項目が名前の順に並ぶため、書き出しと同じ順序に並べ直します。
  lines.push(JSON.stringify(orderFlow(redactFlowForReport(flow)), null, 2));
  return `${lines.join('\n')}\n`;
}
