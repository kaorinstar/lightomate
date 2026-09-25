// 実行速度（#15）です。手順と手順の間に待つ時間と、待機の手順（wait）の時間を扱います。chrome.* は使いません。
//
// 速度の制御は、サイトへの負荷と、自動操作と判断されてアカウントが制限される可能性を下げるための対策です。
// 利用規約の遵守を意味しません。

/**
 * 手順と手順の間に待つ時間の範囲（ミリ秒）です。min と max の間から毎回ランダムに決めます。
 * @typedef {object} Interval
 * @property {number} min
 * @property {number} max
 */

/** interval を指定しないフローの、手順の間隔です。 */
export const DEFAULT_INTERVAL = Object.freeze({ min: 1000, max: 1000 });

/** 手順の間隔の上限（ミリ秒）です。長すぎる値の誤入力を防ぎます。 */
export const MAX_INTERVAL_MS = 60_000;

/** 待機の手順の上限（ミリ秒）です。 */
export const MAX_WAIT_MS = 300_000;

/**
 * フローの手順の間隔を返します。指定がない場合は既定の間隔です。
 * @param {{ interval?: Interval }} flow
 * @returns {Interval}
 */
export function stepInterval(flow) {
  return flow.interval ?? DEFAULT_INTERVAL;
}

/**
 * 手順の後に待つ時間を、範囲の中から一様に決めます。min と max を含む整数です。
 * @param {Interval} interval
 * @param {() => number} [random] 0 以上 1 未満の数を返す関数。テストでは固定の値を渡します
 * @returns {number}
 */
export function pickDelay({ min, max }, random = Math.random) {
  return Math.min(max, min + Math.floor(random() * (max - min + 1)));
}

/**
 * interval の形式を検証します。
 * @param {unknown} value
 * @returns {string[]} 誤りの説明の一覧
 */
export function validateInterval(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['interval がオブジェクトではありません。'];
  }
  const { min, max } = /** @type {Record<string, unknown>} */ (value);
  /** @type {string[]} */
  const errors = [];
  for (const [key, ms] of [
    ['min', min],
    ['max', max],
  ]) {
    if (!isMilliseconds(ms, 0, MAX_INTERVAL_MS)) {
      errors.push(
        `interval.${key} が、0 以上 ${MAX_INTERVAL_MS} 以下の整数（ミリ秒）ではありません。`,
      );
    }
  }
  if (errors.length === 0 && /** @type {number} */ (min) > /** @type {number} */ (max)) {
    errors.push('interval.min が interval.max より大きくなっています。');
  }
  return errors;
}

/**
 * 待機の手順の ms を検証します。
 * @param {unknown} ms
 * @returns {string[]} 誤りの説明の一覧
 */
export function validateWaitMs(ms) {
  return isMilliseconds(ms, 1, MAX_WAIT_MS)
    ? []
    : [`ms が、1 以上 ${MAX_WAIT_MS} 以下の整数（ミリ秒）ではありません。`];
}

/**
 * 画面で入力した秒数を、ミリ秒にします。小数第 1 位まで入力できます。
 * @param {string} text 入力した文字列（前後の空白は無視します）
 * @param {number} maxMs 上限（ミリ秒）
 * @returns {{ ok: true, ms: number } | { ok: false, error: string }}
 */
export function parseSeconds(text, maxMs) {
  const trimmed = text.trim();
  if (!/^\d+(\.\d)?$/.test(trimmed)) {
    return { ok: false, error: '0 以上の数を、小数第 1 位までの秒数で入力してください。' };
  }
  const ms = Math.round(Number(trimmed) * 1000);
  if (ms > maxMs) {
    return { ok: false, error: `${formatSeconds(maxMs)} 秒以下で入力してください。` };
  }
  return { ok: true, ms };
}

/**
 * 管理画面の「実行の速度」の入力を、手順の間隔にします。
 * 片方だけ入力した場合は、空欄の方に同じ値を入れます（一定の間隔）。両方が空欄の場合は interval を
 * undefined とし、既定の間隔に戻します。
 * @param {string} minText 最短の欄の文字列（秒）
 * @param {string} maxText 最長の欄の文字列（秒）
 * @returns {{ ok: true, interval: Interval | undefined }
 *   | { ok: false, field: 'min' | 'max', error: string }}
 */
export function readIntervalInput(minText, maxText) {
  const minTrimmed = minText.trim();
  const maxTrimmed = maxText.trim();
  if (minTrimmed === '' && maxTrimmed === '') {
    return { ok: true, interval: undefined };
  }
  const min = parseSeconds(minTrimmed || maxTrimmed, MAX_INTERVAL_MS);
  if (!min.ok) {
    return { ok: false, field: minTrimmed ? 'min' : 'max', error: min.error };
  }
  const max = parseSeconds(maxTrimmed || minTrimmed, MAX_INTERVAL_MS);
  if (!max.ok) {
    return { ok: false, field: 'max', error: max.error };
  }
  if (min.ms > max.ms) {
    return { ok: false, field: 'max', error: '最長には、最短以上の秒数を入力してください。' };
  }
  return { ok: true, interval: { min: min.ms, max: max.ms } };
}

/**
 * ミリ秒を、画面に表示する秒数にします（例：1500 → "1.5"）。
 * @param {number} ms
 * @returns {string}
 */
export function formatSeconds(ms) {
  return String(Math.round(ms / 100) / 10);
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @returns {value is number}
 */
function isMilliseconds(value, min, max) {
  return (
    Number.isInteger(value) &&
    /** @type {number} */ (value) >= min &&
    /** @type {number} */ (value) <= max
  );
}
