// 実行する値の入力フォームと、フローの最初のページの処理です。
// サイドパネルと管理画面の両方から使います（#43）。chrome.* は使いません。
// フォームを組み立てる関数は、渡された要素の ownerDocument を使って部品を作ります。

import { isWebUrl } from './flow.js';
import {
  defaultValue,
  findReferences,
  paramFieldErrors,
  renderTemplate,
  resolveParams,
} from './params.js';
import { showFieldError } from './ui.js';

/** @typedef {import('./flow.js').Flow} Flow */
/** @typedef {import('./params.js').Param} Param */

/** 最初の手順がページを開く手順でないフローで、開くページが決まらない理由です。 */
export const NO_FIRST_PAGE = '最初の手順がページを開く手順ではないため、開くページが決まりません。';

/**
 * 値を記録していない入力欄（パスワードなど）の手順の番号を返します。
 * @param {Flow} flow
 * @returns {number[]}
 */
export function secretStepIndexes(flow) {
  return flow.steps.flatMap((step, index) => (step.type === 'input' && step.secret ? [index] : []));
}

/**
 * 最初のページを開くときに入力が必要なパラメータです。最初の手順の URL が参照するものだけを返します。
 * @param {Flow} flow
 * @returns {Param[]}
 */
export function firstPageParams(flow) {
  const first = flow.steps[0];
  if (first?.type !== 'navigate') {
    return [];
  }
  const names = new Set(findReferences(first.url).map(({ name }) => name));
  return (flow.params ?? []).filter((param) => names.has(param.name));
}

/**
 * 最初の手順の URL に、パラメータの値を当てはめて返します。手順は実行しません。
 * 実行時と同じく、フローのサイト以外の URL になる場合は開きません。
 * @param {Flow} flow
 * @param {Record<string, string>} paramInput 入力フォームの値
 * @param {Date} now 前月などの既定値の計算に使う日時
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function firstPageUrl(flow, paramInput, now) {
  const first = flow.steps[0];
  if (first?.type !== 'navigate') {
    return { ok: false, error: NO_FIRST_PAGE };
  }
  const { values, errors } = resolveParams(firstPageParams(flow), paramInput, now);
  if (errors.length > 0) {
    return { ok: false, error: errors.join(' ') };
  }
  const url = renderTemplate(first.url, values);
  if (!isWebUrl(url) || new URL(url).origin !== flow.origin) {
    return {
      ok: false,
      error: `開くページ（${url}）が、フローのサイト（${flow.origin}）ではありません。`,
    };
  }
  return { ok: true, url };
}

/**
 * 入力フォームの欄を作ります。パラメータごとの欄と、値を記録していない入力欄の手順ごとの欄です。
 * 各欄は、項目名、入力欄、誤りの表示欄（invalid-feedback）の順に並べます。
 * Chrome 標準の吹き出し（required による検証）は使わず、showRunFieldErrors で各欄の直下に誤りを出します。
 * フォームには novalidate を付けます（docs/design-guidelines.md の「5.」）。
 * @param {Document} document
 * @param {Flow} flow
 * @param {{ params: Param[], secretSteps: number[], now: Date, idPrefix?: string }} fields 作る欄。
 *   idPrefix は、入力欄の id の接頭辞です
 * @returns {HTMLDivElement[]}
 */
