// パラメータ（実行のたびに変わる値）の処理です。
//
// 手順の値の中に {{名前}} と書くと、実行時に入力した値に置き換えます。
// 年月の種類のパラメータでは、{{名前.year}}（年）、{{名前.month}}（月、先頭にゼロを付けない）、
// {{名前.mm}}（月、2 桁）も使えます。

/** パラメータの種類です。 */
export const PARAM_TYPES = /** @type {const} */ (['text', 'number', 'select', 'month']);

/** 年月の種類で使える、実行した日から決まる既定値です。 */
export const RELATIVE_MONTHS = /** @type {const} */ (['@current-month', '@previous-month']);

/** パラメータ名に使える文字です。英字または _ で始め、英数字と _ だけを使います。 */
export const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 年月の値の形式です（例：2026-08）。 */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 数値の形式です。 */
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * パラメータの定義です。
 * @typedef {object} Param
 * @property {string} name 名前。手順の中では {{名前}} と書きます。
 * @property {string} label 入力フォームに表示する説明
 * @property {'text' | 'number' | 'select' | 'month'} type 種類
 * @property {string} [default] 既定値。年月では「@current-month」（今月）と「@previous-month」（前月）も使えます。
 * @property {string[]} [options] 選択肢（種類が select の場合に必須）
 */

/**
 * {{名前}} と {{名前.部分}} を見つける正規表現を作ります。
 * g フラグを持つ正規表現は検索の位置を記憶するため、使うたびに作り直します。
 * @returns {RegExp}
 */
function referencePattern() {
  return /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z]+))?\s*\}\}/g;
}

/**
 * 文字列の中のパラメータの参照を列挙します。
 * @param {string} text
 * @returns {{ name: string, part: string | undefined }[]}
 */
export function findReferences(text) {
  return Array.from(text.matchAll(referencePattern()), (match) => ({
    name: match[1],
    part: match[2],
  }));
}

/**
 * 文字列の中の参照を、値に置き換えます。
 * @param {string} text
 * @param {Record<string, string>} values resolveParams で作った値
 * @returns {string}
 */
export function renderTemplate(text, values) {
  return text.replace(referencePattern(), (whole, name, part) => {
    const key = part ? `${name}.${part}` : name;
    return Object.hasOwn(values, key) ? values[key] : whole;
  });
}

/**
 * 参照を仮の値に置き換えます。URL の形式を検証する前に使います。
 * @param {string} text
 * @returns {string}
 */
export function withPlaceholders(text) {
  return text.replace(referencePattern(), 'x');
}

/**
 * パラメータの定義が正しいかを検証します。
 * @param {unknown} params
 * @returns {string[]} 誤りの説明の一覧
 */
export function validateParams(params) {
  if (params === undefined) {
    return [];
  }
  if (!Array.isArray(params)) {
    return ['params が配列ではありません。'];
  }

  /** @type {string[]} */
  const errors = [];
  const names = new Set();
  params.forEach((param, index) => {
    const where = `params[${index}]`;
    if (typeof param !== 'object' || param === null || Array.isArray(param)) {
      errors.push(`${where} がオブジェクトではありません。`);
      return;
    }
    if (typeof param.name !== 'string' || !PARAM_NAME_PATTERN.test(param.name)) {
      errors.push(`${where}.name は、英字または _ で始まる英数字と _ だけの名前にしてください。`);
    } else if (names.has(param.name)) {
      errors.push(`${where}.name の「${param.name}」が重複しています。`);
    } else {
      names.add(param.name);
    }
    if (typeof param.label !== 'string' || param.label.trim() === '') {
      errors.push(`${where}.label が空か、文字列ではありません。`);
    }
    if (!PARAM_TYPES.includes(param.type)) {
      errors.push(`${where}.type は ${PARAM_TYPES.join('、')} のいずれかにしてください。`);
      return;
    }
    if (param.type === 'select') {
      if (
        !Array.isArray(param.options) ||
        param.options.length === 0 ||
        !param.options.every((/** @type {unknown} */ option) => typeof option === 'string')
      ) {
        errors.push(`${where}.options に、選択肢の文字列を 1 つ以上指定してください。`);
      }
    }
    if (param.default !== undefined) {
      const error =
        typeof param.default === 'string'
          ? checkValue(param, param.default, true)
          : '既定値が文字列ではありません。';
      if (error) {
        errors.push(`${where}.default: ${error}`);
      }
    }
  });
  return errors;
}

/**
 * 参照の名前と部分が、定義されたパラメータに対応しているかを検証します。
 * @param {string} text
 * @param {Param[]} params
 * @returns {string[]} 誤りの説明の一覧
 */
export function validateReferences(text, params) {
  /** @type {string[]} */
  const errors = [];
  for (const { name, part } of findReferences(text)) {
    const param = params.find((candidate) => candidate.name === name);
    if (!param) {
      errors.push(`定義されていないパラメータ「${name}」を参照しています。`);
    } else if (part !== undefined && (param.type !== 'month' || !MONTH_PARTS.includes(part))) {
      errors.push(
        `「${name}.${part}」は使えません。.year、.month、.mm は年月のパラメータでだけ使えます。`,
      );
    }
  }
  return errors;
}

const MONTH_PARTS = ['year', 'month', 'mm'];

/**
 * 入力された値を検証し、手順に当てはめる値を作ります。
 * 入力が空の場合は既定値を使います。
 * @param {Param[]} params
 * @param {Record<string, string>} input 入力フォームの値
 * @param {Date} now 実行した日時。前月などの既定値の計算に使います。
 * @returns {{ values: Record<string, string>, errors: string[] }}
 */
export function resolveParams(params, input, now) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string[]} */
  const errors = [];

  for (const param of params) {
    let value = (input[param.name] ?? '').trim();
    if (value === '' && param.default !== undefined) {
      value = defaultValue(param, now);
    }
    const error = value === '' ? '値を入力してください。' : checkValue(param, value, false);
    if (error) {
      errors.push(`${param.label}：${error}`);
      continue;
    }

    values[param.name] = value;
    const month = MONTH_PATTERN.exec(value);
    if (param.type === 'month' && month) {
      values[`${param.name}.year`] = month[1];
      values[`${param.name}.month`] = String(Number(month[2]));
      values[`${param.name}.mm`] = month[2];
    }
  }
  return { values, errors };
}

/**
 * 既定値を、実際の値にします。前月などは、実行した日時から計算します。
 * @param {Param} param
 * @param {Date} now
 * @returns {string}
 */
export function defaultValue(param, now) {
  if (param.default === '@current-month' || param.default === '@previous-month') {
    const offset = param.default === '@previous-month' ? -1 : 0;
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  return param.default ?? '';
}

/**
 * 値が種類に合っているかを確認します。
 * @param {{ type: string, options?: unknown }} param
 * @param {string} value
 * @param {boolean} isDefault 既定値の検証か。既定値では @previous-month などを受け付けます。
 * @returns {string | null} 誤りの説明。正しい場合は null
 */
function checkValue(param, value, isDefault) {
  switch (param.type) {
    case 'number':
      return NUMBER_PATTERN.test(value) ? null : '数値ではありません。';
    case 'select':
      return Array.isArray(param.options) && param.options.includes(value)
        ? null
        : '選択肢にない値です。';
    case 'month':
      if (isDefault && /** @type {readonly string[]} */ (RELATIVE_MONTHS).includes(value)) {
        return null;
      }
      return MONTH_PATTERN.test(value) ? null : '年月は 2026-08 の形式で指定してください。';
    default:
      return null;
  }
}
