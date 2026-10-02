// 記録した手順の範囲を、一覧の各行で繰り返す手順（forEach）に変えます（#167）。
//
// 記録用のスクリプトは、操作した要素を含む一覧の行の候補（RowCandidate）を、手順ごとに求めて送ります
// （content/picker-rows.js の rowCandidates）。ページを移動すると要素を調べられなくなるため、操作した時点で
// 求めます。この候補は、記録中と保存前の手順にだけ添え、フロー定義には含めません。
// 行の見分けにはタグと class だけを使います。表示の文字は翻訳で置き換わるため使いません（CLAUDE.md）。

import { PAGE_STEP_TYPES, validateTarget } from './flow.js';
import { CONTROL_STEP_TYPES } from './control-flow.js';

/** @typedef {import('./flow.js').Step} Step */
/** @typedef {import('./flow.js').Target} Target */

/**
 * 操作した要素を含む一覧の行の候補です。
 * @typedef {object} RowCandidate
 * @property {Target} items 同じ形の行すべてに一致する指定（ページ全体で探します）
 * @property {number} count 記録した時点の行の数
 * @property {Target} inner 行の内側で、操作した要素を指す指定（scope: item）
 */

/**
 * 手順 1 件に添える、行の候補です。行が見つからなかった手順と、要素を操作しない手順は null です。
 * @typedef {RowCandidate[] | null} RowHint
 */

/**
 * 繰り返しの行として選べる候補です。
 * @typedef {object} LoopOption
 * @property {string} key 候補を見分ける値（行の指定のセレクター）
 * @property {Target} items 行の指定
 * @property {number} count 記録した時点の行の数
 * @property {number} used 範囲の中で、この行の内側の要素を操作した手順の数
 */

/** 手順 1 件に添える候補の数の上限です。content/picker-rows.js の rowCandidates と同じ値です。 */
const MAX_CANDIDATES = 5;

/** 行の数として受け付ける上限です。 */
const MAX_ROW_COUNT = 100000;

/**
 * ページから届いた行の候補を確かめ、必要な項目だけを写した値を返します。形が誤っている場合は null です。
 * @param {unknown} value
 * @returns {RowHint}
 */
export function sanitizeRowHint(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CANDIDATES) {
    return null;
  }
  /** @type {RowCandidate[]} */
  const candidates = [];
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) {
      return null;
    }
    const { items, count, inner } = /** @type {Record<string, unknown>} */ (candidate);
    if (
      validateTarget(items, 'items').length > 0 ||
      validateTarget(inner, 'inner').length > 0 ||
      !Number.isInteger(count) ||
      /** @type {number} */ (count) < 2 ||
      /** @type {number} */ (count) > MAX_ROW_COUNT
    ) {
      return null;
    }
    const rowTarget = /** @type {Target} */ (items);
    const innerTarget = /** @type {Target} */ (inner);
    if (rowTarget.scope !== undefined || innerTarget.scope !== 'item') {
      return null;
    }
    candidates.push({
      items: copyTarget(rowTarget),
      count: /** @type {number} */ (count),
      inner: { ...copyTarget(innerTarget), scope: 'item' },
    });
  }
  return candidates;
}

/**
 * 要素の指定から、フロー定義に書く項目だけを写します。
 * @param {Target} target
 * @returns {Target}
 */
function copyTarget({ selectors, tag, label, text }) {
  return text === undefined
    ? { selectors: [...selectors], tag, label }
    : { selectors: [...selectors], tag, label, text };
}

/**
 * 候補を見分ける値です。行の指定のセレクターが同じ候補は、同じ行とみなします。
 * @param {Target} items
 * @returns {string}
 */
export function candidateKey(items) {
  return JSON.stringify(items.selectors);
}

/**
 * 繰り返しにできる手順を 1 件以上含む範囲の、既定の先頭と末尾を返します。
 * 先頭は行の候補がある最初の手順、末尾は最後の手順です。候補がある手順がない場合は null です。
 * @param {Step[]} steps
 * @param {RowHint[]} hints
 * @returns {{ from: number, to: number } | null}
 */
export function defaultLoopRange(steps, hints) {
  const from = steps.findIndex((step, index) => usableHint(step, hints[index]) !== null);
  return from < 0 ? null : { from, to: steps.length - 1 };
}

