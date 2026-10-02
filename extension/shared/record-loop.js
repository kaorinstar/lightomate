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
 * 先頭は行の候補がある最初の手順、末尾は最後の手順です。ただし、先頭より後に繰り返しに含められない手順
 * （一覧のページを開き直した手順など）がある場合は、その手順の前までにします。
 * 候補がある手順がない場合は null です。
 * @param {Step[]} steps
 * @param {RowHint[]} hints
 * @returns {{ from: number, to: number } | null}
 */
export function defaultLoopRange(steps, hints) {
  const from = steps.findIndex((step, index) => usableHint(step, hints[index]) !== null);
  if (from < 0) {
    return null;
  }
  const excluded = steps.findIndex((step, index) => index > from && excludedReason(step) !== null);
  return { from, to: excluded < 0 ? steps.length - 1 : excluded - 1 };
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
 * 候補の画面に出す名前です。CSS セレクターは利用者に意味が伝わらないため、件数で示します。
 * 件数が同じ候補が複数ある場合は、その候補の中を操作した手順の数を添えて見分けます。
 * 例：このページに 10 件ある枠
 * @param {LoopOption} option
 * @param {LoopOption[]} options 同時に示す候補
 * @returns {string}
 */
export function loopOptionLabel(option, options) {
  const label = `このページに ${option.count} 件ある枠`;
  return options.filter((other) => other.count === option.count).length > 1
    ? `${label}（手順 ${option.used} 件が中を操作）`
    : label;
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
    const reason = excludedReason(step);
    if (reason) {
      return {
        ok: false,
        error: `${start + offset + 1} 番目の手順は、${reason}。範囲から外してください。`,
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
  // 記録から作る繰り返しでは、行の中の要素が見つからない行（キャンセル済みの注文など）を飛ばします（#174）。
  // 飛ばした行は、実行のカードと実行履歴に報告します。
  /** @type {Step} */
  const loop = { type: 'forEach', items: option.items, onMissing: 'skip', steps: inner };
  return {
    ok: true,
    steps: [...steps.slice(0, start), loop, ...steps.slice(end + 1)],
    hints: [...hints.slice(0, start), null, ...hints.slice(end + 1)],
  };
}

/**
 * 繰り返しに含められない手順か確かめ、含められない場合はその理由を返します。含められる場合は null です。
 * @param {Step} step
 * @returns {string | null}
 */
export function excludedReason(step) {
  if (step.type === 'navigate' && step.cause === 'user') {
    return '一覧のページを開く手順のため、繰り返しに含めません';
  }
  if (CONTROL_STEP_TYPES.includes(step.type) || step.type === 'break') {
    return '繰り返しや条件の手順のため、含められません';
  }
  return null;
}

/**
 * 手順の印（チェックボックス）を切り替えた後の範囲を返します。範囲は続いた手順で、印を付けた手順と
 * 範囲の間の手順を含めます。範囲の途中の印を外した場合は、その手順の前までにします。
 * 含められない手順をまたぐ場合は、印を付けた手順だけの範囲にします。
 * @param {Step[]} steps
 * @param {{ from: number, to: number } | null} range 今の範囲。印がない場合は null
 * @param {number} index 印を切り替えた手順（0 から数えます）
 * @param {boolean} checked 印を付けたか
 * @returns {{ from: number, to: number } | null}
 */
export function toggleRange(steps, range, index, checked) {
  if (checked) {
    if (excludedReason(steps[index])) {
      return range;
    }
    if (!range) {
      return { from: index, to: index };
    }
    const from = Math.min(range.from, index);
    const to = Math.max(range.to, index);
    return steps.slice(from, to + 1).some((step) => excludedReason(step) !== null)
      ? { from: index, to: index }
      : { from, to };
  }
  if (!range || index < range.from || index > range.to) {
    return range;
  }
  if (range.from === range.to) {
    return null;
  }
  if (index === range.from) {
    return { from: index + 1, to: range.to };
  }
  return { from: range.from, to: index - 1 };
}

/**
 * 範囲の各手順が、要素をどこで探すかを返します。選んだ行の中の要素を操作した手順は item（1 件の中）、
 * それ以外で要素を操作する手順は page（ページ全体）、要素を操作しない手順は null です。
 * @param {Step[]} steps
 * @param {RowHint[]} hints
 * @param {number} from
 * @param {number} to
 * @param {string} key 選んだ行の候補（candidateKey の値）
 * @returns {('item' | 'page' | null)[]} from から to までの手順の分
 */
export function stepScopes(steps, hints, from, to, key) {
  return steps.slice(from, to + 1).map((step, offset) => {
    if (!PAGE_STEP_TYPES.includes(step.type)) {
      return null;
    }
    const candidates = usableHint(step, hints[from + offset]) ?? [];
    return candidates.some((candidate) => candidateKey(candidate.items) === key) ? 'item' : 'page';
  });
}
