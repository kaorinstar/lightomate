// サイトごとの「必ず止まる場所」の指定です（#54）。chrome.* を使わない処理だけを置きます。
//
// 確定ボタンの文言による検出（purchase-guard.js）では判定できないボタンや画面に備え、利用者が
// サイト（オリジン）ごとに、止める要素（CSS セレクター）と止める画面（URL のパス）を指定します。
// 指定はフローとは別に保存し、同じサイトのすべてのフローに効かせます。フローの JSON を編集しても、
// 指定を外せないようにするためです。

/** chrome.storage.local に指定を保存するキーです。 */
export const STOP_RULES_KEY = 'stopRules';

/** オリジンごとに、止める要素と止める画面をそれぞれ指定できる件数の上限です。 */
export const MAX_STOP_ENTRIES = 50;

/** 指定 1 件の長さの上限です。 */
export const MAX_STOP_ENTRY_LENGTH = 500;

/**
 * 1 つのサイトの指定です。
 * @typedef {object} StopRule
 * @property {string[]} selectors 止める要素（CSS セレクター）
 * @property {string[]} paths 止める画面（URL のパス。`*` は任意の文字列）
 */

/**
 * テキストエリアに 1 行 1 件で入力された指定を、前後の空白を除いた一覧にします。空の行は除きます。
 * @param {string} text
 * @returns {string[]}
 */
export function parseLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * 指定の形式を検証します。CSS セレクターの構文は、ここでは確かめません（画面で確かめます）。
 * @param {unknown} rule
 * @returns {string[]} 誤りの説明の一覧。空の場合は形式を満たしています。
 */
export function validateStopRule(rule) {
  if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
    return ['指定がオブジェクトではありません。'];
  }
  const { selectors, paths } = /** @type {Record<string, unknown>} */ (rule);
  return [...entryErrors('selectors', selectors), ...entryErrors('paths', paths)];
}

/**
 * 止める要素と止める画面の誤りを、欄ごとに分けて返します。
 * 画面で、誤りをそれぞれの入力欄の直下に表示するために使います。検証の内容は validateStopRule と同じです。
 * @param {StopRule} rule
 * @returns {{ selectors: string[], paths: string[] }}
 */
export function stopRuleFieldErrors(rule) {
  return {
    selectors: entryErrors('selectors', rule.selectors),
    paths: entryErrors('paths', rule.paths),
  };
}

/**
 * 止める要素、または止める画面の一覧を検証します。
 * @param {'selectors' | 'paths'} name
 * @param {unknown} values
 * @returns {string[]}
 */
function entryErrors(name, values) {
  const label = name === 'selectors' ? '止める要素' : '止める画面';
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    return [`${label}（${name}）が文字列の配列ではありません。`];
  }
  /** @type {string[]} */
  const errors = [];
  if (values.length > MAX_STOP_ENTRIES) {
    errors.push(`${label}は ${MAX_STOP_ENTRIES} 件までです。`);
  }
  for (const value of values) {
    if (value.trim() === '') {
      errors.push(`${label}に空の指定があります。`);
    } else if (value.length > MAX_STOP_ENTRY_LENGTH) {
      errors.push(
        `${label}の「${value.slice(0, 30)}…」が ${MAX_STOP_ENTRY_LENGTH} 文字を超えています。`,
      );
    } else if (name === 'paths' && !value.startsWith('/')) {
      errors.push(`止める画面の「${value}」が / で始まっていません。`);
    }
  }
  return errors;
}

/**
 * 保存した指定の中から、オリジンに対応する指定を取り出します。ない場合は空の指定を返します。
 * @param {unknown} all 保存した指定（オリジンごとのオブジェクト）
 * @param {string} origin
 * @returns {StopRule}
 */
export function ruleForOrigin(all, origin) {
  const rule =
    typeof all === 'object' && all !== null
      ? /** @type {Record<string, unknown>} */ (all)[origin]
      : undefined;
  return validateStopRule(rule).length === 0
    ? /** @type {StopRule} */ (rule)
    : { selectors: [], paths: [] };
}

/**
 * URL のパスが、止める画面の指定に一致するかを判定します。
 * クエリ文字列（? 以降）とページ内の位置（# 以降）は比べません。`*` は `/` を含む任意の文字列に
 * 一致し、それ以外の文字は完全に一致する必要があります。
 * @param {string} pattern 止める画面の指定（例：/checkout/*）
 * @param {string} url 表示中のページの URL
 * @returns {boolean}
 */
export function matchesPath(pattern, url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(pathname);
}

/**
 * 表示中のページが、止める画面の指定のどれかに一致すれば、その指定を返します。
 * @param {StopRule} rule
 * @param {string} url
 * @returns {string | undefined}
 */
export function findStopPath(rule, url) {
  return rule.paths.find((pattern) => matchesPath(pattern, url));
}

/**
 * サイトごとの指定で止まるときの説明です。
 * @param {'selector' | 'path'} kind 一致した指定の種類
 * @param {string} value 一致した指定
 * @returns {string}
 */
export function stopRuleNote(kind, value) {
  const what = kind === 'selector' ? '止める要素' : '止める画面';
  return `サイトごとの指定（${what}：${value}）により止まります。内容を確認し、以降の操作は手で行ってください。`;
}

/** @typedef {import('./flow.js').Step} Step */

/**
 * 記録したクリックが、サイトごとの指定に一致すれば、一時停止の手順に置き換えます。
 * 直前の手順がすでに一時停止の場合は、重ねて記録しないよう、手順を返しません（null）。
 * @param {Step} step 記録した手順
 * @param {Step | undefined} previous 直前に記録した手順
 * @param {StopRule} rule 記録しているサイトの指定
 * @param {string} url クリックしたページの URL
 * @param {string | undefined} matchedSelector クリックした要素が一致した止める要素の指定
 * @returns {{ step: Step | null, note?: string }} 置き換えた場合は、止まる理由の説明を note で返します。
 */
export function applyStopRuleToRecordedStep(step, previous, rule, url, matchedSelector) {
  if (step.type !== 'click') {
    return { step };
  }
  const selector =
    matchedSelector !== undefined && rule.selectors.includes(matchedSelector)
      ? matchedSelector
      : undefined;
  const path = selector === undefined ? findStopPath(rule, url) : undefined;
  if (selector === undefined && path === undefined) {
    return { step };
  }
  const note =
    selector !== undefined ? stopRuleNote('selector', selector) : stopRuleNote('path', path ?? '');
  return { step: previous?.type === 'pause' ? null : { type: 'pause', note }, note };
}
