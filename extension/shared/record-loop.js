// 記録した手順の範囲を、一覧の各行で繰り返す手順（forEach）に変えます（#167）。
//
// 記録用のスクリプトは、操作した要素を含む一覧の行の候補（RowCandidate）を、手順ごとに求めて送ります
// （content/picker-rows.js の rowCandidates）。ページを移動すると要素を調べられなくなるため、操作した時点で
// 求めます。この候補は、記録中と保存前の手順にだけ添え、フロー定義には含めません。
// 行の見分けにはタグと class だけを使います。表示の文字は翻訳で置き換わるため使いません（CLAUDE.md）。

import { PAGE_STEP_TYPES, validateTarget } from './flow.js';
import { CONTROL_STEP_TYPES, flattenSteps } from './control-flow.js';
import { parseDate } from './condition.js';

/** @typedef {import('./flow.js').Step} Step */
/** @typedef {import('./flow.js').Target} Target */
/** @typedef {import('./params.js').Param} Param */

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
 * 手順 1 件に添える、押した要素を繰り返しのページ送り（nextPage）に使う場合の指定です（#182）。
 * ページ番号の数で位置が変わらないセレクターだけを持ちます（content/picker-rows.js の pagerSelectors）。
 * リンクかボタンのクリック以外の手順と、指定を作れなかった手順は null です。
 * @typedef {string[] | null} PagerHint
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

/** ページ送りに使う指定のセレクターの数と、1 つの長さの上限です（#182）。 */
const MAX_PAGER_SELECTORS = 10;
const MAX_SELECTOR_LENGTH = 2000;

/**
 * ページから届いた、ページ送りに使う場合の指定を確かめ、写した値を返します（#182）。形が誤っている場合と、
 * 空の場合は null です。
 * @param {unknown} value
 * @returns {PagerHint}
 */
export function sanitizePagerHint(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_PAGER_SELECTORS ||
    !value.every(
      (selector) =>
        typeof selector === 'string' &&
        selector.trim() !== '' &&
        selector.length <= MAX_SELECTOR_LENGTH,
    )
  ) {
    return null;
  }
  return [.../** @type {string[]} */ (value)];
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
 * @param {unknown} [nameIndexes] ファイル名に使う手順の番号（0 から数えます、#179）。選んだ順にファイル名に並べます
 * @param {unknown} [withSite] ファイル名の先頭にサイト名（{{site.host}}）を入れるか（#179）
 * @param {{ index?: unknown, pagers?: PagerHint[] }} [paging] 次のページへ送るクリックの番号と、steps と同じ順の
 *   ページ送りに使う場合の指定（#182）。index を書いた場合は、そのクリックの要素を nextPage にし、そのクリックと
 *   直後のページの移動、範囲の末尾との間の一覧のページへ戻る移動を手順から除きます
 * @param {{ index?: unknown, stopAtOlder?: unknown, params?: Param[] }} [filter] 対象の月の行だけを行う条件に使う
 *   日付の手順の番号と、対象の月より古い行に達したら終えるか、フローのパラメータ（#183）。index を書いた場合は、
 *   行の手順を、その日付が対象の月の場合だけ行う条件（if の month）で囲み、年月のパラメータを加えます
 * @returns {{ ok: true, steps: Step[], hints: RowHint[], pagers: PagerHint[], param?: Param } | { ok: false, error: string }}
 */