export function buildRunFields(
  document,
  flow,
  { params, secretSteps, now, idPrefix = 'run-field' },
) {
  let count = 0;
  const nextId = () => `${idPrefix}-${count++}`;
  const fields = params.map((param) => {
    /** @type {HTMLInputElement | HTMLSelectElement} */
    let control;
    if (param.type === 'select') {
      control = document.createElement('select');
      control.className = 'form-select';
      for (const option of param.options ?? []) {
        const element = document.createElement('option');
        element.value = option;
        element.textContent = option;
        control.append(element);
      }
    } else {
      control = document.createElement('input');
      control.className = 'form-control';
      control.type = param.type === 'month' ? 'month' : 'text';
      if (param.type === 'number') {
        control.inputMode = 'decimal';
      }
    }
    control.name = `param:${param.name}`;
    control.value = defaultValue(param, now);
    return field(document, param.label, control, nextId());
  });

  for (const index of secretSteps) {
    const step = flow.steps[index];
    const control = document.createElement('input');
    control.className = 'form-control';
    control.type = 'password';
    control.name = `secret:${index}`;
    control.autocomplete = 'off';
    const label = step.type === 'input' ? step.target.label : '';
    fields.push(field(document, `${label}（手順 ${index + 1}）`, control, nextId()));
  }
  return fields;
}

/**
 * 入力フォームの値を検証し、誤りをそれぞれの入力欄の直下に表示します。
 * パラメータの欄は実行時と同じ検証（paramFieldErrors）を行い、値を記録していない入力欄は空を誤りにします。
 * @param {HTMLFormElement} form buildRunFields で作った欄を含むフォーム
 * @param {Param[]} params フォームを作ったときのパラメータ
 * @param {Date} now
 * @returns {boolean} 誤りがある場合は true。最初の誤りの欄にフォーカスを移します
 */
export function showRunFieldErrors(form, params, now) {
  const { params: input } = readRunFields(new FormData(form));
  const errors = paramFieldErrors(params, input, now);
  /** @type {HTMLElement | null} */
  let first = null;
  const controls = /** @type {NodeListOf<HTMLInputElement | HTMLSelectElement>} */ (
    form.querySelectorAll('input[name], select[name]')
  );
  for (const control of controls) {
    const feedback = form.ownerDocument.getElementById(`${control.id}-feedback`);
    if (!feedback) {
      continue;
    }
    const error = control.name.startsWith('param:')
      ? (errors[control.name.slice('param:'.length)] ?? '')
      : control.value === ''
        ? '値を入力してください。'
        : '';
    showFieldError(control, feedback, error);
    if (error && !first) {
      first = control;
    }
  }
  first?.focus();
  return first !== null;
}

/**
 * 入力フォームの値を、パラメータの値と、値を記録していない入力欄の値（手順の番号ごと）に分けます。
 * @param {Iterable<[string, unknown]>} entries new FormData(form) の内容
 * @returns {{ params: Record<string, string>, secrets: Record<string, string> }}
 */
export function readRunFields(entries) {
  /** @type {Record<string, string>} */
  const params = {};
  /** @type {Record<string, string>} */
  const secrets = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'string') {
      continue;
    }
    if (key.startsWith('param:')) {
      params[key.slice('param:'.length)] = value;
    } else if (key.startsWith('secret:')) {
      secrets[key.slice('secret:'.length)] = value;
    }
  }
  return { params, secrets };
}

/**
 * 入力フォームの 1 項目（項目名、入力欄、誤りの表示欄）を作ります。
 * 誤りの表示欄は入力欄の直後に置きます。Tabler は、誤りの印の付いた入力欄の後ろの表示欄だけを表示するためです。
 * 項目名は label の for で入力欄に結び付け、誤りの文が項目名として読み上げられないようにします。
 * @param {Document} document
 * @param {string} text 項目名
 * @param {HTMLInputElement | HTMLSelectElement} control
 * @param {string} id 入力欄の id
 * @returns {HTMLDivElement}
 */
function field(document, text, control, id) {
  control.id = id;
  const label = document.createElement('label');
  label.className = 'form-label';
  label.htmlFor = id;
  label.textContent = text;
  const feedback = document.createElement('div');
  feedback.className = 'invalid-feedback';
  feedback.id = `${id}-feedback`;
  // 誤りは、その欄を直し始めたときに消します。
  control.addEventListener('input', () => showFieldError(control, feedback, ''));
  const wrapper = document.createElement('div');
  wrapper.className = 'lm-field';
  wrapper.append(label, control, feedback);
  return wrapper;
}
