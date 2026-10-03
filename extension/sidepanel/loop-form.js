// 記録した手順の範囲を選び、一覧の各行で繰り返す手順に変える欄です（#167）。
// 記録中の区画と、記録したフローの保存の区画で使います。変換は Service Worker が行います。
//
// 手順の一覧にチェックボックスを付け、印を付けた範囲を色と左の線で示します。範囲の手順には、要素を
// 「1 件の中」で探すか「ページ全体」で探すかの印を付けます。一覧の行は CSS セレクターではなく件数で示します。

import { DEFAULT_MAX_PAGES } from '../shared/control-flow.js';
import { describeStep } from '../shared/describe.js';
import {
  defaultLoopRange,
  excludedReason,
  loopOptionLabel,
  loopOptions,
  nameableSteps,
  pagerSpan,
  pagerSteps,
  stepScopes,
  toggleRange,
} from '../shared/record-loop.js';
import { showNotice, showToast } from '../shared/ui.js';

/** @typedef {import('../shared/flow.js').Step} Step */
/** @typedef {import('../shared/record-loop.js').RowHint} RowHint */
/** @typedef {import('../shared/record-loop.js').PagerHint} PagerHint */

/** 欄の項目に付ける id の連番です。2 つの区画で同じ id にならないようにします。 */
let nextId = 0;

/**
 * 繰り返しにする欄を作ります。
 * @param {{ open: HTMLButtonElement, container: HTMLElement, list: HTMLElement, toast: HTMLElement }} parts
 *   open は欄を開くボタン、container は欄を置く場所、list は区画の手順の一覧（欄を開いている間は隠します）、
 *   toast は成功の知らせを出す場所です
 * @returns {{
 *   update: (
 *     steps: Step[],
 *     hints: RowHint[] | undefined,
 *     locked: boolean,
 *     pagers?: PagerHint[] | undefined,
 *   ) => void,
 * }}
 */
