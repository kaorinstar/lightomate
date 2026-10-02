// 記録した手順の範囲を選び、一覧の各行で繰り返す手順に変える欄です（#167）。
// 記録中の区画と、記録したフローの保存の区画で使います。変換は Service Worker が行います。

import { describeStep } from '../shared/describe.js';
import { defaultLoopRange, loopOptionLabel, loopOptions } from '../shared/record-loop.js';
import { showNotice, showToast } from '../shared/ui.js';

/** @typedef {import('../shared/flow.js').Step} Step */
/** @typedef {import('../shared/record-loop.js').RowHint} RowHint */

/**
 * 説明の文に使う、手順の短い説明の長さの上限です。選択肢が横に長くなりすぎないようにします。
 */
const OPTION_TEXT_LENGTH = 40;

/** 欄の項目に付ける id の連番です。2 つの区画で同じ id にならないようにします。 */
let nextId = 0;

/**
 * 繰り返しにする欄を作ります。
 * @param {{ open: HTMLButtonElement, container: HTMLElement, toast: HTMLElement }} parts
 *   open は欄を開くボタン、container は欄を置く場所、toast は成功の知らせを出す場所です
 * @returns {{ update: (steps: Step[], hints: RowHint[] | undefined, locked: boolean) => void }}
 */
export function createLoopForm({ open, container, toast }) {
  const id = `loop-${(nextId += 1)}`;
  /** @type {Step[]} */
  let steps = [];
  /** @type {RowHint[]} */
  let hints = [];
  /** フローの実行中は、手順を変えないようにします。 */
  let locked = false;

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'lm-loop-form mt-2';
  const legend = document.createElement('legend');
  legend.className = 'form-label';
  legend.textContent = '一覧の各行で繰り返す手順';
  const hint = document.createElement('p');
  hint.className = 'lm-sub mb-2';
  hint.id = `${id}-hint`;
  hint.textContent =
    '1 件目の操作を記録した手順の範囲を選びます。一覧の行の中の要素は、行ごとにその行の中で探します。';

  const from = select(`${id}-from`, '最初の手順');
  const to = select(`${id}-to`, '最後の手順');
  const row = select(`${id}-row`, '一覧の行');
  from.control.setAttribute('aria-describedby', hint.id);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-sm btn-primary';
  submit.textContent = '繰り返しにする';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-sm';
  cancel.textContent = 'キャンセル';
  const buttons = document.createElement('div');
  buttons.className = 'lm-buttons';
  buttons.append(submit, cancel);
  const notice = document.createElement('p');
  notice.hidden = true;

  fieldset.append(legend, hint, from.field, to.field, row.field, buttons, notice);
  container.replaceChildren(fieldset);

  /** 範囲に合わせて、一覧の行の選択肢を作り直します。選んでいた行が残る場合は、選んだままにします。 */
  const refreshRows = () => {
    const start = Number(from.control.value);
    const end = Number(to.control.value);
    const previous = row.control.value;
    const options = start <= end ? loopOptions(steps, hints, start, end) : [];
    row.control.replaceChildren(
      ...options.map((option) => new Option(loopOptionLabel(option), option.key)),
    );
    if (options.some((option) => option.key === previous)) {
      row.control.value = previous;
    }
    row.field.hidden = options.length === 0;
    submit.disabled = locked || options.length === 0;
    if (start > end) {
      showNotice(notice, '最後の手順は、最初の手順と同じか、それより後を選んでください。', 'error');
    } else if (options.length === 0) {
      showNotice(
        notice,
        '選んだ範囲に、一覧の行の中を操作した手順がありません。範囲を選び直してください。',
        'error',
      );
    } else {
      notice.hidden = true;
    }
  };

  /**
   * 手順の選択肢を作り直します。選んでいた番号が残る場合は、選んだままにします。
   * @param {HTMLSelectElement} control
   * @param {number} fallback
   */
  const fillSteps = (control, fallback) => {
    const previous = control.value;
    control.replaceChildren(
      ...steps.map((step, index) => new Option(stepOptionText(step, index), String(index))),
    );
    control.value =
      previous !== '' && Number(previous) < steps.length ? previous : String(fallback);
  };

  const close = () => {
    container.hidden = true;
    open.hidden = !defaultLoopRange(steps, hints);
    notice.hidden = true;
  };

  open.addEventListener('click', () => {
    const range = defaultLoopRange(steps, hints);
    if (!range) {
      return;
    }
    from.control.value = '';
    to.control.value = '';
    fillSteps(from.control, range.from);
    fillSteps(to.control, range.to);
    row.control.value = '';
    refreshRows();
    container.hidden = false;
    open.hidden = true;
    from.control.focus();
  });
  from.control.addEventListener('change', refreshRows);
  to.control.addEventListener('change', refreshRows);
  cancel.addEventListener('click', close);
  submit.addEventListener('click', async () => {
    const start = Number(from.control.value);
    const end = Number(to.control.value);
    submit.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        kind: 'recording/makeLoop',
        from: start,
        to: end,
        key: row.control.value,
        count: steps.length,
      });
      if (!response?.ok) {
        showNotice(notice, response?.error ?? '繰り返しにできません。', 'error');
        return;
      }
      close();
      showToast(
        toast,
        start === end
          ? `手順 ${start + 1} を、一覧の各行で繰り返す手順にしました。`
          : `手順 ${start + 1}〜${end + 1} を、一覧の各行で繰り返す手順にしました。`,
      );
    } catch (error) {
      showNotice(notice, String(error), 'error');
    } finally {
      submit.disabled = locked || row.control.options.length === 0;
    }
  });

  container.hidden = true;
  open.hidden = true;

  return {
    update(nextSteps, nextHints, nextLocked) {
      steps = nextSteps;
      locked = nextLocked;
      hints = nextSteps.map((_, index) => nextHints?.[index] ?? null);
      const possible = Boolean(defaultLoopRange(steps, hints));
      open.disabled = locked;
      if (container.hidden) {
        open.hidden = !possible;
        return;
      }
      if (!possible) {
        close();
        return;
      }
      // 欄を開いている間に手順が増えた場合（記録中）は、選択肢を作り直します。
      const range = /** @type {{ from: number, to: number }} */ (defaultLoopRange(steps, hints));
      fillSteps(from.control, range.from);
      fillSteps(to.control, range.to);
      refreshRows();
    },
  };
}

/**
 * 項目名と選択の欄の組を作ります。
 * @param {string} id
 * @param {string} label
 * @returns {{ field: HTMLDivElement, control: HTMLSelectElement }}
 */
function select(id, label) {
  const field = document.createElement('div');
  field.className = 'mb-2';
  const caption = document.createElement('label');
  caption.className = 'form-label';
  caption.htmlFor = id;
  caption.textContent = label;
  const control = document.createElement('select');
  control.className = 'form-select form-select-sm';
  control.id = id;
  field.append(caption, control);
  return { field, control };
}

/**
 * 手順の選択肢の文です。例：3. クリック：領収書等
 * @param {Step} step
 * @param {number} index
 * @returns {string}
 */
export function stepOptionText(step, index) {
  const text = describeStep(step);
  const short = text.length > OPTION_TEXT_LENGTH ? `${text.slice(0, OPTION_TEXT_LENGTH)}…` : text;
  return `${index + 1}. ${short}`;
}
