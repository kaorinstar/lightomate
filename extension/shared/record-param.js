// 記録した選択と入力の値を、実行するたびに変える値（パラメータ）にします（#286）。
//
// 利用者が選ぶのは、その欄の既定値だけです。月の欄では「前月」「今月」、日の欄では「1 日」「末日」「今日」を選びます。
// パラメータの名前、表示名、種類、月と日をどの日付にまとめるか、年・月・日のどれかは、記録した手順から決めます。
// 管理画面で値の定義を作り、JSON の値を {{名前.部分}} に書き換える作業を、記録中のボタン 1 つで行うためです。
//
// 日付のパラメータの既定値（前月 1 日、前月末日、今月 1 日、今日）は、月の側（前月か今月か）と日の側（1 日、
// 末日、今日）の組み合わせです。前月 1 日と前月末日は、年と月が同じです。そこで、月の欄は「前月の日付」か
// 「今月の日付」かだけを決め、日の欄で既定値を確定します。
// - 月（年）の欄：同じ側の日付のうち、まだ月（年）を使っていない最初のものにまとめます。なければ加えます。
// - 日の欄：まだ日を使っていない最初の日付にまとめ、その日付の既定値を、側と選んだ日の組み合わせにします。
//   なければ加えます。
// 年・月・日の判定には要素の表示名を使います。翻訳で表示名が変わっても、誤りは「判定できずに利用者に選んで
// もらう」側か、記録した値との食い違いで選択を求める側に寄せます（CLAUDE.md）。

import { flattenSteps } from './control-flow.js';
import { defaultValue as resolveDefault, findReferences } from './params.js';

/** @typedef {import('./flow.js').Step} Step */
/** @typedef {import('./params.js').Param} Param */

/** 日付の部分です。 */
export const DATE_PARTS = /** @type {const} */ (['year', 'month', 'day']);

/** @typedef {typeof DATE_PARTS[number]} DatePart */

/** 日付の部分の、画面に出す名前です。 */
export const DATE_PART_LABELS = { year: '年', month: '月', day: '日' };

/**
 * 日付の側です。prev は前月の日付（前月 1 日、前月末日）、current は今月の日付（今月 1 日、今日）です。
 * @typedef {'prev' | 'current'} DateSide
 */

/**
 * 日の欄で選ぶ値です。first は 1 日、end は末日、today は今日です。
 * @typedef {'first' | 'end' | 'today'} DayChoice
 */

/**
 * 側と日の組み合わせごとの、日付のパラメータの既定値です。前月の今日と、今月の末日は、既定値にありません。
 * @type {Record<DateSide, Partial<Record<DayChoice, string>>>}
 */
const DEFAULTS = {
  prev: { first: '@first-of-previous-month', end: '@end-of-previous-month' },
  current: { first: '@first-of-current-month', today: '@today' },
};

/**
 * 既定値から側を返します。日付の既定値でない場合は null です。
 * @param {string | undefined} value
 * @returns {DateSide | null}
 */
function sideOf(value) {
  for (const side of /** @type {DateSide[]} */ (['prev', 'current'])) {
    if (Object.values(DEFAULTS[side]).includes(value ?? '')) {
      return side;
    }
  }
  return null;
}

/**
 * 実行するたびに変える値にできる手順の種類です。
 * date は日付の年・月・日（選択）、text は文字（入力）です。part が null の場合は、年・月・日のどれかを
 * 利用者に選んでもらいます。
 * @typedef {{ kind: 'date', part: DatePart | null } | { kind: 'text' }} ParamTarget
 */

/**
 * 値が {{名前}} を含むかを返します。
 * @param {string} text
 * @returns {boolean}
 */
function hasReference(text) {
  return findReferences(text).length > 0;
}

/**
 * 選択の手順の、数として読める記録値を返します。value を優先し、数でなければ表示文字列を使います。
 * 実行では、当てはめた値を value、表示文字列の順に照合するため、どちらか一方が数であれば選べます。
 * @param {import('./flow.js').SelectStep} step
 * @returns {string | null}
 */
