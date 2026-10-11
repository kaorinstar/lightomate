// 記録した選択と入力の値を、実行するたびに変える値（パラメータ）にします（#286）。
//
// 利用者が選ぶのは、その欄の既定値だけです。月の欄では「前月」「今月」「選んだ月」、日の欄では「1 日」「末日」
// 「今日と同じ日」「選んだ日」を選びます（#288）。パラメータの名前、表示名、種類、月と日をどの日付にまとめるか、
// 年・月・日のどれかは、記録した手順から決めます。管理画面で値の定義を作り、JSON の値を {{名前.部分}} に書き換える
// 作業を、記録中のボタン 1 つで行うためです。
//
// 日付のパラメータの既定値は、月（前月、今月、決まった年月）と日（1 日、末日、今日と同じ日、決まった日）の
// 組み合わせです（params.js の parseDateDefault）。月・年・日の欄は、その部分をまだ使っていない最初の日付に
// まとめ、その日付の既定値の、その部分を選んだ値にします。なければ日付を加えます。月と日をどちらの順に選んでも
// 組になります。
// 年・月・日の判定には要素の表示名を使います。翻訳で表示名が変わっても、誤りは「判定できずに利用者に選んで
// もらう」側か、記録した値との食い違いで選択を求める側に寄せます（CLAUDE.md）。

import { flattenSteps } from './control-flow.js';
import {
  defaultValue as resolveDefault,
  findReferences,
  formatDateDefault,
  parseDateDefault,
} from './params.js';

/** @typedef {import('./flow.js').Step} Step */
/** @typedef {import('./params.js').Param} Param */

/** 日付の部分です。 */
export const DATE_PARTS = /** @type {const} */ (['year', 'month', 'day']);

/** @typedef {typeof DATE_PARTS[number]} DatePart */

/** 日付の部分の、画面に出す名前です。 */
export const DATE_PART_LABELS = { year: '年', month: '月', day: '日' };

/** @typedef {import('./params.js').DateDefaultSpec} DateDefaultSpec */

/** 新しく加える日付の、まだ選んでいない部分の既定値です。月は前月、日は 1 日です。 */
const NEW_DATE_SPEC = { month: 'previous-month', day: 'first' };

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
 * （例：「開始の月」→「開始の日付」）。残る文字がない場合（表示名が「月」だけなど）は、既定値の日が 1 日なら
 * 「開始日」、末日なら「終了日」とします。それ以外は、日付が 2 つ以上ある場合は最初を「開始日」、最後を「終了日」、
 * 1 つだけなら「日付」とします。ほかのパラメータと重なる場合は、末尾に番号を付けます。
 * @param {string} label 要素の表示名
 * @param {DateDefaultSpec} spec 既定値
 * @param {{ index: number, count: number }} order 日付のパラメータの中での順番と数
 * @param {Param[]} params 名前を付け終えたパラメータ
 * @returns {string}
 */
