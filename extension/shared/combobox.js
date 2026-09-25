// 入力欄の下に候補を出す部品（combobox）です（#42）。chrome.* は使いません。
// WAI-ARIA の Combobox パターン（リストの自動補完）に従います。
// https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
// HTML 標準の <datalist> は使いません。Chrome は候補を独自に部分一致で絞り込むため、
// 前方一致と後方一致の指定が候補に反映されないためです。

/**
 * 候補の 1 件です。
 * @typedef {object} ComboboxOption
 * @property {string} value 選んだときに入力欄に入れる文字列
 * @property {string} [note] 候補の右に小さく表示する説明（例：「フロー」「サイト」）
 */

/**
 * 入力欄に候補の一覧を付けます。
 * 入力するたびに getOptions で候補を作り直します。↑・↓で移動、Enter で決定、Esc で閉じます。
 * 候補を選ぶと、入力欄にその文字列を入れ、onSelect を呼びます。
 * @param {HTMLInputElement} input
 * @param {HTMLElement} listbox 候補を並べる要素。入力欄の直後に置きます
 * @param {{ getOptions: () => ComboboxOption[], onSelect: (value: string) => void }} handlers
 * @returns {{ close: () => void }}
 */
export function attachCombobox(input, listbox, { getOptions, onSelect }) {
  const document = input.ownerDocument;
  const idPrefix = `${listbox.id || 'combobox'}-option-`;
  /** @type {ComboboxOption[]} */
  let options = [];
  let active = -1;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', listbox.id);
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';
  listbox.setAttribute('role', 'listbox');
  listbox.hidden = true;

  function render() {
    listbox.replaceChildren(
      ...options.map((option, index) => {
        const item = document.createElement('li');
        item.id = `${idPrefix}${index}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(index === active));
        item.className = index === active ? 'lm-option active' : 'lm-option';
        const text = document.createElement('span');
        text.className = 'lm-option-text';
        text.textContent = option.value;
        item.append(text);
        if (option.note) {
          const note = document.createElement('span');
          note.className = 'lm-option-note';
          note.textContent = option.note;
          item.append(note);
        }
        // 入力欄からフォーカスを移さないよう、押した時点では選ばず、既定の動作を止めます。
        item.addEventListener('mousedown', (event) => event.preventDefault());
        item.addEventListener('click', () => choose(index));
        return item;
      }),
    );
    const open = options.length > 0;
    listbox.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `${idPrefix}${active}`);
      listbox.children[active]?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function refresh() {
    options = getOptions();
    active = -1;
    render();
  }

  function close() {
    options = [];
    active = -1;
    render();
  }

  /** @param {number} index */
  function choose(index) {
    const option = options[index];
    if (!option) {
      return;
    }
    input.value = option.value;
    close();
    onSelect(option.value);
  }

  input.addEventListener('input', refresh);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (options.length === 0) {
          options = getOptions();
        }
        if (options.length === 0) {
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        active =
          active < 0 && step < 0
            ? options.length - 1
            : (active + step + options.length) % options.length;
        render();
        return;
      }
      case 'Enter':
        if (active >= 0) {
          event.preventDefault();
          choose(active);
        }
        return;
      case 'Escape':
        if (options.length > 0) {
          event.preventDefault();
          close();
        }
        return;
      default:
    }
  });

  return { close };
}
