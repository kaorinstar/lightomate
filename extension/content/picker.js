// 要素の選択モード（#139）です。管理画面のブロックの［ページで選ぶ］から始まり、利用者がページの上で押した
// 要素の指定を Service Worker へ送ります。
//
// 読み込む順序は selector.js、picker-rows.js、picker.js です（background/picker.js）。
// Service Worker が、このスクリプトより先に設定（globalThis.__lightomatePicker）を置きます。
//
// 選択モードの間は、押す操作をページに伝えません。リンクの移動やボタンの動作を起こさないためです。
// 操作は window の捕獲段階で受け取り、ページのスクリプトより先に止めます。利用者の操作（isTrusted）だけを扱います。

/* global buildInnerTarget, buildPageTarget, buildRowsTarget, containingRow, resolveRows */

(() => {
  const scope = /** @type {Record<string, any>} */ (/** @type {unknown} */ (globalThis));
  /** @type {{ requestId: string, mode: 'element' | 'rows', chain: { selectors: string[], tag: string, label: string, scope?: string }[] }} */
  const config = scope.__lightomatePicker;
  if (!config) {
    return;
  }
  // 前の選択モードが残っている場合は、先に終わらせます。
  scope.__lightomatePickerStop?.();

  /** 押した要素のうち、操作の対象として扱う要素です。内側の文字や画像を押した場合も、この要素を選びます。 */
  const clickable =
    'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], ' +
    '[role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"]';

  // ---- 表示 ----
  // ページの CSS やスクリプトの影響を受けないよう、閉じた Shadow DOM の中に置きます（overlay.js と同じ）。
  const host = document.createElement('lightomate-picker');
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { pointer-events: none; }
    .frame { position: fixed; inset: 0; box-sizing: border-box; border: 4px solid #1a73e8; }
    .bar {
      position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
      display: flex; gap: 12px; align-items: center; max-width: min(92vw, 720px);
      padding: 8px 12px; border-radius: 6px; background: #1a73e8; color: #fff;
      font: 14px/1.5 system-ui, sans-serif; box-shadow: 0 2px 8px rgb(0 0 0 / 35%);
      pointer-events: auto;
    }
    .bar p { margin: 0; }
    .buttons { display: flex; gap: 8px; flex: none; }
    button {
      min-height: 32px; padding: 4px 12px; border: 1px solid #fff; border-radius: 4px;
      background: #fff; color: #174ea6; font: bold 13px/1.4 system-ui, sans-serif; cursor: pointer;
    }
    button.secondary { background: transparent; color: #fff; }
    button:focus-visible { outline: 3px solid #fbbc04; outline-offset: 2px; }
    .box {
      position: fixed; box-sizing: border-box; border: 2px solid #d93025;
      background: rgb(217 48 37 / 12%); pointer-events: none;
    }
    .box.row { border-color: #188038; background: rgb(24 128 56 / 12%); }
    @media print { :host { display: none !important; } }
  `;
  const frame = document.createElement('div');
  frame.className = 'frame';
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', 'Lightomate の要素の選択');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  bar.append(message, buttons);
  const hover = document.createElement('div');
  hover.className = 'box';
  hover.hidden = true;
  const rowBoxes = document.createElement('div');
  shadow.append(style, frame, rowBoxes, hover, bar);
  document.documentElement.append(host);

  /** 行の確認中の候補です。確認中は、ページを押しても選び直しません。 */
  /** @type {{ items: object, rows: Element[] } | null} */
  let pending = null;

  /**
   * 案内の文とボタンを表示し直します。
   * @param {string} text
   * @param {{ label: string, onClick: () => void, secondary?: boolean }[]} actions
   */
  const showBar = (text, actions) => {
    message.textContent = text;
    buttons.replaceChildren(
      ...actions.map(({ label, onClick, secondary }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (secondary) {
          button.className = 'secondary';
        }
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          onClick();
        });
        return button;
      }),
    );
  };

  const guide =
    config.mode === 'rows'
      ? '繰り返す一覧の、どれか 1 行（行の中の要素でも構いません）を押してください。'
      : '指定する要素を押してください。Tab キーで移動して Enter キーでも選べます。';
  const showGuide = () =>
    showBar(`Lightomate：${guide}（Esc キーで取り消し）`, [
      { label: '取り消し', onClick: () => finish({ cancelled: true }), secondary: true },
    ]);
  showGuide();

  /**
   * 要素の位置に枠を置きます。
   * @param {HTMLElement} box
   * @param {Element} element
   */
  const place = (box, element) => {
    const rect = element.getBoundingClientRect();
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  };

  /** 確認中の行すべてを枠で囲みます。スクロールしたときにも置き直します。 */
  const placeRows = () => {
    const rows = pending?.rows ?? [];
    rowBoxes.replaceChildren(
      ...rows.map((row) => {
        const box = document.createElement('div');
        box.className = 'box row';
        place(box, row);
        return box;
      }),
    );
  };

  // ---- 操作 ----

  /**
   * 選択モードの表示の上の操作かを判定します。案内のボタンは止めずに動かします。
   * @param {Event} event
   */
  const onOwnUi = (event) => event.composedPath().includes(host);

  /**
   * 押した要素から、選ぶ要素を決めます。
   * @param {Element} element
   * @returns {Element}
   */
  const pickable = (element) => element.closest(clickable) ?? element;

  /** @param {Event} event */
  const block = (event) => {
    if (!event.isTrusted || onOwnUi(event)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  /** @param {MouseEvent} event */
  const onClick = (event) => {
    if (!event.isTrusted || onOwnUi(event)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.button !== 0 || pending || !(event.target instanceof Element)) {
      return;
    }
    choose(event.target);
  };

  /** @param {KeyboardEvent} event */
  const onKeyDown = (event) => {
    if (!event.isTrusted) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      finish({ cancelled: true });
      return;
    }
    if (event.key !== 'Enter' || onOwnUi(event)) {
      return;
    }
    // Enter キーでは、フォーカスのある要素を選びます。リンクの移動やフォームの送信は起こしません。
    event.preventDefault();
    event.stopImmediatePropagation();
    const active = document.activeElement;
    if (!pending && active && active !== document.body && active !== document.documentElement) {
      choose(active);
    }
  };

  /** @param {PointerEvent} event */
  const onPointerMove = (event) => {
    if (pending || onOwnUi(event) || !(event.target instanceof Element)) {
      hover.hidden = true;
      return;
    }
    hover.hidden = false;
    place(hover, config.mode === 'rows' ? event.target : pickable(event.target));
  };

  /**
   * 選んだ要素から、指定を作ります。
   * @param {Element} target
   */
  const choose = (target) => {
    const levels = resolveRows(config.chain);
    if (config.mode === 'rows') {
      // 繰り返しの中の繰り返しでは、外側の行の内側で行を探します。
      /** @type {Document | Element | null} */
      const root = config.chain.length > 0 ? containingRow(target, levels) : document;
      if (!root) {
        showBar('Lightomate：外側の繰り返しの行の中を押してください。（Esc キーで取り消し）', [
          { label: '取り消し', onClick: () => finish({ cancelled: true }), secondary: true },
        ]);
        return;
      }
      const result = buildRowsTarget(target, root);
      if (!result) {
        showBar(
          'Lightomate：同じ形の行が見つかりません。一覧の別の行か、行の中の別の場所を押してください。（Esc キーで取り消し）',
          [{ label: '取り消し', onClick: () => finish({ cancelled: true }), secondary: true }],
        );
        return;
      }
      pending = result;
      hover.hidden = true;
      placeRows();
      showBar(
        `Lightomate：同じ形の行が ${result.rows.length} 件見つかりました。繰り返す行すべてが緑の枠で囲まれていますか。`,
        [
          {
            label: 'はい、この行にする',
            onClick: () => finish({ items: result.items, count: result.rows.length }),
          },
          {
            label: 'いいえ、選び直す',
            onClick: () => {
              pending = null;
              rowBoxes.replaceChildren();
              showGuide();
            },
            secondary: true,
          },
        ],
      );
      buttons.querySelector('button')?.focus();
      return;
    }
    const element = pickable(target);
    // 繰り返しの中のブロックでは、行の内側を押した場合に、行を基準にした指定（scope: item）にします。
    const row = config.chain.length > 0 ? containingRow(element, levels) : null;
    finish({ target: row ? buildInnerTarget(element, row) : buildPageTarget(element) });
  };

  const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick'];
  for (const type of events) {
    window.addEventListener(type, block, true);
  }
  window.addEventListener('contextmenu', block, true);
  window.addEventListener('submit', block, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('scroll', placeRows, true);
  window.addEventListener('resize', placeRows);

  /** 選択モードを終え、表示と受け取りを片付けます。 */
  const stop = () => {
    for (const type of events) {
      window.removeEventListener(type, block, true);
    }
    window.removeEventListener('contextmenu', block, true);
    window.removeEventListener('submit', block, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('scroll', placeRows, true);
    window.removeEventListener('resize', placeRows);
    chrome.runtime.onMessage.removeListener(onMessage);
    host.remove();
    if (scope.__lightomatePickerStop === stop) {
      delete scope.__lightomatePickerStop;
    }
  };
  scope.__lightomatePickerStop = stop;

  /**
   * 結果を Service Worker へ送り、選択モードを終えます。
   * @param {object} result
   */
  const finish = (result) => {
    stop();
    chrome.runtime
      .sendMessage({ kind: 'picker/result', requestId: config.requestId, result })
      .catch(() => {
        // 拡張機能を再読み込みした後などは、結果を届けられません。表示は片付けてあります。
      });
  };

  /**
   * Service Worker から、選択モードを終える知らせ（管理画面を閉じた場合など）を受け取ります。
   * @param {any} received
   * @param {chrome.runtime.MessageSender} sender
   */
  function onMessage(received, sender) {
    if (sender.id === chrome.runtime.id && received?.kind === 'picker/stop') {
      stop();
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);
})();