export function makeLoop(
  steps,
  hints,
  from,
  to,
  key,
  nameIndexes = [],
  withSite = false,
  paging = {},
  filter = {},
) {
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

  const pagers = steps.map((_, index) => paging.pagers?.[index] ?? null);
  // 次のページへ送るクリックと、その直後のページの移動は、繰り返しの中に置かず、nextPage にします（#182）。
  let innerEnd = end;
  let removeEnd = end;
  /** @type {Target | undefined} */
  let nextPage;
  if (paging.index !== undefined && paging.index !== null) {
    const index = /** @type {number} */ (paging.index);
    const step = steps[index];
    const selectors = pagers[index];
    if (
      typeof key !== 'string' ||
      !pagerSteps(steps, hints, pagers, start, key).includes(index) ||
      step?.type !== 'click' ||
      !selectors
    ) {
      return {
        ok: false,
        error:
          '次のページへ送る手順が正しくありません。手順の一覧を確かめてから選び直してください。',
      };
    }
    ({ innerEnd, removeEnd } = pagerSpan(steps, end, index));
    // 表示の文字（text）は書きません。見つからない場合に文字で探すと、最後のページの押せない「次へ」を
    // 押すことがあるためです。
    nextPage = { selectors: [...selectors], tag: step.target.tag, label: step.target.label };
  }

  const option = loopOptions(steps, hints, start, innerEnd).find((item) => item.key === key);
  if (!option) {
    return {
      ok: false,
      error: '選んだ範囲に、一覧の行の中を操作した手順がありません。範囲を選び直してください。',
    };
  }

  const naming = Array.isArray(nameIndexes) ? nameIndexes : [];
  const nameable = nameableSteps(steps, start, innerEnd);
  if (
    naming.some((index) => !Number.isInteger(index) || !nameable.includes(index)) ||
    new Set(naming).size !== naming.length
  ) {
    return {
      ok: false,
      error: 'ファイル名に使う手順が正しくありません。手順の一覧を確かめてから選び直してください。',
    };
  }
  const names = fileNames(steps, naming.length);

  /** @type {Step[]} */
  const inner = steps.slice(start, innerEnd + 1).map((step, offset) => {
    const candidate = usableHint(step, hints[start + offset])?.find(
      (item) => candidateKey(item.items) === key,
    );
    const moved = candidate && 'target' in step ? { ...step, target: candidate.inner } : step;
    const order = naming.indexOf(start + offset);
    return order === -1 ? moved : toExtract(moved, names[order]);
  });
  if (names.length > 0) {
    nameSaveSteps(inner, withSite === true ? ['site.host', ...names] : names);
  }

  // 対象の月の行だけを行う条件（#183）。日付の手順は、ファイル名にも使う場合は読み取りとして残し、使わない場合は
  // 除きます。日付の文字を押しても、ページは変わらないためです。
  /** @type {Step[]} */
  let rowSteps = inner;
  /** @type {Param | undefined} */
  let param;
  if (filter.index !== undefined && filter.index !== null) {
    const index = /** @type {number} */ (filter.index);
    if (typeof key !== 'string' || !dateSteps(steps, hints, start, innerEnd, key).includes(index)) {
      return {
        ok: false,
        error:
          '対象の月の条件に使う手順が正しくありません。手順の一覧を確かめてから選び直してください。',
      };
    }
    const offset = index - start;
    const dateStep = inner[offset];
    const rest = inner.filter((_, position) => position !== offset);
    if (!('target' in dateStep) || rest.length === 0) {
      return {
        ok: false,
        error: '対象の月の条件の後に行う手順がありません。範囲を選び直してください。',
      };
    }
    const month = monthParam(filter.params ?? []);
    param = month.add;
    const value = `{{${month.name}}}`;
    const { target } = dateStep;
    rowSteps = [
      ...(filter.stopAtOlder === true
        ? [
            /** @type {Step} */ ({
              type: 'if',
              condition: { target, before: value },
              then: [{ type: 'break' }],
            }),
          ]
        : []),
      ...(dateStep.type === 'extract' ? [dateStep] : []),
      { type: 'if', condition: { target, month: value }, then: rest },
    ];
  }
  // 記録から作る繰り返しでは、行の中の要素が見つからない行（キャンセル済みの注文など）を飛ばします（#174）。
  // 飛ばした行は、実行のカードと実行履歴に報告します。
  /** @type {Step} */
  const loop = {
    type: 'forEach',
    items: option.items,
    ...(nextPage ? { nextPage } : {}),
    onMissing: 'skip',
    steps: rowSteps,
  };
  return {
    ok: true,
    steps: [...steps.slice(0, start), loop, ...steps.slice(removeEnd + 1)],
    hints: [...hints.slice(0, start), null, ...hints.slice(removeEnd + 1)],
    pagers: [...pagers.slice(0, start), null, ...pagers.slice(removeEnd + 1)],
    ...(param ? { param } : {}),
  };
}

/** 記録から作る条件で加える、年月のパラメータの説明です（#183）。 */
export const MONTH_PARAM_LABEL = '対象月';

/**
 * 対象の月の条件に使う年月のパラメータの名前を決めます（#183）。month がない場合は加え、年月の month がある場合は
 * それを使います。別の種類の month がある場合は、month2、month3 … のうち使える名前にします。
 * @param {Param[]} params フローのパラメータ
 * @returns {{ name: string, add?: Param }}
 */
