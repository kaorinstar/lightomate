// フロー定義（JSON）の型と検証です。
//
// この形式は仮の初版です。手順の種類ごとの項目は、記録の最小構成（#4）で決めます。
// ES モジュールのため、Service Worker と拡張機能の画面からは読み込めますが、content script からは
// 読み込めません。content script から ES モジュールを読み込むには web_accessible_resources の宣言が
// 必要になり、ページから拡張機能の有無を検出できるようになるためです。検証は Service Worker で行います。

/** 現在のフロー定義の形式の版番号です。形式を変えるときに 1 増やします。 */
export const SCHEMA_VERSION = 1;

/**
 * フローの 1 つの手順です。
 * @typedef {object} Step
 * @property {string} type 手順の種類（例：click、input）
 */

/**
 * フロー定義です。
 * @typedef {object} Flow
 * @property {number} schemaVersion 形式の版番号
 * @property {string} name フロー名
 * @property {string} origin 記録したサイトのオリジン（例：https://www.amazon.co.jp）。
 *   実行時は、このオリジンのページでだけ手順を実行します。
 * @property {Step[]} steps 手順の一覧
 */

/**
 * 値がフロー定義の形式を満たしているかを検証します。
 * 外部から読み込んだ JSON を想定するため、どのような値を受け取っても例外を投げません。
 * @param {unknown} value 検証する値
 * @returns {string[]} 誤りの説明の一覧。空の場合は形式を満たしています。
 */
export function validateFlow(value) {
  if (!isRecord(value)) {
    return ['フロー定義がオブジェクトではありません。'];
  }

  /** @type {string[]} */
  const errors = [];

  if (value.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion が ${SCHEMA_VERSION} ではありません。`);
  }

  if (typeof value.name !== 'string' || value.name.trim() === '') {
    errors.push('name が空か、文字列ではありません。');
  }

  if (typeof value.origin !== 'string' || !isWebOrigin(value.origin)) {
    errors.push('origin が https:// または http:// で始まるオリジンではありません。');
  }

  if (!Array.isArray(value.steps)) {
    errors.push('steps が配列ではありません。');
  } else {
    value.steps.forEach((step, index) => {
      if (!isRecord(step) || typeof step.type !== 'string' || step.type === '') {
        errors.push(`steps[${index}] に手順の種類（type）がありません。`);
      }
    });
  }

  return errors;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * パスなどを含まない、Web ページのオリジンそのものかを判定します。
 * @param {string} value
 * @returns {boolean}
 */
function isWebOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
}