function numericValue(step) {
  for (const text of [step.values[0], step.labels[0]]) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (/^\d{1,4}$/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * 記録した値が、日付の部分として取りうる値かを返します。
 * @param {DatePart} part
 * @param {string} value
 * @returns {boolean}
 */
function fitsPart(part, value) {
  const number = Number(value);
  if (part === 'year') {
    return value.length === 4 && number >= 1900;
  }
  if (part === 'month') {
    return value.length <= 2 && number >= 1 && number <= 12;
  }
  return value.length <= 2 && number >= 1 && number <= 31;
}

/**
 * 要素の表示名から、日付の部分を読み取ります。「年」「月」「日」のうち、最後に現れたものを使います。
 * 例：「開始の月」は月、「開始日」は日です。
 * @param {string} label
 * @returns {DatePart | null}
 */
function partFromLabel(label) {
  const match = /(年|月|日)[^年月日]*$/.exec(label);
  if (!match) {
    return null;
  }
  return match[1] === '年' ? 'year' : match[1] === '月' ? 'month' : 'day';
}

/**
 * 記録した値だけから、日付の部分を決めます。4 桁は年、13〜31 は日です。1〜12 は月か日か決まりません。
 * @param {string} value
 * @returns {DatePart | null}
 */
function partFromValue(value) {
  if (fitsPart('year', value)) {
    return 'year';
  }
  const number = Number(value);
  return value.length <= 2 && number >= 13 && number <= 31 ? 'day' : null;
}

/**
 * 手順を、実行するたびに変える値にできるかを返します。できない場合は null です。
 * 選択は、1 つだけ選び、数として読める値（月の 09 など）を記録した手順が対象です。入力は、値を記録した手順が
 * 対象です。パスワードなど値を記録しない入力欄と、すでに {{名前}} を含む手順は対象外です。
 * @param {Step} step
 * @returns {ParamTarget | null}
 */
export function paramTarget(step) {
  if (step.type === 'input') {
    if (step.secret || typeof step.value !== 'string' || hasReference(step.value)) {
      return null;
    }
    return { kind: 'text' };
  }
  if (step.type !== 'select' || step.values.length !== 1) {
    return null;
  }
  if (step.values.some(hasReference)) {
    return null;
  }
  const value = numericValue(step);
  if (value === null) {
    return null;
  }
  const fromLabel = partFromLabel(step.target.label ?? '');
  if (fromLabel && fitsPart(fromLabel, value)) {
    return { kind: 'date', part: fromLabel };
  }
  return { kind: 'date', part: partFromValue(value) };
}

/**
 * 手順の中で使っている名前（パラメータの参照と、読み取り extract の名前）を集めます。
 * @param {Step[]} steps
 * @returns {Set<string>}
 */
function usedNames(steps) {
  const names = new Set(findReferences(JSON.stringify(steps)).map(({ name }) => name));
  for (const { step } of flattenSteps(steps)) {
    if (step.type === 'extract') {
      names.add(step.name);
    }
  }
  return names;
}

/**
 * 使われていない名前を、prefix1、prefix2 … の順に探します。
 * @param {string} prefix
 * @param {Param[]} params
 * @param {Step[]} steps
 * @returns {string}
 */
function freeName(prefix, params, steps) {
  const taken = new Set([...params.map((param) => param.name), ...usedNames(steps)]);
  for (let number = 1; ; number += 1) {
    if (!taken.has(`${prefix}${number}`)) {
      return `${prefix}${number}`;
    }
  }
}

/**
 * 日付の表示名を決めます。要素の表示名から末尾の「年」「月」「日」を除いて「の日付」を付けます
 * （例：「開始の月」→「開始の日付」）。残る文字がない場合（表示名が「月」だけなど）は、既定値から
 * 「開始日」「終了日」「日付」とします。ほかのパラメータと重なる場合は、末尾に番号を付けます。
 * @param {string} label 要素の表示名
 * @param {string} defaultValue 選んだ既定値
 * @param {Param[]} params
 * @returns {string}
 */
function dateLabel(label, defaultValue, params) {
  const rest = label
    .trim()
    .replace(/(\s*の?\s*[年月日])+$/, '')
    .trim();
  let base;
  if (rest) {
    base = /日付$/.test(rest) ? rest : `${rest}の日付`;
  } else if (defaultValue === '@end-of-previous-month') {
    base = '終了日';
  } else if (defaultValue === '@today') {
    base = '日付';
  } else {
    base = '開始日';
  }
  const labels = new Set(params.map((param) => param.label));
  if (!labels.has(base)) {
    return base;
  }
  for (let number = 2; ; number += 1) {
    if (!labels.has(`${base} ${number}`)) {
      return `${base} ${number}`;
    }
  }
}

/**
 * 記録した値の形から、参照の部分の名前を決めます。月と日は、記録した値が 1 桁（9 など）なら先頭に 0 を
 * 付けない形（month、day）、それ以外（09、10 など）は 2 桁の形（mm、dd）にします。10 以上の値では
 * どちらか決まらないため、2 桁の形にします。
 * @param {DatePart} part
 * @param {string} value
 * @returns {string}
 */
function referencePart(part, value) {
  if (part === 'year') {
    return 'year';
  }
  const short = value.length === 1;
  if (part === 'month') {
    return short ? 'month' : 'mm';
  }
  return short ? 'day' : 'dd';
}

/** 参照の部分ごとの、日付の部分です。 */
const PART_OF_REFERENCE = /** @type {Record<string, DatePart>} */ ({
  year: 'year',
  month: 'month',
  mm: 'month',
  day: 'day',
  dd: 'day',
});

/**
 * 日付のパラメータのうち、手順がまだその部分を使っていないものを返します。並びはパラメータの順です。
 * @param {Step[]} steps
 * @param {Param[]} params
 * @param {DatePart} part
 * @returns {Param[]}
 */
function datesWithout(steps, params, part) {
  const used = findReferences(JSON.stringify(steps));
  return params.filter(
    (param) =>
      param.type === 'date' &&
      sideOf(param.default) !== null &&
      !used.some(
        (item) => item.name === param.name && item.part && PART_OF_REFERENCE[item.part] === part,
      ),
  );
}

/**
 * 日の欄をまとめる日付です。まだ日を使っていない最初の日付で、ない場合は null です。
 * @param {Step[]} steps
 * @param {Param[]} params
 * @returns {Param | null}
 */
function dayPartner(steps, params) {
  return datesWithout(steps, params, 'day')[0] ?? null;
}

/**
 * 欄の選ぶ欄に出す選択肢です。
 * @typedef {object} ValueOption
 * @property {string} value 送る値（月・年の欄は prev か current、日の欄は first、end、today）
 * @property {string} label 画面に出す名前（例：前月（9 月）、末日（30 日））
 * @property {string} fieldValue 今日実行した場合に、この欄に当てはめる値（例：09）
 * @property {boolean} selected 最初に選んでおく選択肢か
 */

/**
 * 日付を計算します。
 * @param {string} value 既定値
 * @param {Date} now
 * @returns {string[]} 年、月、日（どれも先頭に 0 を付けた文字）
 */
function dateOf(value, now) {
  return resolveDefault({ name: 'x', label: 'x', type: 'date', default: value }, now).split('-');
}

/**
 * 欄の選択肢を、この欄に当てはめる値とともに返します（#286）。
 * 月の欄には月だけ、日の欄には日だけを出します。日付全体（前月 1 日など）を出すと、月の欄で日を選ぶように見えるためです。
 * 日の欄では、まとめる日付が前月の側なら「1 日」「末日」、今月の側なら「1 日」「今日」だけを出します。
 * 最初は、記録した値と当てはめる値が一致する選択肢を選んでおきます。ない場合は先頭です。
 * @param {Step[]} steps
 * @param {Param[]} params
 * @param {number} index 対象の手順の番号
 * @param {DatePart} part 日付の部分
 * @param {Date} now 今日として計算に使う日時
 * @returns {ValueOption[]}
 */
export function valueOptions(steps, params, index, part, now) {
  const step = steps[index];
  const recorded = step?.type === 'select' ? numericValue(step) : null;
  const reference = referencePart(part, recorded ?? '00');
  /** @param {string[]} date */
  const pick = ([year, month, day]) =>
    ({ year, mm: month, month: String(Number(month)), dd: day, day: String(Number(day)) })[
      reference
    ] ?? '';

  /** @type {{ value: string, label: string, fieldValue: string }[]} */
  let options;
  if (part === 'day') {
    const partner = dayPartner(steps, params);
    const side = sideOf(partner?.default);
    /** @type {[DayChoice, string][]} */
    const days = [
      ['first', '1 日'],
      ['end', '末日'],
      ['today', '今日'],
    ];
    options = days
      .filter(([day]) => !side || DEFAULTS[side][day])
      .map(([day, name]) => {
        const value = DEFAULTS[side ?? (day === 'today' ? 'current' : 'prev')][day] ?? '';
        const fieldValue = pick(dateOf(value, now));
        return {
          value: day,
          label: day === 'first' ? name : `${name}（${Number(fieldValue)} 日）`,
          fieldValue,
        };
      });
  } else {
    options = /** @type {[DateSide, string][]} */ ([
      ['prev', part === 'year' ? '前月の年' : '前月'],
      ['current', part === 'year' ? '今年' : '今月'],
    ]).map(([side, name]) => {
      const fieldValue = pick(dateOf(DEFAULTS[side].first ?? '', now));
      const shown = part === 'year' ? `${fieldValue} 年` : `${Number(fieldValue)} 月`;
      return { value: side, label: `${name}（${shown}）`, fieldValue };
    });
  }
  const match = options.find(
    (option) => recorded !== null && Number(option.fieldValue) === Number(recorded),
  );
  const chosen = match ?? options[0];
  return options.map((option) => ({ ...option, selected: option === chosen }));
}

/**
 * 日付のパラメータの表示名を、既定値と、使っている手順の要素の表示名から付け直します。
 * 日の欄で既定値が変わると、「開始日」が「終了日」になる場合があるためです。名前が date で始まるもの
 * （この処理で加えたもの）だけを対象にします。
 * @param {Step[]} steps
 * @param {Param[]} params
 * @returns {Param[]}
 */
function relabelDates(steps, params) {
  const refs = flattenSteps(steps).flatMap(({ step }) =>
    step.type === 'select'
      ? findReferences(step.values.join(' ')).map(({ name }) => ({
          name,
          label: step.target.label,
        }))
      : [],
  );
  /** @type {Param[]} */
  const done = [];
  for (const param of params) {
    if (param.type === 'date' && /^date\d+$/.test(param.name) && param.default) {
      const label = refs.find((ref) => ref.name === param.name)?.label ?? '';
      done.push({ ...param, label: dateLabel(label, param.default, done) });
    } else {
      done.push(param);
    }
  }
  return done;
}

/**
 * 手順の値を、実行するたびに変える値にします。
 * 日付では、ファイルの先頭の説明のとおりに日付へまとめます。文字では、記録した文字を既定値とする文字の
 * パラメータを加えます。
 * @param {Step[]} steps 記録した手順（入れ子の外側の一覧）
 * @param {Param[]} params 今のパラメータ
 * @param {unknown} index 対象の手順の番号（0 から数えます）
 * @param {{ value?: unknown, part?: unknown }} choice 選んだ値（月・年の欄は prev か current、日の欄は first、end、
 *   today）と、表示名から決まらない場合の部分
 * @returns {{ ok: true, steps: Step[], params: Param[], label: string } | { ok: false, error: string }}
 */
export function makeRecordedParam(steps, params, index, choice) {
  if (typeof index !== 'number' || !Number.isInteger(index) || !steps[index]) {
    return { ok: false, error: '対象の手順が見つかりません。' };
  }
  const step = steps[index];
  const target = paramTarget(step);
  if (!target) {
    return { ok: false, error: 'この手順は、実行するたびに変える値にできません。' };
  }

  if (target.kind === 'text' && step.type === 'input') {
    const name = freeName('text', params, steps);
    const value = step.value ?? '';
    const label = step.target.label?.trim() || `文字 ${name.slice(4)}`;
    /** @type {Param} */
    const param = { name, label, type: 'text', ...(value ? { default: value } : {}) };
    const next = steps.slice();
    next[index] = { ...step, value: `{{${name}}}` };
    return { ok: true, steps: next, params: [...params, param], label };
  }

  if (target.kind !== 'date' || step.type !== 'select') {
    return { ok: false, error: 'この手順は、実行するたびに変える値にできません。' };
  }
  const part =
    target.part ??
    (DATE_PARTS.includes(/** @type {DatePart} */ (choice.part))
      ? /** @type {DatePart} */ (choice.part)
      : null);
  if (!part) {
    return { ok: false, error: '年・月・日のどれかを選んでください。' };
  }
  const value = /** @type {string} */ (numericValue(step));

  /** @type {Param | null} */
  let date;
  /** @type {string} */
  let nextDefault;
  if (part === 'day') {
    const day = /** @type {DayChoice} */ (choice.value);
    if (!['first', 'end', 'today'].includes(day)) {
      return { ok: false, error: '日を選んでください。' };
    }
    date = dayPartner(steps, params);
    const side = sideOf(date?.default) ?? (day === 'today' ? 'current' : 'prev');
    const combined = DEFAULTS[side][day];
    if (!combined) {
      return { ok: false, error: '選んだ日は、この日付には使えません。選び直してください。' };
    }
    nextDefault = combined;
  } else {
    const side = /** @type {DateSide} */ (choice.value);
    if (side !== 'prev' && side !== 'current') {
      return {
        ok: false,
        error: part === 'year' ? '年を選んでください。' : '月を選んでください。',
      };
    }
    date =
      datesWithout(steps, params, part).find((param) => sideOf(param.default) === side) ?? null;
    nextDefault = date?.default ?? /** @type {string} */ (DEFAULTS[side].first);
  }

  const name = date?.name ?? freeName('date', params, steps);
  /** @type {Param[]} */
  const added = date
    ? params.map((param) => (param.name === name ? { ...param, default: nextDefault } : param))
    : [...params, { name, label: name, type: 'date', default: nextDefault }];
  const next = steps.slice();
  next[index] = { ...step, values: [`{{${name}.${referencePart(part, value)}}}`] };
  const nextParams = relabelDates(next, added);
  const label = nextParams.find((param) => param.name === name)?.label ?? name;
  return { ok: true, steps: next, params: nextParams, label };
}

/**
 * 実行するたびに変える値にした手順を、記録した値に戻します（#286）。間違えて決めた場合に、選び直すためです。
 * 選択は記録した時点の表示文字列を、入力は文字のパラメータの既定値（記録した文字）を値にします。
 * 実行では、参照を含まない選択の値が選択肢の value にない場合は、表示文字列で探します。
 * どの手順も使わなくなったパラメータは除き、日付の表示名を付け直します。
 * @param {Step[]} steps
 * @param {Param[]} params
 * @param {unknown} index
 * @returns {{ ok: true, steps: Step[], params: Param[] } | { ok: false, error: string }}
 */
export function revertRecordedParam(steps, params, index) {
  if (typeof index !== 'number' || !Number.isInteger(index) || !steps[index]) {
    return { ok: false, error: '対象の手順が見つかりません。' };
  }
  const step = steps[index];
  if (!valueParamNote(step, params)) {
    return { ok: false, error: 'この手順は、実行するたびに変える値になっていません。' };
  }
  const next = steps.slice();
  if (step.type === 'select') {
    next[index] = { ...step, values: step.labels.slice(0, 1) };
  } else if (step.type === 'input') {
    const [reference] = findReferences(step.value ?? '');
    const param = params.find((item) => item.name === reference?.name);
    next[index] = { ...step, value: param?.default ?? '' };
  }
  return { ok: true, steps: next, params: relabelDates(next, referencedParams(next, params)) };
}

/**
 * どの手順も参照していないパラメータを除きます。手順を削除して参照がなくなった値を、フローに残さないためです。
 * @param {Step[]} steps
 * @param {Param[] | undefined} params
 * @returns {Param[]}
 */
export function referencedParams(steps, params) {
  if (!params?.length) {
    return [];
  }
  const names = new Set(findReferences(JSON.stringify(steps)).map(({ name }) => name));
  return params.filter((param) => names.has(param.name));
}

/** 参照の部分ごとの、画面に出す名前です。 */
const PART_NAMES = /** @type {Record<string, string>} */ ({
  year: '年',
  month: '月',
  mm: '月',
  day: '日',
  dd: '日',
});

/**
 * 実行するときに入力する値にした手順に添える説明です（#286）。例：「実行するときに入力：開始日の月」。
 * 選択と入力の手順で、値が定義のあるパラメータを参照する場合に返し、それ以外は null です。
 * @param {Step} step
 * @param {Param[] | undefined} params
 * @returns {string | null}
 */
export function valueParamNote(step, params) {
  const text =
    step.type === 'select'
      ? step.values.join(' ')
      : step.type === 'input' && typeof step.value === 'string'
        ? step.value
        : '';
  const names = findReferences(text).flatMap(({ name, part }) => {
    const param = params?.find((item) => item.name === name);
    if (!param) {
      return [];
    }
    return [part && PART_NAMES[part] ? `${param.label}の${PART_NAMES[part]}` : param.label];
  });
  return names.length > 0 ? `実行するときに入力：${names.join('、')}` : null;
}
