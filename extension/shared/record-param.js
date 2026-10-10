// 記録した選択と入力の値を、実行するたびに変える値（パラメータ）にします（#286）。
//
// 利用者が選ぶのは既定値だけです。パラメータの名前、表示名、種類、どの日付にまとめるか、年・月・日のどれかは、
// 記録した手順から決めます。管理画面で値の定義を作り、JSON の値を {{名前.部分}} に書き換える作業を、
// 記録中のボタン 1 つで行うためです。
// 年・月・日の判定には要素の表示名を使います。翻訳で表示名が変わっても、誤りは「判定できずに利用者に選んで
// もらう」側か、記録した値との食い違いで選択を求める側に寄せます（CLAUDE.md）。

import { flattenSteps } from './control-flow.js';
import { findReferences } from './params.js';

/** @typedef {import('./flow.js').Step} Step */
/** @typedef {import('./params.js').Param} Param */

/** 日付の部分です。 */
export const DATE_PARTS = /** @type {const} */ (['year', 'month', 'day']);

/** @typedef {typeof DATE_PARTS[number]} DatePart */

/** 日付の部分の、画面に出す名前です。 */
export const DATE_PART_LABELS = { year: '年', month: '月', day: '日' };

/**
 * 日付の既定値として選べる値と、画面に出す名前です。期間の始まりに使うものから並べます。
 * @type {[string, string][]}
 */
export const DATE_DEFAULT_CHOICES = [
  ['@first-of-previous-month', '前月 1 日'],
  ['@end-of-previous-month', '前月末日'],
  ['@first-of-current-month', '今月 1 日'],
  ['@today', '今日'],
];

/**
 * 実行するたびに変える値にできる手順の種類です。
 * date は日付の年・月・日（選択）、text は文字（入力）です。part が null の場合は、年・月・日のどれかを
 * 利用者に選んでもらいます。
 * @typedef {{ kind: 'date', part: DatePart | null } | { kind: 'text' }} ParamTarget
 */

/**
 * 値が {{名前}} を含むかを返します。
 * @param {string} text
 * @returns {boolean}
 */
function hasReference(text) {
  return findReferences(text).length > 0;
}

/**
 * 選択の手順の、数として読める記録値を返します。value を優先し、数でなければ表示文字列を使います。
 * 実行では、当てはめた値を value、表示文字列の順に照合するため、どちらか一方が数であれば選べます。
 * @param {import('./flow.js').SelectStep} step
 * @returns {string | null}
 */
