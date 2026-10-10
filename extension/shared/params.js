// パラメータ（実行のたびに変わる値）の処理です。
//
// 手順の値の中に {{名前}} と書くと、実行時に入力した値に置き換えます。
// 年月の種類のパラメータでは、{{名前.year}}（年）、{{名前.month}}（月、先頭にゼロを付けない）、
// {{名前.mm}}（月、2 桁）も使えます。日付の種類のパラメータでは、さらに {{名前.day}}（日、先頭にゼロを
// 付けない）と {{名前.dd}}（日、2 桁）も使えます（#219）。

/** パラメータの種類です。 */
export const PARAM_TYPES = /** @type {const} */ (['text', 'number', 'select', 'month', 'date']);

/** 年月の種類で使える、実行した日から決まる既定値です。 */
export const RELATIVE_MONTHS = /** @type {const} */ ([
  '@current-month',
  '@previous-month',
  '@month-before-last',
]);

/** 実行した日の月から何か月前かです。前々月（#163）は、領収書の発行が遅いサイトで使います。 */
const RELATIVE_MONTH_OFFSETS = {
  '@current-month': 0,
  '@previous-month': -1,
  '@month-before-last': -2,
};

/**
 * 日付の種類で使える、実行した日から決まる既定値です（#219）。
 * 前月 1 日〜前月末日は、領収書などを前月分まとめて取得する場合の期間です。
 */
export const RELATIVE_DATES = /** @type {const} */ ([
  '@today',
  '@first-of-current-month',
  '@first-of-previous-month',
  '@end-of-previous-month',
]);

/**
 * 日付の既定値ごとに、実行した日から日付を計算する関数です。
 * new Date の日に 0 を渡すと、前の月の末日になります。
 * @type {Record<string, (now: Date) => Date>}
 */
const RELATIVE_DATE_RULES = {
  '@today': (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  '@first-of-current-month': (now) => new Date(now.getFullYear(), now.getMonth(), 1),
  '@first-of-previous-month': (now) => new Date(now.getFullYear(), now.getMonth() - 1, 1),
  '@end-of-previous-month': (now) => new Date(now.getFullYear(), now.getMonth(), 0),
};

/** パラメータ名に使える文字です。英字または _ で始め、英数字と _ だけを使います。 */
export const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 年月の値の形式です（例：2026-08）。 */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 日付の値の形式です（例：2026-08-06）。存在しない日付（2 月 30 日など）は isDate で除きます。 */
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 数値の形式です。 */
const NUMBER_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * パラメータの定義です。
 * @typedef {object} Param
 * @property {string} name 名前。手順の中では {{名前}} と書きます。
 * @property {string} label 入力フォームに表示する説明
 * @property {'text' | 'number' | 'select' | 'month' | 'date'} type 種類
 * @property {string} [default] 既定値。年月では「@current-month」（今月）、「@previous-month」（前月）、
 *   「@month-before-last」（前々月、#163）も使えます。日付では「@today」（今日）、「@first-of-current-month」
 *   （今月 1 日）、「@first-of-previous-month」（前月 1 日）、「@end-of-previous-month」（前月末日）も使えます
 *   （#219）。
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
    } else if (part !== undefined && !(PARTS[param.type] ?? []).includes(part)) {
      errors.push(
        `「${name}.${part}」は使えません。.year、.month、.mm は年月と日付のパラメータで、.day、.dd は日付の` +
          'パラメータでだけ使えます。',
      );
    }
  }
  return errors;
}

/**
 * 種類ごとの、{{名前.部分}} で使える部分です。
 * @type {Record<string, string[]>}
 */
const PARTS = {
  month: ['year', 'month', 'mm'],
  date: ['year', 'month', 'mm', 'day', 'dd'],
};

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
    const { value, error } = resolveParam(param, input[param.name], now);
    if (error) {
      errors.push(`${param.label}：${error}`);
      continue;
    }

    values[param.name] = value;
    const parts =
      param.type === 'month'
        ? MONTH_PATTERN.exec(value)
        : param.type === 'date'
          ? DATE_PATTERN.exec(value)
          : null;
    if (parts) {
      values[`${param.name}.year`] = parts[1];
      values[`${param.name}.month`] = String(Number(parts[2]));
      values[`${param.name}.mm`] = parts[2];
      if (parts[3] !== undefined) {
        values[`${param.name}.day`] = String(Number(parts[3]));
        values[`${param.name}.dd`] = parts[3];
      }
    }
  }
  return { values, errors };
}

/**
 * 入力フォームの値を検証し、誤りのある欄の名前と誤りの説明を返します。
 * 画面で、誤りを入力欄ごとに、その欄の直下に表示するために使います。
 * 検証の内容は resolveParams と同じです。
 * @param {Param[]} params
 * @param {Record<string, string>} input 入力フォームの値
 * @param {Date} now
 * @returns {Record<string, string>} キーはパラメータの名前。誤りがない場合は空のオブジェクト
 */
export function paramFieldErrors(params, input, now) {
  /** @type {Record<string, string>} */
  const errors = {};
  for (const param of params) {
    const { error } = resolveParam(param, input[param.name], now);
    if (error) {
      errors[param.name] = error;
    }
  }
  return errors;
}

/**
 * 1 つのパラメータの入力を、実行に使う値にします。空の場合は既定値を使います。
 * @param {Param} param
 * @param {string | undefined} raw 入力フォームの値
 * @param {Date} now
 * @returns {{ value: string, error: string | null }}
 */
function resolveParam(param, raw, now) {
  let value = (raw ?? '').trim();
  if (value === '' && param.default !== undefined) {
    value = defaultValue(param, now);
  }
  const error = value === '' ? '値を入力してください。' : checkValue(param, value, false);
  return { value, error };
}

/**
 * 既定値を、実際の値にします。前月などは、実行した日時から計算します。
 * @param {Param} param
 * @param {Date} now
 * @returns {string}
 */
export function defaultValue(param, now) {
  const offset = /** @type {Record<string, number | undefined>} */ (RELATIVE_MONTH_OFFSETS)[
    param.default ?? ''
  ];
  if (offset !== undefined) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  const rule = RELATIVE_DATE_RULES[param.default ?? ''];
  if (param.type === 'date' && rule) {
    const date = rule(now);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  }
  return param.default ?? '';
}

/**
 * 日付の値（例：2026-08-06）が、形式に合い、実在する日付かを返します。
 * @param {string} value
 * @returns {boolean}
 */
function isDate(value) {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return false;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * 値が種類に合っているかを確認します。
 * @param {{ type: string, options?: unknown }} param
 * @param {string} value
 * @param {boolean} isDefault 既定値の検証か。既定値では @previous-month、@today などを受け付けます。
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
    case 'date':
      if (isDefault && /** @type {readonly string[]} */ (RELATIVE_DATES).includes(value)) {
        return null;
      }
      return isDate(value) ? null : '日付は 2026-08-06 の形式で、実在する日付を指定してください。';
    default:
      return null;
  }
}
