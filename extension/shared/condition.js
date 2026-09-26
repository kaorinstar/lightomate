// if と while の条件のうち、ページの文字と日付による条件を判定します（#103）。chrome.* は使いません。
//
// 条件の要素の表示の文字は、content script が読み取ります（content/runner.js の runner/read）。
// ここでは、読み取った文字が条件を満たすかだけを判定します。
//
// 文字の条件は、Chrome の翻訳で文字が置き換わると結果が逆になり、then と else のどちらを行うかも
// 入れ替わります。どちらの分岐が安全かはフローによって異なるため、ページが翻訳されている場合は判定せずに
// 停止します（CLAUDE.md の翻訳の規則）。日付の条件は、日付として読めた場合だけ判定します。翻訳で表記が
// 変わっても、同じ日付として読めれば結果は変わらないためです。読めない場合は停止します。

/** @typedef {import('./flow.js').Condition} Condition */

/** 条件の種類ごとの項目名です。1 つの条件に、どれか 1 種類だけを書きます。 */
export const CONDITION_KINDS = /** @type {const} */ ({
  exists: ['exists'],
  text: ['contains', 'equals'],
  date: ['month', 'from', 'to'],
});

/** 年月（YYYY-MM）の形式です。 */
export const MONTH_VALUE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 年月日（YYYY-MM-DD）の形式です。 */
export const DATE_VALUE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 英語の月名と、その月の番号です。略記も含めます。 */
const MONTH_NAMES = /** @type {Record<string, number>} */ ({
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

const MONTH_NAME = `(${Object.keys(MONTH_NAMES).join('|')})\\.?`;

/**
 * 読み取る日付の表記です。年・月・日の並びが一意に決まる表記に限ります。
 * 数字の前後に別の数字が続く場合は一致させません（例：12026/9/1 の 2026/9/1）。
 * @type {{ pattern: RegExp, parts: (match: RegExpExecArray) => [string, string, string] }[]}
 */
const DATE_FORMATS = [
  // 2026年9月1日
  {
    pattern: /(?<!\d)(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
    parts: (m) => [m[1], m[2], m[3]],
  },
  // 2026/9/1、2026-09-01、2026.9.1（区切りの文字は同じものに限ります）
  {
    pattern: /(?<!\d)(\d{4})([/.-])(\d{1,2})\2(\d{1,2})(?!\d)/g,
    parts: (m) => [m[1], m[3], m[4]],
  },
  // September 1, 2026、Sep 1, 2026
  {
    pattern: new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)`, 'gi'),
    parts: (m) => [m[3], String(MONTH_NAMES[m[1].toLowerCase()]), m[2]],
  },
  // 1 September 2026
  {
    pattern: new RegExp(`(?<!\\d)(\\d{1,2})\\s+${MONTH_NAME}\\s+(\\d{4})(?!\\d)`, 'gi'),
    parts: (m) => [m[3], String(MONTH_NAMES[m[2].toLowerCase()]), m[1]],
  },
];

/** 月と日の順序が決まらない表記です（例：9/1/2026、01.09.2026）。読まずに停止します。 */
const AMBIGUOUS_DATE = /(?<!\d)\d{1,2}[/.-]\d{1,2}[/.-]\d{4}(?!\d)/;

/**
 * 条件の種類を返します。形式の検証（flow.js）を通った条件を前提とします。
 * @param {Condition} condition
 * @returns {'exists' | 'text' | 'date'}
 */
export function conditionKind(condition) {
  if ('contains' in condition || 'equals' in condition) {
    return 'text';
  }
  if ('month' in condition || 'from' in condition || 'to' in condition) {
    return 'date';
  }
  return 'exists';
}

/**
 * 条件を、人が読む形にします（例：「注文日」が 2026-09 の日付の場合）。
 * @param {Condition} condition
 * @returns {string}
 */
export function describeCondition(condition) {
  const label = `「${condition.target.label}」`;
  if ('contains' in condition) {
    return `${label}が「${condition.contains}」を含む場合`;
  }
  if ('equals' in condition) {
    return `${label}が「${condition.equals}」の場合`;
  }
  if ('month' in condition) {
    return `${label}が ${condition.month} の日付の場合`;
  }
  if ('from' in condition || 'to' in condition) {
    const from = 'from' in condition ? condition.from : '';
    const to = 'to' in condition ? condition.to : '';
    return `${label}が ${from}〜${to} の日付の場合`;
  }
  return `${label}が${condition.exists ? 'ある' : 'ない'}場合`;
}

/**
 * 文字を、比べるための形にします。前後の空白を除き、続く空白を 1 つにします。
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 日付として正しいかを確かめ、YYYY-MM-DD の形にします。正しくない場合は undefined です。
 * @param {string} year
 * @param {string} month
 * @param {string} day
 * @returns {string | undefined}
 */
function toIsoDate(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return undefined;
  }
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 文字から日付を 1 つ読み取ります。
 * - 日付が 1 つもない場合、異なる日付が 2 つ以上ある場合、月と日の順序が決まらない表記がある場合、
 *   存在しない日付（2026年2月30日など）がある場合は、読み取れなかった理由を返します。
 * - 同じ日付が複数回書かれている場合は、1 つとして扱います。
 * @param {string} text
 * @returns {{ ok: true, date: string } | { ok: false, error: string }}
 */
export function parseDate(text) {
  /** @type {Set<string>} */
  const dates = new Set();
  let remaining = text;
  for (const { pattern, parts } of DATE_FORMATS) {
    for (const match of text.matchAll(pattern)) {
      const [year, month, day] = parts(match);
      const date = toIsoDate(year, month, day);
      if (date === undefined) {
        return { ok: false, error: `「${match[0]}」は、存在しない日付です。` };
      }
      dates.add(date);
      remaining = remaining.replace(match[0], ' ');
    }
  }
  const ambiguous = AMBIGUOUS_DATE.exec(remaining);
  if (ambiguous) {
    return {
      ok: false,
      error: `「${ambiguous[0]}」は、月と日の順序が決まらない表記のため、日付として読み取れません。`,
    };
  }
  if (dates.size === 0) {
    return { ok: false, error: '日付が見つかりません。' };
  }
  if (dates.size > 1) {
    return {
      ok: false,
      error: `日付が ${dates.size} つあり（${[...dates].join('、')}）、どれを使うか決められません。`,
    };
  }
  return { ok: true, date: [...dates][0] };
}

/**
 * 条件の要素から読み取った文字が、条件を満たすかを判定します。exists の条件には使いません。
 * 判定できない場合（ページが翻訳されている文字の条件、日付を読み取れない日付の条件、パラメータを
 * 当てはめた値の形式の誤り）は、停止する理由を返します。
 * @param {Condition} condition パラメータを当てはめた条件
 * @param {string} text 条件の要素の表示の文字
 * @param {boolean} translated ページが Chrome の翻訳で表示されているか
 * @returns {{ ok: true, met: boolean } | { ok: false, error: string }}
 */
export function evaluateCondition(condition, text, translated) {
  const label = `「${condition.target.label}」`;
  if ('contains' in condition || 'equals' in condition) {
    if (translated) {
      return {
        ok: false,
        error:
          `${label}の文字の条件は、ページが Chrome の翻訳で表示されているため判定できません。` +
          '翻訳で文字が変わると、条件の結果が変わるためです。翻訳をやめて原文の表示に戻してから、実行し直してください。',
      };
    }
    const actual = normalize(text);
    if ('contains' in condition) {
      return { ok: true, met: actual.includes(normalize(condition.contains)) };
    }
    return { ok: true, met: actual === normalize(condition.equals) };
  }

  const parsed = parseDate(text);
  if (!parsed.ok) {
    return {
      ok: false,
      error: `${label}から日付を読み取れないため、停止しました。${parsed.error}`,
    };
  }
  if ('month' in condition) {
    if (!MONTH_VALUE_PATTERN.test(condition.month)) {
      return {
        ok: false,
        error: `条件の月（${condition.month}）が、2026-09 の形式ではありません。`,
      };
    }
    return { ok: true, met: parsed.date.startsWith(`${condition.month}-`) };
  }
  const from = 'from' in condition ? condition.from : undefined;
  const to = 'to' in condition ? condition.to : undefined;
  for (const value of [from, to]) {
    if (value !== undefined && !isDateValue(value)) {
      return {
        ok: false,
        error: `条件の日付（${value}）が、2026-09-01 の形式の正しい日付ではありません。`,
      };
    }
  }
  return {
    ok: true,
    met: (from === undefined || parsed.date >= from) && (to === undefined || parsed.date <= to),
  };
}

/**
 * YYYY-MM-DD の形式の、存在する日付かを判定します。
 * @param {string} value
 * @returns {boolean}
 */
export function isDateValue(value) {
  const match = DATE_VALUE_PATTERN.exec(value);
  return match !== null && toIsoDate(match[1], match[2], match[3]) === value;
}