function numericValue(step) {
  for (const text of [step.values[0], step.labels[0]]) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (/^\d{1,4}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * 記録した値が、日付の部分として取りうる値かを返します。
 * @param {DatePart} part
 * @param {string} value
 * @returns {boolean}
 */
function fitsPart(part, value) {
  const number = Number(value);
  if (part === 'year') {
    return value.length === 4 && number >= 1900;
  }
  if (part === 'month') {
    return value.length <= 2 && number >= 1 && number <= 12;
  }
  return value.length <= 2 && number >= 1 && number <= 31;
}

/**
 * 要素の表示名から、日付の部分を読み取ります。「年」「月」「日」のうち、最後に現れたものを使います。
 * 例：「開始の月」は月、「開始日」は日です。
 * @param {string} label
 * @returns {DatePart | null}
 */
function partFromLabel(label) {
  const match = /(年|月|日)[^年月日]*$/.exec(label);
  if (!match) {
    return null;
  }
  return match[1] === '年' ? 'year' : match[1] === '月' ? 'month' : 'day';
}

/**
 * 記録した値だけから、日付の部分を決めます。4 桁は年、13〜31 は日です。1〜12 は月か日か決まりません。
 * @param {string} value
 * @returns {DatePart | null}
 */
function partFromValue(value) {
  if (fitsPart('year', value)) {
    return 'year';
  }
  const number = Number(value);
  return value.length <= 2 && number >= 13 && number <= 31 ? 'day' : null;
}

/**
 * 手順を、実行するたびに変える値にできるかを返します。できない場合は null です。
 * 選択は、1 つだけ選び、数として読める値（月の 09 など）を記録した手順が対象です。入力は、値を記録した手順が
 * 対象です。パスワードなど値を記録しない入力欄と、すでに {{名前}} を含む手順は対象外です。
 * @param {Step} step
 * @returns {ParamTarget | null}
 */
export function paramTarget(step) {
  if (step.type === 'input') {
    if (step.secret || typeof step.value !== 'string' || hasReference(step.value)) {
      return null;
    }
    return { kind: 'text' };
  }
  if (step.type !== 'select' || step.values.length !== 1) {
    return null;
  }
  if (step.values.some(hasReference)) {
    return null;
  }
  const value = numericValue(step);
  if (value === null) {
    return null;
  }
  const fromLabel = partFromLabel(step.target.label ?? '');
  if (fromLabel && fitsPart(fromLabel, value)) {
    return { kind: 'date', part: fromLabel };
  }
  return { kind: 'date', part: partFromValue(value) };
}

/**
 * 手順の中で使っている名前（パラメータの参照と、読み取り extract の名前）を集めます。
 * @param {Step[]} steps
 * @returns {Set<string>}
 */
function usedNames(steps) {
  const names = new Set(findReferences(JSON.stringify(steps)).map(({ name }) => name));
  for (const { step } of flattenSteps(steps)) {
    if (step.type === 'extract') {
      names.add(step.name);
    }
  }
  return names;
}

/**
 * 使われていない名前を、prefix1、prefix2 … の順に探します。
 * @param {string} prefix
 * @param {Param[]} params
 * @param {Step[]} steps
 * @returns {string}
 */
function freeName(prefix, params, steps) {
  const taken = new Set([...params.map((param) => param.name), ...usedNames(steps)]);
  for (let number = 1; ; number += 1) {
    if (!taken.has(`${prefix}${number}`)) {
      return `${prefix}${number}`;
    }
  }
}

/**
 * 日付の表示名を決めます。要素の表示名から末尾の「年」「月」「日」を除いて「の日付」を付けます
 * （例：「開始の月」→「開始の日付」）。残る文字がない場合（表示名が「月」だけなど）は、既定値から
 * 「開始日」「終了日」「日付」とします。ほかのパラメータと重なる場合は、末尾に番号を付けます。
 * @param {string} label 要素の表示名
 * @param {string} defaultValue 選んだ既定値
 * @param {Param[]} params
 * @returns {string}
 */
function dateLabel(label, defaultValue, params) {
  const rest = label
    .trim()
    .replace(/(\s*の?\s*[年月日])+$/, '')
    .trim();
  let base;
  if (rest) {
    base = /日付$/.test(rest) ? rest : `${rest}の日付`;
  } else if (defaultValue === '@end-of-previous-month') {
    base = '終了日';
  } else if (defaultValue === '@today') {
    base = '日付';
  } else {
    base = '開始日';
  }
  const labels = new Set(params.map((param) => param.label));
  if (!labels.has(base)) {
    return base;
  }
  for (let number = 2; ; number += 1) {
    if (!labels.has(`${base} ${number}`)) {
      return `${base} ${number}`;
    }
  }
}

/**
 * 記録した値の形から、参照の部分の名前を決めます。月と日は、記録した値が 1 桁（9 など）なら先頭に 0 を
 * 付けない形（month、day）、それ以外（09、10 など）は 2 桁の形（mm、dd）にします。10 以上の値では
 * どちらか決まらないため、2 桁の形にします。
 * @param {DatePart} part
 * @param {string} value
 * @returns {string}
 */
function referencePart(part, value) {
  if (part === 'year') {
    return 'year';
  }
  const short = value.length === 1;
  if (part === 'month') {
    return short ? 'month' : 'mm';
  }
  return short ? 'day' : 'dd';
}

/**
 * 手順の値を、実行するたびに変える値にします。
 * 日付では、選んだ既定値と同じ既定値の日付のパラメータがあればそれを使い、なければ新しく加えます。
 * 文字では、記録した文字を既定値とする文字のパラメータを加えます。
 * @param {Step[]} steps 記録した手順（入れ子の外側の一覧）
 * @param {Param[]} params 今のパラメータ
 * @param {unknown} index 対象の手順の番号（0 から数えます）
 * @param {{ defaultValue?: unknown, part?: unknown }} choice 日付の既定値と、表示名から決まらない場合の部分
 * @returns {{ ok: true, steps: Step[], params: Param[], label: string } | { ok: false, error: string }}
 */
export function makeRecordedParam(steps, params, index, choice) {
  if (typeof index !== 'number' || !Number.isInteger(index) || !steps[index]) {
    return { ok: false, error: '対象の手順が見つかりません。' };
  }
  const step = steps[index];
  const target = paramTarget(step);
  if (!target) {
    return { ok: false, error: 'この手順は、実行するたびに変える値にできません。' };
  }

  if (target.kind === 'text' && step.type === 'input') {
    const name = freeName('text', params, steps);
    const value = step.value ?? '';
    const label = step.target.label?.trim() || `文字 ${name.slice(4)}`;
    /** @type {Param} */
    const param = { name, label, type: 'text', ...(value ? { default: value } : {}) };
    const next = steps.slice();
    next[index] = { ...step, value: `{{${name}}}` };
    return { ok: true, steps: next, params: [...params, param], label };
  }

  if (target.kind !== 'date' || step.type !== 'select') {
    return { ok: false, error: 'この手順は、実行するたびに変える値にできません。' };
  }
  const defaultValue = choice.defaultValue;
  if (!DATE_DEFAULT_CHOICES.some(([value]) => value === defaultValue)) {
    return { ok: false, error: '実行するときの日付を選んでください。' };
  }
  const part =
    target.part ??
    (DATE_PARTS.includes(/** @type {DatePart} */ (choice.part))
      ? /** @type {DatePart} */ (choice.part)
      : null);
  if (!part) {
    return { ok: false, error: '年・月・日のどれかを選んでください。' };
  }
  const value = /** @type {string} */ (numericValue(step));

  const existing = params.find((param) => param.type === 'date' && param.default === defaultValue);
  /** @type {Param[]} */
  let nextParams = params;
  let name;
  let label;
  if (existing) {
    name = existing.name;
    label = existing.label;
  } else {
    name = freeName('date', params, steps);
    label = dateLabel(step.target.label ?? '', /** @type {string} */ (defaultValue), params);
    nextParams = [
      ...params,
      { name, label, type: 'date', default: /** @type {string} */ (defaultValue) },
    ];
  }
  const next = steps.slice();
  next[index] = { ...step, values: [`{{${name}.${referencePart(part, value)}}}`] };
  return { ok: true, steps: next, params: nextParams, label };
}

/**
 * どの手順も参照していないパラメータを除きます。手順を削除して参照がなくなった値を、フローに残さないためです。
 * @param {Step[]} steps
 * @param {Param[] | undefined} params
 * @returns {Param[]}
 */
export function referencedParams(steps, params) {
  if (!params?.length) {
    return [];
  }
  const names = new Set(findReferences(JSON.stringify(steps)).map(({ name }) => name));
  return params.filter((param) => names.has(param.name));
}

/** 参照の部分ごとの、画面に出す名前です。 */
const PART_NAMES = /** @type {Record<string, string>} */ ({
  year: '年',
  month: '月',
  mm: '月',
  day: '日',
  dd: '日',
});

/**
 * 実行するときに入力する値にした手順に添える説明です（#286）。例：「実行するときに入力：開始日の月」。
 * 選択と入力の手順で、値が定義のあるパラメータを参照する場合に返し、それ以外は null です。
 * @param {Step} step
 * @param {Param[] | undefined} params
 * @returns {string | null}
 */
export function valueParamNote(step, params) {
  const text =
    step.type === 'select'
      ? step.values.join(' ')
      : step.type === 'input' && typeof step.value === 'string'
        ? step.value
        : '';
  const names = findReferences(text).flatMap(({ name, part }) => {
    const param = params?.find((item) => item.name === name);
    if (!param) {
      return [];
    }
    return [part && PART_NAMES[part] ? `${param.label}の${PART_NAMES[part]}` : param.label];
  });
  return names.length > 0 ? `実行するときに入力：${names.join('、')}` : null;
}
