// 実行する値の入力フォームと、フローの最初のページの処理です。
// サイドパネルと管理画面の両方から使います（#43）。chrome.* は使いません。
// フォームを組み立てる関数は、渡された要素の ownerDocument を使って部品を作ります。

import { isWebUrl } from './flow.js';
import { defaultValue, findReferences, renderTemplate, resolveParams } from './params.js';

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
 * @param {Document} document
 * @param {Flow} flow
 * @param {{ params: Param[], secretSteps: number[], now: Date }} fields 作る欄
 * @returns {HTMLLabelElement[]}
 */
export function buildRunFields(document, flow, { params, secretSteps, now }) {
  const labels = params.map((param) => {
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
    control.required = true;
    return labeled(document, param.label, control);
  });

  for (const index of secretSteps) {
    const step = flow.steps[index];
    const control = document.createElement('input');
    control.className = 'form-control';
    control.type = 'password';
    control.name = `secret:${index}`;
    control.autocomplete = 'off';
    control.required = true;
    const label = step.type === 'input' ? step.target.label : '';
    labels.push(labeled(document, `${label}（手順 ${index + 1}）`, control));
  }
  return labels;
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
 * @param {Document} document
 * @param {string} text
 * @param {HTMLElement} control
 * @returns {HTMLLabelElement}
 */
function labeled(document, text, control) {
  const label = document.createElement('label');
  label.className = 'form-label lm-field';
  label.append(text, control);
  return label;
}
