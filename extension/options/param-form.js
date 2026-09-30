// フローの詳細の［手順］タブの、パラメータ（実行時に入力する値）の定義の入力欄です（#9）。
// 1 つのパラメータを 1 つのまとまり（fieldset）にし、項目名を入力欄の上に置きます
// （docs/design-guidelines.md の「配置と余白」）。入力の値と定義の変換は shared/param-edit.js にあります。

import { PARAM_TYPES } from '../shared/params.js';

/** @typedef {import('../shared/param-edit.js').ParamRow} ParamRow */

/** 種類の選択肢の名前です。 */
const TYPE_LABELS = { text: '文字', number: '数値', select: '選択肢', month: '年月' };

/** 年月の既定値の選択肢です。 */
const MONTH_DEFAULTS = [
  ['', 'なし'],
  ['@current-month', '今月'],
  ['@previous-month', '前月'],
];

let serial = 0;

/**
 * 項目名と入力欄の組を作ります。
 * @param {string} text 項目名
 * @param {HTMLInputElement | HTMLSelectElement} control
 * @returns {HTMLDivElement}
 */
function field(text, control) {
  serial += 1;
  control.id = `param-field-${serial}`;
  const label = document.createElement('label');
  label.className = 'form-label';
  label.htmlFor = control.id;
  label.textContent = text;
  const wrapper = document.createElement('div');
  wrapper.className = 'lm-param-field';
  wrapper.append(label, control);
  return wrapper;
}

/**
 * 文字の入力欄を作ります。
 * @param {string} name 行の中での役割（data-role）
 * @param {string} value
 * @returns {HTMLInputElement}
 */
function textInput(name, value) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control';
  input.dataset.role = name;
  input.value = value;
  return input;
}

/**
 * 選択の欄を作ります。
 * @param {string} name 行の中での役割（data-role）
 * @param {string[][]} options 値と表示の組
 * @param {string} value
 * @returns {HTMLSelectElement}
 */
function select(name, options, value) {
  const element = document.createElement('select');
  element.className = 'form-select';
  element.dataset.role = name;
  for (const [optionValue, text] of options) {
    element.append(new Option(text, optionValue, false, optionValue === value));
  }
  return element;
}

/**
 * パラメータ 1 つの入力のまとまりを作ります。種類を変えると、選択肢と既定値の欄を作り直します。
 * @param {ParamRow} row
 * @param {number} index 何番目か（見出しに使います）
 * @returns {HTMLFieldSetElement}
 */
export function paramFieldset(row, index) {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'lm-param-row';
  fieldset.dataset.originalName = row.originalName;
  const legend = document.createElement('legend');
  legend.className = 'lm-param-legend';
  legend.textContent = `値 ${index + 1}`;

  const type = select(
    'type',
    PARAM_TYPES.map((value) => [value, TYPE_LABELS[value]]),
    row.type,
  );
  const extras = document.createElement('div');
  extras.className = 'lm-param-extras';
  /** @param {string} options @param {string} value */
  const renderExtras = (options, value) => {
    const fields = [];
    if (type.value === 'select') {
      fields.push(field('選択肢（「、」で区切る）', textInput('options', options)));
    }
    fields.push(
      field(
        '既定値',
        type.value === 'month'
          ? select('default', MONTH_DEFAULTS, value)
          : textInput('default', value),
      ),
    );
    extras.replaceChildren(...fields);
  };
  renderExtras(row.options, row.default);
  type.addEventListener('change', () => renderExtras('', ''));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-sm btn-ghost-danger';
  remove.textContent = '削除';
  remove.setAttribute('aria-label', `値 ${index + 1} を削除`);
  remove.addEventListener('click', () => fieldset.remove());

  const main = document.createElement('div');
  main.className = 'lm-param-main';
  main.append(
    field('名前（英字で始まる英数字）', textInput('name', row.name)),
    field('表示名', textInput('label', row.label)),
    field('種類', type),
  );
  const buttons = document.createElement('div');
  buttons.className = 'lm-buttons mt-2';
  buttons.append(remove);
  fieldset.append(legend, main, extras, buttons);
  return fieldset;
}

/**
 * 入力のまとまりから、画面の入力の行を読み取ります。
 * @param {HTMLElement} container
 * @returns {ParamRow[]}
 */
export function readParamRows(container) {
  return [...container.querySelectorAll('fieldset.lm-param-row')].map((element) => {
    const fieldset = /** @type {HTMLFieldSetElement} */ (element);
    /** @param {string} role */
    const value = (role) =>
      /** @type {HTMLInputElement | HTMLSelectElement | null} */ (
        fieldset.querySelector(`[data-role="${role}"]`)
      )?.value ?? '';
    return {
      originalName: fieldset.dataset.originalName ?? '',
      name: value('name'),
      label: value('label'),
      type: value('type'),
      options: value('options'),
      default: value('default'),
    };
  });
}
