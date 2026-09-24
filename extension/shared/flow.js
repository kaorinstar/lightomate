// フロー定義（JSON）の型と検証です。形式の説明は docs/flow-format.md にあります。
//
// ES モジュールのため、Service Worker と拡張機能の画面からは読み込めますが、content script からは
// 読み込めません。content script から ES モジュールを読み込むには web_accessible_resources の宣言が
// 必要になり、ページから拡張機能の有無を検出できるようになるためです。検証は Service Worker で行います。

/** 現在のフロー定義の形式の版番号です。形式を変えるときに 1 増やします。 */
export const SCHEMA_VERSION = 1;

/** 1 つのフローに含められる手順の数の上限です。保存領域を使い切ることを防ぎます。 */
export const MAX_STEPS = 1000;

/** 文字列の項目の長さの上限です。 */
export const MAX_TEXT_LENGTH = 2000;

/**
 * 操作した要素を、後で再び見つけるための指定です。
 * @typedef {object} Target
 * @property {string[]} selectors CSS セレクター。優先する順に並べます。1 つ以上あります。
 * @property {string} tag 要素のタグ名（小文字）
 * @property {string} label 人が読むための説明（ボタンの表示文字列など）
 * @property {string} [text] 要素の表示文字列。セレクターで見つからない場合の手がかりに使います。
 */

/**
 * ページの移動です。
 * @typedef {object} NavigateStep
 * @property {'navigate'} type
 * @property {string} url 移動先の URL
 * @property {'user' | 'page'} cause 利用者の操作（URL の入力、再読み込み、戻る）による移動か、
 *   ページの操作（リンク、フォームの送信、転送）による移動か
 */

/**
 * クリックです。
 * @typedef {object} ClickStep
 * @property {'click'} type
 * @property {Target} target
 */

/**
 * 文字の入力です。secret が true の場合、値は記録しません。
 * @typedef {object} InputStep
 * @property {'input'} type
 * @property {Target} target
 * @property {string} [value] 入力した値
 * @property {true} [secret] パスワードなど、値を記録しない入力欄であること
 */

/**
 * 選択肢の選択（select 要素）です。
 * @typedef {object} SelectStep
 * @property {'select'} type
 * @property {Target} target
 * @property {string[]} values 選んだ選択肢の value
 * @property {string[]} labels 選んだ選択肢の表示文字列
 */

/** @typedef {NavigateStep | ClickStep | InputStep | SelectStep} Step */

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
 * フロー定義の項目を、読みやすい順序に並べ直します。
 * chrome.storage は保存した項目を名前の順に並べ替えるため、表示や書き出しの前に使います。
 * @param {Flow} flow
 * @returns {Flow}
 */
export function orderFlow({ schemaVersion, name, origin, steps, ...rest }) {
  return {
    schemaVersion,
    name,
    origin,
    ...rest,
    steps: steps.map(({ type, ...stepRest }) => /** @type {Step} */ ({ type, ...stepRest })),
  };
}

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

  if (!isText(value.name) || value.name.trim() === '') {
    errors.push('name が空か、文字列ではありません。');
  }

  if (typeof value.origin !== 'string' || !isWebOrigin(value.origin)) {
    errors.push('origin が https:// または http:// で始まるオリジンではありません。');
  }

  if (!Array.isArray(value.steps)) {
    errors.push('steps が配列ではありません。');
  } else if (value.steps.length > MAX_STEPS) {
    errors.push(`steps が上限の ${MAX_STEPS} 件を超えています。`);
  } else {
    value.steps.forEach((step, index) => {
      for (const error of validateStep(step)) {
        errors.push(`steps[${index}]: ${error}`);
      }
    });
  }

  return errors;
}

/**
 * 値が 1 つの手順の形式を満たしているかを検証します。
 * @param {unknown} step 検証する値
 * @returns {string[]} 誤りの説明の一覧。空の場合は形式を満たしています。
 */
export function validateStep(step) {
  if (!isRecord(step)) {
    return ['手順がオブジェクトではありません。'];
  }

  switch (step.type) {
    case 'navigate': {
      /** @type {string[]} */
      const errors = [];
      if (!isText(step.url) || !isWebUrl(step.url)) {
        errors.push('url が https:// または http:// で始まる URL ではありません。');
      }
      if (step.cause !== 'user' && step.cause !== 'page') {
        errors.push('cause が user または page ではありません。');
      }
      return errors;
    }

    case 'click':
      return validateTarget(step.target);

    case 'input': {
      const errors = validateTarget(step.target);
      if (step.secret === true) {
        if ('value' in step) {
          errors.push('secret の入力欄に value が記録されています。');
        }
      } else if (step.secret !== undefined) {
        errors.push('secret が true ではありません。');
      } else if (!isText(step.value)) {
        errors.push('value が文字列ではありません。');
      }
      return errors;
    }

    case 'select': {
      const errors = validateTarget(step.target);
      if (!isTextArray(step.values)) {
        errors.push('values が文字列の配列ではありません。');
      }
      if (!isTextArray(step.labels)) {
        errors.push('labels が文字列の配列ではありません。');
      }
      return errors;
    }

    default:
      return ['手順の種類（type）が navigate、click、input、select のいずれでもありません。'];
  }
}

/**
 * @param {unknown} target
 * @returns {string[]}
 */
function validateTarget(target) {
  if (!isRecord(target)) {
    return ['target がオブジェクトではありません。'];
  }

  /** @type {string[]} */
  const errors = [];
  if (
    !isTextArray(target.selectors) ||
    target.selectors.length === 0 ||
    target.selectors.some((selector) => selector === '')
  ) {
    errors.push('target.selectors が、空でない文字列の配列ではありません。');
  }
  if (!isText(target.tag) || target.tag === '') {
    errors.push('target.tag が空か、文字列ではありません。');
  }
  if (!isText(target.label)) {
    errors.push('target.label が文字列ではありません。');
  }
  if (target.text !== undefined && !isText(target.text)) {
    errors.push('target.text が文字列ではありません。');
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
 * 長さの上限を超えない文字列かを判定します。
 * @param {unknown} value
 * @returns {value is string}
 */
function isText(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isTextArray(value) {
  return Array.isArray(value) && value.length <= MAX_STEPS && value.every(isText);
}

/**
 * @param {string} value
 * @returns {URL | null}
 */
function parseWebUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

/**
 * https:// または http:// で始まる URL かを判定します。
 * @param {string} value
 * @returns {boolean}
 */
export function isWebUrl(value) {
  return parseWebUrl(value) !== null;
}

/**
 * パスなどを含まない、Web ページのオリジンそのものかを判定します。
 * @param {string} value
 * @returns {boolean}
 */
export function isWebOrigin(value) {
  return parseWebUrl(value)?.origin === value;
}