export function createLoopForm({ open, container, list, toast }) {
  const id = `loop-${(nextId += 1)}`;
  /** @type {Step[]} */
  let steps = [];
  /** @type {RowHint[]} */
  let hints = [];
  /** @type {PagerHint[]} */
  let pagers = [];
  /** フローの実行中は、手順を変えないようにします。 */
  let locked = false;
  /** @type {{ from: number, to: number } | null} */
  let range = null;
  /** 選んでいる一覧の行の候補（candidateKey の値）です。空の場合は、最も多く使われた候補にします。 */
  let rowKey = '';
  /**
   * ファイル名に使う手順の番号です（#179）。選んだ順に並べ、その順にファイル名に並べます。
   * @type {number[]}
   */
  let naming = [];
  /** ファイル名の先頭にサイト名を入れるか（#179）です。 */
  let withSite = false;
  /**
   * 次のページへ送るクリックの番号です（#182）。ページ送りをしない場合は null です。
   * @type {number | null}
   */
  let paging = null;

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'lm-loop-form';
  const legend = document.createElement('legend');
  legend.className = 'lm-loop-title';
  legend.textContent = '繰り返す手順を選ぶ';
  const hint = document.createElement('p');
  hint.className = 'lm-sub mb-2';
  hint.textContent =
    '1 件目で行った操作に印を付けます。印を付けた手順を、一覧の 1 件ごとに行います。';
  const pick = document.createElement('ul');
  pick.className = 'lm-loop-pick mb-2';

  const summary = document.createElement('div');
  summary.className = 'alert alert-info lm-guide mb-2';
  const rowField = document.createElement('div');
  rowField.className = 'mb-2';
  const rowLabel = document.createElement('label');
  rowLabel.className = 'form-label';
  rowLabel.htmlFor = `${id}-row`;
  rowLabel.textContent = '1 件分の枠';
  const rowSelect = document.createElement('select');
  rowSelect.className = 'form-select form-select-sm';
  rowSelect.id = `${id}-row`;
  rowField.append(rowLabel, rowSelect);

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'btn btn-sm btn-primary';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-sm';
  cancel.textContent = 'キャンセル';
  const buttons = document.createElement('div');
  buttons.className = 'lm-buttons';
  buttons.append(submit, cancel);
  const notice = document.createElement('p');
  notice.hidden = true;

  fieldset.append(legend, hint, pick, summary, rowField, buttons, notice);
  container.replaceChildren(fieldset);

  /**
   * 範囲の一覧の行の候補です。最も多くの手順が中を操作した候補だけにします。行の外の小さな枠の中の
   * 手順だけが使う候補などを選べるようにしても、利用者には違いが分からないためです。
   */
  const currentOptions = () => {
    const options = range ? loopOptions(steps, hints, range.from, range.to) : [];
    return options.filter((option) => option.used === options[0].used);
  };

  /**
   * 手順の一覧の 1 行です。
   * @param {Step} step
   * @param {number} index
   * @param {boolean} inRange
   * @param {'item' | 'page' | null} scope
   * @returns {HTMLLIElement}
   */
  const pickItem = (step, index, inRange, scope) => {
    const item = document.createElement('li');
    if (inRange) {
      item.className = 'lm-loop-in';
    }
    const reason = excludedReason(step);
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'lm-check';
    box.id = `${id}-step-${index}`;
    // 含められない手順は、範囲の中にあっても印を付けた状態にしません。押せず、外せなくなるためです。
    box.checked = inRange && reason === null;
    box.disabled = locked || reason !== null;
    box.addEventListener('change', () => {
      range = toggleRange(steps, range, index, box.checked);
      draw();
      // 一覧を作り直すため、押したチェックボックスに入力の位置を戻します。
      document.getElementById(box.id)?.focus();
    });
    const content = document.createElement('div');
    content.className = 'lm-loop-step';
    const label = document.createElement('label');
    label.htmlFor = box.id;
    label.textContent = `${index + 1}. ${describeStep(step)}`;
    if (reason) {
      const why = document.createElement('small');
      why.className = 'd-block lm-sub';
      why.textContent = reason;
      label.append(why);
    }
    content.append(label);
    // ファイル名に使う文字を選んでいる場合は、保存の手順の下に、変換後の保存先を示します（#179）。今の説明の
    // 保存先は変換前のもので、［繰り返す］を押すと変わるためです。
    if (inRange && naming.length > 0 && isSaveStepForName(step)) {
      const changed = document.createElement('small');
      changed.className = 'd-block lm-loop-changed';
      changed.textContent = `→ 保存先は Lightomate/<フロー名>/${fileNameText()} に変わります`;
      content.append(changed);
    }
    // 文字のクリックは、読み取りに変えて保存するファイルの名前に使えます（#179）。
    if (inRange && nameableIndexes().includes(index)) {
      content.append(nameToggle(index));
    }
    // 1 件目の操作の後に押した「次へ」は、繰り返しのページ送りに使えます（#182）。
    if (pagerIndexes().includes(index)) {
      content.append(pagerToggle(index));
    }
    // ページ送りに置き換える、一覧へ戻る移動と「次へ」の後の移動は、手順から除くことを示します（#182）。
    if (removedByPaging(index)) {
      const removed = document.createElement('small');
      removed.className = 'd-block lm-loop-changed';
      removed.textContent = '→ ページ送りに置き換えるため、手順から除きます';
      content.append(removed);
    }
    item.append(box, content);
    if (scope) {
      const badge = document.createElement('span');
      badge.className = `badge ${scope === 'item' ? 'bg-blue-lt' : 'bg-secondary-lt'} lm-loop-scope`;
      badge.textContent = scope === 'item' ? '1 件の中' : 'ページ全体';
      item.append(badge);
    }
    return item;
  };

  /**
   * 保存するファイルの名前の説明です（#179）。例：サイト名_「2026年9月11日」_「503-1」
   * @returns {string}
   */
  const fileNameText = () =>
    [
      ...(withSite ? ['サイト名'] : []),
      ...naming.map((index) => {
        const step = steps[index];
        return `「${'target' in step ? step.target.label : ''}」`;
      }),
    ].join('_');

  /**
   * 保存先が、ファイル名に使う文字で変わる手順か（#179）。
   * @param {Step} step
   * @returns {boolean}
   */
  const isSaveStepForName = (step) =>
    step.type === 'savePdf' || (step.type === 'click' && step.download !== undefined);

  /** 次のページへ送るクリックとして選べる手順の番号です（#182）。 */
  const pagerIndexes = () =>
    range && rowKey ? pagerSteps(steps, hints, pagers, range.from, range.to, rowKey) : [];

  /**
   * 繰り返す手順の末尾です。次のページへ送るクリックを範囲の中で選んだ場合は、その前までです（#182）。
   * @param {{ from: number, to: number }} current
   * @returns {number}
   */
  const loopEnd = (current) => (paging === null ? current.to : Math.min(current.to, paging - 1));

  /**
   * ページ送りに置き換えるため、手順から除く移動の手順かを返します（#182）。「次へ」のクリック自体は除きます。
   * @param {number} index
   * @returns {boolean}
   */
  const removedByPaging = (index) => {
    if (!range || paging === null || index === paging) {
      return false;
    }
    const { innerEnd, removeEnd } = pagerSpan(steps, range.to, paging);
    return index > innerEnd && index <= removeEnd;
  };

  /**
   * 「このクリックで次のページへ送る」の切り替えです（#182）。選べるのは 1 つだけです。
   * @param {number} index
   * @returns {HTMLLabelElement}
   */
  const pagerToggle = (index) => {
    const toggle = document.createElement('label');
    toggle.className = 'lm-loop-name lm-sub';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'lm-check';
    check.id = `${id}-pager-${index}`;
    check.checked = paging === index;
    check.disabled = locked;
    check.addEventListener('change', () => {
      paging = check.checked ? index : null;
      draw();
      document.getElementById(check.id)?.focus();
    });
    toggle.append(check, document.createTextNode(' このクリックで次のページへ送る'));
    return toggle;
  };

  /** 範囲の中で、ファイル名に使える手順の番号です（#179）。 */
  const nameableIndexes = () => (range ? nameableSteps(steps, range.from, range.to) : []);

  /**
   * 「ファイル名に使う」の切り替えです（#179）。
   * @param {number} index
   * @returns {HTMLLabelElement}
   */
  const nameToggle = (index) => {
    const toggle = document.createElement('label');
    toggle.className = 'lm-loop-name lm-sub';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'lm-check';
    check.id = `${id}-name-${index}`;
    check.checked = naming.includes(index);
    check.disabled = locked;
    check.addEventListener('change', () => {
      naming = check.checked ? [...naming, index] : naming.filter((chosen) => chosen !== index);
      draw();
      document.getElementById(check.id)?.focus();
    });
    toggle.append(check, document.createTextNode(' この文字をファイル名に使う'));
    return toggle;
  };

  /**
   * 「ファイル名の先頭にサイト名を入れる」の切り替えです（#179）。
   * @returns {HTMLLabelElement}
   */
  const siteToggle = () => {
    const toggle = document.createElement('label');
    toggle.className = 'lm-loop-name lm-sub';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'lm-check';
    check.id = `${id}-site`;
    check.checked = withSite;
    check.disabled = locked;
    check.addEventListener('change', () => {
      withSite = check.checked;
      draw();
      document.getElementById(check.id)?.focus();
    });
    toggle.append(
      check,
      document.createTextNode(' ファイル名の先頭にサイト名（例：www.amazon.co.jp）を入れる'),
    );
    return toggle;
  };

  /** 範囲と行の候補に合わせて、欄を表示し直します。 */
  const draw = () => {
    const nameable = nameableIndexes();
    naming = naming.filter((index) => nameable.includes(index));
    const options = currentOptions();
    if (!options.some((option) => option.key === rowKey)) {
      rowKey = options[0]?.key ?? '';
    }
    const chosen = options.find((option) => option.key === rowKey);
    if (paging !== null && !pagerIndexes().includes(paging)) {
      paging = null;
    }
    const scopes = range && chosen ? stepScopes(steps, hints, range.from, range.to, rowKey) : [];

    pick.replaceChildren(
      ...steps.map((step, index) => {
        const inRange = Boolean(range && index >= range.from && index <= range.to);
        return pickItem(step, index, inRange, scopes[index - (range?.from ?? 0)] ?? null);
      }),
    );

    rowSelect.replaceChildren(
      ...options.map((option) => new Option(loopOptionLabel(option, options), option.key)),
    );
    rowSelect.value = rowKey;
    rowField.hidden = options.length < 2;

    if (range && chosen) {
      const end = loopEnd(range);
      const span =
        range.from === end ? `手順 ${range.from + 1}` : `手順 ${range.from + 1}〜${end + 1}`;
      summary.replaceChildren(
        document.createTextNode('このページの一覧 '),
        strong(`${chosen.count} 件`),
        document.createTextNode(` で、${span} を 1 件ずつ行います。`),
      );
      if (naming.length > 0) {
        const name = document.createElement('small');
        name.className = 'd-block lm-sub';
        name.textContent =
          `保存するファイルの名前：${fileNameText()}（「」は 1 件ごとに読み取る文字）。` +
          '前回の実行で保存した同じ名前のファイルは上書きします。同じ実行の中で同じ名前になった場合は、番号を付けて別名で保存します。';
        summary.append(name);
        // 日付のように、複数の注文で同じ値になる文字だけでは、再実行のたびに番号付きのファイルが増えます（#179）。
        if (naming.length === 1) {
          const caution = document.createElement('small');
          caution.className = 'd-block lm-sub';
          caution.textContent =
            '選んだ文字が注文ごとに異なるか確かめてください。日付のように同じ値の注文がある文字だけでは、もう一度実行したときに番号付きのファイルが増えます。注文番号などを加えてください。';
          summary.append(caution);
        }
        summary.append(siteToggle());
      }
      if (paging !== null) {
        const pages = document.createElement('small');
        pages.className = 'd-block lm-sub';
        pages.textContent =
          `手順 ${paging + 1} のクリックで次のページへ送り、最後のページまで（最大 ${DEFAULT_MAX_PAGES} ページ）繰り返します。` +
          'このクリックは、繰り返しの中では行いません。';
        summary.append(pages);
      }
      if (scopes.includes('item')) {
        const note = document.createElement('small');
        note.className = 'd-block lm-sub';
        note.textContent = '「1 件の中」の手順は、その 1 件の枠の中で要素を探します。';
        summary.append(note);
      }
      summary.hidden = false;
      submit.textContent = paging === null ? `${chosen.count} 件で繰り返す` : '全ページで繰り返す';
      notice.hidden = true;
    } else {
      summary.hidden = true;
      submit.textContent = '繰り返す';
      showNotice(
        notice,
        range
          ? '印を付けた手順に、一覧の 1 件の中を操作した手順がありません。1 件目で押したボタンなどの手順に印を付けてください。'
          : '繰り返す手順に印を付けてください。',
        'error',
      );
    }
    submit.disabled = locked || !chosen;
  };

  const close = () => {
    container.hidden = true;
    list.hidden = false;
    open.hidden = !defaultLoopRange(steps, hints);
    notice.hidden = true;
  };

  open.addEventListener('click', () => {
    range = defaultLoopRange(steps, hints);
    if (!range) {
      return;
    }
    rowKey = '';
    naming = [];
    withSite = false;
    paging = null;
    draw();
    container.hidden = false;
    list.hidden = true;
    open.hidden = true;
    /** @type {HTMLInputElement | null} */ (pick.querySelector('input:not(:disabled)'))?.focus();
  });
  rowSelect.addEventListener('change', () => {
    rowKey = rowSelect.value;
    draw();
  });
  cancel.addEventListener('click', close);
  submit.addEventListener('click', async () => {
    if (!range) {
      return;
    }
    const { from, to } = range;
    const end = loopEnd(range);
    const nextPage = paging ?? undefined;
    submit.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        kind: 'recording/makeLoop',
        from,
        to,
        key: rowKey,
        names: naming,
        withSite,
        nextPage,
        count: steps.length,
      });
      if (!response?.ok) {
        showNotice(notice, response?.error ?? '繰り返しにできません。', 'error');
        return;
      }
      close();
      const span = from === end ? `手順 ${from + 1}` : `手順 ${from + 1}〜${end + 1}`;
      showToast(
        toast,
        nextPage === undefined
          ? `${span} を、一覧の 1 件ごとに繰り返す手順にしました。`
          : `${span} を、一覧の 1 件ごとに、最後のページまで繰り返す手順にしました。`,
      );
    } catch (error) {
      showNotice(notice, String(error), 'error');
    } finally {
      submit.disabled = locked || currentOptions().length === 0;
    }
  });

  container.hidden = true;
  open.hidden = true;

  return {
    update(nextSteps, nextHints, nextLocked, nextPagers) {
      const previousLength = steps.length;
      steps = nextSteps;
      locked = nextLocked;
      hints = nextSteps.map((_, index) => nextHints?.[index] ?? null);
      pagers = nextSteps.map((_, index) => nextPagers?.[index] ?? null);
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
      if (range && range.to >= steps.length) {
        // 手順が減った場合（別の画面で削除した場合など）は、既定の範囲に戻します。
        range = defaultLoopRange(steps, hints);
      } else if (range && steps.length > previousLength && range.to === previousLength - 1) {
        // 欄を開いている間に手順が増えた場合（記録中）、範囲の末尾が最後の手順なら、増えた手順も含めます。
        range = toggleRange(steps, range, steps.length - 1, true);
      }
      draw();
    },
  };
}

/**
 * @param {string} value
 * @returns {HTMLElement}
 */
function strong(value) {
  const element = document.createElement('strong');
  element.textContent = value;
  return element;
}