export function monthParam(params) {
  for (let number = 1; ; number += 1) {
    const name = number === 1 ? 'month' : `month${number}`;
    const existing = params.find((item) => item.name === name);
    if (!existing) {
      return {
        name,
        add: { name, label: MONTH_PARAM_LABEL, type: 'month', default: '@previous-month' },
      };
    }
    if (existing.type === 'month') {
      return { name };
    }
  }
}

/**
 * 対象の月の条件に使える日付の手順の番号を返します（#183）。範囲の中の、選んだ行の中の文字（リンクやボタン
 * 以外の要素）のクリックで、記録した文字が日付として読めるものです。読めない文字を条件にすると、実行の
 * 1 行目で停止するためです。
 * @param {Step[]} steps
 * @param {RowHint[]} hints
 * @param {number} from
 * @param {number} to 範囲の末尾（次のページへ送るクリックを選んだ場合は、その前まで）
 * @param {string} key 選んだ行の候補（candidateKey の値）
 * @returns {number[]}
 */
export function dateSteps(steps, hints, from, to, key) {
  /** @type {number[]} */
  const indexes = [];
  for (let index = from; index <= to && index < steps.length; index += 1) {
    const step = steps[index];
    const inRow = (usableHint(step, hints[index]) ?? []).some(
      (candidate) => candidateKey(candidate.items) === key,
    );
    if (
      step.type === 'click' &&
      step.download === undefined &&
      step.newTab === undefined &&
      !ACTION_TAGS.includes(step.target.tag) &&
      step.target.text !== undefined &&
      parseDate(step.target.text).ok &&
      inRow
    ) {
      indexes.push(index);
    }
  }
  return indexes;
}

/**
 * 次のページへ送るクリックを選んだ場合の、繰り返す手順の末尾と、手順から除く範囲の末尾を返します（#182）。
 * 繰り返す手順の末尾より後から、除く範囲の末尾までの手順を除きます。範囲の末尾から「次へ」までの手順
 * （［戻る］による一覧へ戻る移動など）と、「次へ」の直後のページの移動です。範囲の中で「次へ」より後にある
 * 手順も除きます。どれも 2 ページ目へ進むまでの操作で、ページ送りに置き換わるためです。
 * 除く手順は、［繰り返しにする］の欄で手順ごとに示します。
 * @param {Step[]} steps
 * @param {number} to 範囲の末尾
 * @param {number} index 次のページへ送るクリックの番号（pagerSteps の値）
 * @returns {{ innerEnd: number, removeEnd: number }}
 */
export function pagerSpan(steps, to, index) {
  let removeEnd = index;
  while (isPageNavigation(steps[removeEnd + 1])) {
    removeEnd += 1;
  }
  return { innerEnd: Math.min(to, index - 1), removeEnd: Math.max(removeEnd, to) };
}

/**
 * リンクのクリックなど、ページの操作による移動の手順かを判定します（#182）。
 * @param {Step | undefined} step
 * @returns {boolean}
 */
function isPageNavigation(step) {
  return step?.type === 'navigate' && step.cause === 'page';
}

/** ページ送りに使えるクリックの対象です（#182）。 */
const PAGER_TAGS = ['a', 'button'];

/**
 * 手順を記録した時点のページを、オリジンとパスで返します（#240）。直前のページの移動（navigate）の URL です。
 * クエリは含めません。一覧の 2 ページ目以降は、クエリ（`?p=2` など）だけが変わるためです。
 * 前にページの移動がない場合と、URL を読めない場合は null です。
 * @param {Step[]} steps
 * @param {number} index
 * @returns {string | null}
 */