function dateLabel(label, spec, order, params) {
  const rest = label
    .trim()
    .replace(/(\s*の?\s*[年月日])+$/, '')
    .trim();
  let base;
  if (rest) {
    base = /日付$/.test(rest) ? rest : `${rest}の日付`;
  } else if (spec.day === 'first') {
    base = '開始日';
  } else if (spec.day === 'end') {
    base = '終了日';
  } else if (order.count >= 2 && order.index === 0) {
    base = '開始日';
  } else if (order.count >= 2 && order.index === order.count - 1) {
    base = '終了日';
  } else {
    base = '日付';
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
 * 手順がその日付のその部分を使っているかを返します。
 * @param {Step[]} steps
 * @param {string} name 日付のパラメータの名前
 * @param {DatePart} part
 * @returns {boolean}
 */
function usesPart(steps, name, part) {
  return findReferences(JSON.stringify(steps)).some(
    (item) => item.name === name && item.part && PART_OF_REFERENCE[item.part] === part,
  );
}

/**
 * 欄をまとめる日付です。既定値を月と日に分けられる日付のうち、手順がまだその部分を使っていない最初のものです。
 * ない場合は null です。
 * @param {Step[]} steps
 * @param {Param[]} params
 * @param {DatePart} part
 * @returns {Param | null}
 */
function partnerOf(steps, params, part) {
  return (
    params.find(
      (param) =>
        param.type === 'date' &&
        parseDateDefault(param.default) !== null &&
        !usesPart(steps, param.name, part),
    ) ?? null
  );
}

/**
 * 「選んだ月」の年です。同じ日付の年の欄を記録していれば、その記録した値を使い、なければ今日の年にします。
 * @param {Step[]} steps
 * @param {string | undefined} name 日付のパラメータの名前
 * @param {Date} now
 * @returns {string}
 */
function fixedYear(steps, name, now) {
  for (const { step } of flattenSteps(steps)) {
    if (
      step.type === 'select' &&
      name &&
      step.values.some((value) => value.includes(`{{${name}.year}}`)) &&
      /^\d{4}$/.test(step.labels[0] ?? '')
    ) {
      return step.labels[0];
    }
  }
  return String(now.getFullYear());
}

/**
 * 欄の選ぶ欄に出す選択肢です。
 * @typedef {object} ValueOption
 * @property {string} value 送る値（月・年の欄は previous-month、current-month、fixed、keep。日の欄は first、end、
 *   today、fixed）
 * @property {string} label 画面に出す名前（例：前月（9 月）、末日（30 日））
 * @property {string} fieldValue 今日実行した場合に、この欄に当てはめる値（例：09）
 * @property {boolean} selected 最初に選んでおく選択肢か
 */

/**
 * 欄の選択肢を、この欄に当てはめる値とともに返します（#286、#288）。
 * 月の欄には月だけ、日の欄には日だけを出します。日付全体（前月 1 日など）を出すと、月の欄で日を選ぶように見えるためです。
 * 月と日はどの組み合わせでも選べます。年の欄は、まとめる日付の月をすでに選んでいる場合は、その月に合わせた
 * 年だけを出します。年と月は同じ側（前月か今月か）でなければ、日付を表せないためです。
 * 最初は、記録した値と当てはめる値が一致する選択肢を、並びの先頭から探して選んでおきます。「選んだ月」
 * 「選んだ日」は並びの最後のため、前月・今月などが一致しない場合に選ばれます。
 * @param {Step[]} steps
 * @param {Param[]} params
 * @param {number} index 対象の手順の番号
 * @param {DatePart} part 日付の部分
 * @param {Date} now 今日として計算に使う日時
 * @returns {ValueOption[]}
 */
export function valueOptions(steps, params, index, part, now) {
  const step = steps[index];
  const recorded = (step?.type === 'select' ? numericValue(step) : null) ?? '';
  const reference = referencePart(part, recorded || '00');
  const partner = partnerOf(steps, params, part);
  const spec = parseDateDefault(partner?.default) ?? NEW_DATE_SPEC;
  /** @param {DateDefaultSpec} next */
  const fieldValue = (next) => {
    const [year, month, day] = resolveDefault(
      { name: 'x', label: 'x', type: 'date', default: formatDateDefault(next) },
      now,
    ).split('-');
    return (
      { year, mm: month, month: String(Number(month)), dd: day, day: String(Number(day)) }[
        reference
      ] ?? ''
    );
  };

  /** @type {{ value: string, label: string, fieldValue: string }[]} */
  let options;
  if (part === 'day') {
    options = [
      { value: 'first', name: '1 日' },
      { value: 'end', name: '末日' },
      { value: 'today', name: '今日と同じ日' },
    ].map(({ value, name }) => {
      const shown = fieldValue({ ...spec, day: value });
      return {
        value,
        label: value === 'first' ? name : `${name}（${Number(shown)} 日）`,
        fieldValue: shown,
      };
    });
    options.push({
      value: 'fixed',
      label: `選んだ日（${Number(recorded)} 日のまま）`,
      fieldValue: fieldValue({ ...spec, day: String(Number(recorded)) }),
    });
  } else if (part === 'month') {
    options = [
      { value: 'previous-month', name: '前月' },
      { value: 'current-month', name: '今月' },
    ].map(({ value, name }) => {
      const shown = fieldValue({ ...spec, month: value });
      return { value, label: `${name}（${Number(shown)} 月）`, fieldValue: shown };
    });
    const fixed = `${fixedYear(steps, partner?.name, now)}-${String(Number(recorded)).padStart(2, '0')}`;
    options.push({
      value: 'fixed',
      label: `選んだ月（${Number(recorded)} 月のまま）`,
      fieldValue: fieldValue({ ...spec, month: fixed }),
    });
  } else if (partner && usesPart(steps, partner.name, 'month')) {
    const shown = fieldValue(spec);
    options = [{ value: 'keep', label: `月の欄に合わせた年（${shown} 年）`, fieldValue: shown }];
  } else {
    options = [
      { value: 'previous-month', name: '前月の年' },
      { value: 'current-month', name: '今年' },
    ].map(({ value, name }) => {
      const shown = fieldValue({ ...spec, month: value });
      return { value, label: `${name}（${shown} 年）`, fieldValue: shown };
    });
  }
  const match = options.find(
    (option) => recorded !== '' && Number(option.fieldValue) === Number(recorded),
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
  const dates = params.filter(
    (param) =>
      param.type === 'date' && /^date\d+$/.test(param.name) && parseDateDefault(param.default),
  );
  /** @type {Param[]} */
  const done = [];
  for (const param of params) {
    const spec = dates.includes(param) ? parseDateDefault(param.default) : null;
    if (spec) {
      const label = refs.find((ref) => ref.name === param.name)?.label ?? '';
      const order = { index: dates.indexOf(param), count: dates.length };
      done.push({ ...param, label: dateLabel(label, spec, order, done) });
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
 * @param {{ value?: unknown, part?: unknown }} choice 選んだ値（valueOptions の value）と、表示名から決まらない
 *   場合の部分
 * @param {Date} [now] 今日。「選んだ月」の年を、年の欄の記録から決められない場合に使います
 * @returns {{ ok: true, steps: Step[], params: Param[], label: string } | { ok: false, error: string }}
 */
export function makeRecordedParam(steps, params, index, choice, now = new Date()) {
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
  const partner = partnerOf(steps, params, part);
  const spec = { ...(parseDateDefault(partner?.default) ?? NEW_DATE_SPEC) };
  const picked = choice.value;
  const relative = picked === 'previous-month' || picked === 'current-month';
  if (part === 'day') {
    if (picked === 'first' || picked === 'end' || picked === 'today') {
      spec.day = picked;
    } else if (picked === 'fixed') {
      spec.day = String(Number(value));
    } else {
      return { ok: false, error: '日を選んでください。' };
    }
  } else if (part === 'month') {
    if (relative) {
      spec.month = /** @type {string} */ (picked);
    } else if (picked === 'fixed') {
      spec.month = `${fixedYear(steps, partner?.name, now)}-${String(Number(value)).padStart(2, '0')}`;
    } else {
      return { ok: false, error: '月を選んでください。' };
    }
  } else if (picked === 'keep' && partner && usesPart(steps, partner.name, 'month')) {
    // 年は、まとめる日付の月に合わせます。
  } else if (relative && !(partner && usesPart(steps, partner.name, 'month'))) {
    spec.month = /** @type {string} */ (picked);
  } else {
    return { ok: false, error: '年を選び直してください。' };
  }

  const name = partner?.name ?? freeName('date', params, steps);
  const nextDefault = formatDateDefault(spec);
  /** @type {Param[]} */
  const added = partner
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