/**
 * 範囲の手順の、行の候補をまとめて返します。範囲の中で多くの手順が操作した行を先にし、同じ数の場合は
 * 行の数が多い候補を先にします。一覧の 1 件分の操作は、同じ行の内側の要素を続けて操作するためです。
 * @param {Step[]} steps
 * @param {RowHint[]} hints
 * @param {number} from 範囲の先頭（0 から数えます）
 * @param {number} to 範囲の末尾（この手順を含みます）
 * @returns {LoopOption[]}
 */
export function loopOptions(steps, hints, from, to) {
  /** @type {Map<string, LoopOption>} */
  const options = new Map();
  for (let index = from; index <= to && index < steps.length; index += 1) {
    for (const candidate of usableHint(steps[index], hints[index]) ?? []) {
      const key = candidateKey(candidate.items);
      const option = options.get(key);
      if (option) {
        option.used += 1;
        option.count = Math.max(option.count, candidate.count);
      } else {
        options.set(key, { key, items: candidate.items, count: candidate.count, used: 1 });
      }
    }
  }
  return [...options.values()].sort((a, b) => b.used - a.used || b.count - a.count);
}

/**
 * 繰り返しの行の候補として使える手順か確かめ、使える場合は候補を返します。
 * 要素を操作する手順のうち、確定ボタンなどで一時停止に変えた手順は対象外です。
 * @param {Step | undefined} step
 * @param {RowHint | undefined} hint
 * @returns {RowCandidate[] | null}
 */
function usableHint(step, hint) {
  return step && PAGE_STEP_TYPES.includes(step.type) && hint ? hint : null;
}

/**
 * 候補の画面に出す名前です。例：一覧の行（div.order）・10 件
 * @param {LoopOption} option
 * @returns {string}
 */
export function loopOptionLabel(option) {
  return `${option.items.label}・${option.count} 件`;
}

/**
 * 範囲の手順を、選んだ行の各行で繰り返す手順に変えます。元の配列は変更しません。
 * 選んだ行の内側の要素を操作した手順は、行の内側で要素を探す指定（scope: item）に変えます。
 * それ以外の手順（行の外の要素を操作した手順、ページの移動など）は、そのまま繰り返しの中に置きます。
 * @param {Step[]} steps
 * @param {RowHint[]} hints steps と同じ順の、行の候補
 * @param {unknown} from 範囲の先頭（0 から数えます）
 * @param {unknown} to 範囲の末尾（この手順を含みます）
 * @param {unknown} key 選んだ行の候補（candidateKey の値）
 * @returns {{ ok: true, steps: Step[], hints: RowHint[] } | { ok: false, error: string }}
 */
export function makeLoop(steps, hints, from, to, key) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    /** @type {number} */ (from) < 0 ||
    /** @type {number} */ (from) > /** @type {number} */ (to) ||
    /** @type {number} */ (to) >= steps.length
  ) {
    return { ok: false, error: '繰り返す手順の範囲が正しくありません。' };
  }
  const start = /** @type {number} */ (from);
  const end = /** @type {number} */ (to);
  const range = steps.slice(start, end + 1);

  for (const [offset, step] of range.entries()) {
    const number = start + offset + 1;
    if (CONTROL_STEP_TYPES.includes(step.type) || step.type === 'break') {
      return {
        ok: false,
        error: `${number} 番目の手順は繰り返しや条件のため、範囲に含められません。範囲から外してください。`,
      };
    }
    if (step.type === 'navigate' && step.cause === 'user') {
      return {
        ok: false,
        error: `${number} 番目の手順（ページを開く）は、繰り返しに含められません。一覧のページへは、行ごとの処理の後に自動で戻ります。範囲から外してください。`,
      };
    }
  }

  const option = loopOptions(steps, hints, start, end).find((item) => item.key === key);
  if (!option) {
    return {
      ok: false,
      error: '選んだ範囲に、一覧の行の中を操作した手順がありません。範囲を選び直してください。',
    };
  }

  /** @type {Step[]} */
  const inner = range.map((step, offset) => {
    const candidate = usableHint(step, hints[start + offset])?.find(
      (item) => candidateKey(item.items) === key,
    );
    return candidate && 'target' in step ? { ...step, target: candidate.inner } : step;
  });
  /** @type {Step} */
  const loop = { type: 'forEach', items: option.items, steps: inner };
  return {
    ok: true,
    steps: [...steps.slice(0, start), loop, ...steps.slice(end + 1)],
    hints: [...hints.slice(0, start), null, ...hints.slice(end + 1)],
  };
}