function pageAt(steps, index) {
  for (let position = index - 1; position >= 0; position -= 1) {
    const step = steps[position];
    if (step.type === 'navigate') {
      try {
        const url = new URL(step.url);
        return url.origin + url.pathname;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * 次のページへ送るクリックとして選べる手順の番号を返します（#182）。範囲の 2 番目以降の手順のうち、次をすべて
 * 満たすものです。記録中に、1 件目の操作と「次へ」の間でほかの場所を押していても選べるよう、位置の条件は
 * 設けません。間の手順は、選んだ後に除きます（pagerSpan）。
 * - リンクかボタンのクリックで、ページ番号の数で位置が変わらない指定（PagerHint）を作れたもの
 * - 選んだ行の外の要素を押したもの
 * - 一覧のページ（範囲の先頭を記録したページ）で押したもの（#240）。詳細のページの［発行する］などを
 *   除くためです。どちらかのページが分からない場合は、この条件で除きません
 * - ページを読み込まずに一覧だけを差し替えるサイトでは、ページの移動が記録されないため、一覧のページのままと
 *   判定します
 * @param {Step[]} steps
 * @param {RowHint[]} hints
 * @param {PagerHint[]} pagers steps と同じ順の、ページ送りに使う場合の指定
 * @param {number} from 範囲の先頭
 * @param {string} key 選んだ行の候補（candidateKey の値）
 * @returns {number[]}
 */
export function pagerSteps(steps, hints, pagers, from, key) {
  /** @type {number[]} */
  const indexes = [];
  const listPage = pageAt(steps, from);
  for (let index = from + 1; index < steps.length; index += 1) {
    const step = steps[index];
    const inRow = (usableHint(step, hints[index]) ?? []).some(
      (candidate) => candidateKey(candidate.items) === key,
    );
    const page = pageAt(steps, index);
    if (
      (listPage === null || page === null || page === listPage) &&
      step.type === 'click' &&
      step.download === undefined &&
      step.newTab === undefined &&
      step.target.scope === undefined &&
      PAGER_TAGS.includes(step.target.tag) &&
      pagers[index] &&
      !inRow
    ) {
      indexes.push(index);
    }
  }
  return indexes;
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

/** ファイル名に使えないクリックの対象です（#179）。押すとページが移動したり、値が変わったりするためです。 */
export const ACTION_TAGS = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  'option',
];

/**
 * 保存先とファイル名を決める手順か（リンク先やクリックで始まるダウンロード、PDF の保存）を判定します（#179）。
 * @param {Step} step
 * @returns {boolean}
 */
function isSaveStep(step) {
  return step.type === 'savePdf' || (step.type === 'click' && step.download !== undefined);
}

/**
 * 範囲の中で、ファイル名に使える手順の番号を返します（#179）。文字（リンクやボタン以外の要素）をクリックした
 * 手順のうち、範囲の中の最初の保存の手順より前のものです。読み取った値は、その後の手順の保存先でだけ使える
 * ためです。範囲に保存の手順がない場合は空です。
 * @param {Step[]} steps
 * @param {number} from
 * @param {number} to
 * @returns {number[]}
 */
export function nameableSteps(steps, from, to) {
  const save = steps.findIndex((step, index) => index >= from && index <= to && isSaveStep(step));
  if (save === -1) {
    return [];
  }
  /** @type {number[]} */
  const indexes = [];
  for (let index = from; index < save; index += 1) {
    const step = steps[index];
    if (
      step.type === 'click' &&
      step.download === undefined &&
      step.newTab === undefined &&
      !ACTION_TAGS.includes(step.target.tag)
    ) {
      indexes.push(index);
    }
  }
  return indexes;
}

/**
 * 読み取りの手順の名前を、手順の中で使われていない名前から決めます（#179）。fileName1、fileName2 … です。
 * @param {Step[]} steps
 * @param {number} count
 * @returns {string[]}
 */
function fileNames(steps, count) {
  const used = new Set(
    flattenSteps(steps).flatMap(({ step }) => (step.type === 'extract' ? [step.name] : [])),
  );
  /** @type {string[]} */
  const names = [];
  for (let number = 1; names.length < count; number += 1) {
    const name = `fileName${number}`;
    if (!used.has(name)) {
      names.push(name);
    }
  }
  return names;
}

/**
 * 文字のクリックの手順を、同じ要素を読み取る手順に変えます（#179）。
 * @param {Step} step
 * @param {string} name
 * @returns {Step}
 */
function toExtract(step, name) {
  if (step.type !== 'click') {
    return step;
  }
  return {
    type: 'extract',
    target: step.target,
    name,
    ...(step.origin !== undefined ? { origin: step.origin } : {}),
    ...(step.translated ? { translated: true } : {}),
  };
}

/**
 * 繰り返しの中の保存の手順の保存先を、読み取った値を並べた名前にします（#179）。names には、組み込みの値
 * （site.host）も書けます。同じ注文を再び保存したときに
 * 増えないよう、同じ名前のファイルは上書きにします。同じ実行の中で同じ名前になった場合は、実行の処理が
 * 番号を付けて別名にします（background/runner.js）。元の配列の手順を置き換えます。
 * @param {Step[]} inner
 * @param {string[]} names
 */
function nameSaveSteps(inner, names) {
  const path = `Lightomate/{{flow.name}}/${names.map((name) => `{{${name}}}`).join('_')}`;
  inner.forEach((step, index) => {
    if (step.type === 'savePdf') {
      inner[index] = { ...step, path, onConflict: 'overwrite' };
    } else if (step.type === 'click' && step.download !== undefined) {
      inner[index] = { ...step, download: { ...step.download, path, onConflict: 'overwrite' } };
    }
  });
}

/**
 * 繰り返しを作った後に記録した「次へ」のクリックについて、ページ送りを付けられる繰り返しの番号を返します（#237）。
 * 付けられない手順は null です。次をすべて満たす手順が対象です。
 * - リンクかボタンのクリックで、ページ番号の数で位置が変わらない指定（PagerHint）を作れたもの
 * - 直前の繰り返し（最上位の forEach）にページ送りがなく、そのクリックが繰り返しの行の中の要素ではないもの
 * - 繰り返しとクリックの間の手順が、ページの移動（一覧へ戻る移動など）だけのもの。間にほかの操作がある場合は、
 *   その操作を手順から除くことになるため、対象にしません
 * @param {Step[]} steps
 * @param {RowHint[]} hints
 * @param {PagerHint[]} pagers
 * @returns {(number | null)[]} steps と同じ順の、ページ送りを付ける繰り返しの番号
 */
export function pagerLoops(steps, hints, pagers) {
  return steps.map((step, index) => {
    if (
      step.type !== 'click' ||
      step.download !== undefined ||
      step.newTab !== undefined ||
      step.target.scope !== undefined ||
      !PAGER_TAGS.includes(step.target.tag) ||
      !pagers[index]
    ) {
      return null;
    }
    let loop = index - 1;
    while (loop >= 0 && steps[loop].type === 'navigate') {
      loop -= 1;
    }
    const target = steps[loop];
    if (target?.type !== 'forEach' || target.nextPage !== undefined) {
      return null;
    }
    const key = candidateKey(target.items);
    const inRow = (usableHint(step, hints[index]) ?? []).some(
      (candidate) => candidateKey(candidate.items) === key,
    );
    return inRow ? null : loop;
  });
}

/**
 * 繰り返しを作った後に記録した「次へ」のクリックを、その繰り返しのページ送り（nextPage）にします（#237）。
 * 繰り返しの後から「次へ」までの手順（一覧へ戻る移動）と、「次へ」と直後のページの移動を、手順から除きます。
 * 元の配列は変更しません。
 * @param {Step[]} steps
 * @param {RowHint[]} hints
 * @param {PagerHint[]} pagers
 * @param {unknown} index 「次へ」のクリックの番号（0 から数えます）
 * @returns {{ ok: true, steps: Step[], hints: RowHint[], pagers: PagerHint[], loop: number } | { ok: false, error: string }}
 */
export function attachPager(steps, hints, pagers, index) {
  const at = Number.isInteger(index) ? /** @type {number} */ (index) : -1;
  const loop = at >= 0 && at < steps.length ? pagerLoops(steps, hints, pagers)[at] : null;
  const step = steps[at];
  const selectors = pagers[at];
  const target = loop === null ? undefined : steps[loop];
  if (loop === null || step?.type !== 'click' || !selectors || target?.type !== 'forEach') {
    return {
      ok: false,
      error: 'ページ送りにできない手順です。手順の一覧を確かめてから押し直してください。',
    };
  }
  let removeEnd = at;
  while (isPageNavigation(steps[removeEnd + 1])) {
    removeEnd += 1;
  }
  // 表示の文字（text）は書きません。見つからない場合に文字で探すと、最後のページの押せない「次へ」を押すことが
  // あるためです（makeLoop と同じ扱い、#182）。
  /** @type {Step} */
  const paged = {
    ...target,
    nextPage: { selectors: [...selectors], tag: step.target.tag, label: step.target.label },
  };
  return {
    ok: true,
    steps: [...steps.slice(0, loop), paged, ...steps.slice(removeEnd + 1)],
    hints: [...hints.slice(0, loop + 1), ...hints.slice(removeEnd + 1)],
    pagers: [...pagers.slice(0, loop + 1), ...pagers.slice(removeEnd + 1)],
    loop,
  };
}
