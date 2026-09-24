// 記録中のタブのページで、利用者の操作を記録します。
//
// Service Worker が、記録を始めたときと、記録中にページを移動したときに、このスクリプトを
// ページへ読み込みます（chrome.scripting.executeScript）。読み込まれた時点で記録を始め、
// Service Worker から停止の連絡を受けると終了します。
// 記録した手順は Service Worker へ送り、ここでは保存しません。

/* global buildTarget */

(() => {
  /** 同じページに 2 回読み込まれた場合に、記録が二重にならないようにする目印です。 */
  const installedKey = '__lightomateRecorder';
  const scope = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
  if (scope[installedKey]) {
    return;
  }
  scope[installedKey] = true;

  /** 文字の入力として記録する input 要素の種類です。チェックボックスなどはクリックとして記録します。 */
  const textInputTypes = new Set([
    'text',
    'email',
    'search',
    'tel',
    'url',
    'number',
    'password',
    'date',
    'month',
    'week',
    'time',
    'datetime-local',
  ]);

  /** クリックの対象として扱う要素です。内側の文字や画像をクリックした場合も、この要素を記録します。 */
  const clickable =
    'a, button, input, label, summary, [role="button"], [role="link"], [role="menuitem"], ' +
    '[role="tab"], [role="checkbox"], [role="radio"], [onclick]';

  const overlay = showOverlay();

  /** @param {MouseEvent} event */
  const onClick = (event) => {
    // ページのスクリプトが発生させた操作（element.click() など）は記録しません（#14）。
    if (!event.isTrusted || !(event.target instanceof Element)) {
      return;
    }
    const element = event.target.closest(clickable) ?? event.target;
    if (isTextEntry(element) || element === document.body || element === document.documentElement) {
      // 入力欄へのクリックは、入力の準備にすぎないため記録しません。値は change で記録します。
      return;
    }
    send({ type: 'click', target: buildTarget(element) });
  };

  /** @param {Event} event */
  const onChange = (event) => {
    if (!event.isTrusted) {
      return;
    }
    const element = event.target;

    if (element instanceof HTMLSelectElement) {
      const options = Array.from(element.selectedOptions);
      send({
        type: 'select',
        target: buildTarget(element),
        values: options.map((option) => option.value),
        labels: options.map((option) => option.label),
      });
      return;
    }

    if (
      (element instanceof HTMLInputElement && textInputTypes.has(element.type)) ||
      element instanceof HTMLTextAreaElement
    ) {
      // パスワード、カード番号、確認コードの値は記録しません。保存した JSON から漏れるためです（#14）。
      send(
        isSecret(element)
          ? { type: 'input', target: buildTarget(element), secret: true }
          : { type: 'input', target: buildTarget(element), value: element.value },
      );
    }
  };

  // 取り込み（capture）の段階で受け取ります。ページが操作の伝わりを止めても記録できるようにするためです。
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.kind !== 'recorder/stop') {
      return;
    }
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    overlay.remove();
    scope[installedKey] = false;
  });

  /**
   * 手順を Service Worker へ送ります。
   * @param {object} step
   */
  function send(step) {
    chrome.runtime.sendMessage({ kind: 'recording/step', step }).catch(() => {
      // 拡張機能を再読み込みした後など、Service Worker と接続できない場合は記録を続けられません。
      overlay.remove();
    });
  }

  /**
   * @param {Element} element
   * @returns {boolean}
   */
  function isTextEntry(element) {
    return (
      (element instanceof HTMLInputElement && textInputTypes.has(element.type)) ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLOptionElement ||
      (element instanceof HTMLElement && element.isContentEditable)
    );
  }

  /**
   * 値を記録しない入力欄かを判定します。
   * @param {HTMLInputElement | HTMLTextAreaElement} element
   * @returns {boolean}
   */
  function isSecret(element) {
    if (element instanceof HTMLInputElement && element.type === 'password') {
      return true;
    }
    const autocomplete = (element.getAttribute('autocomplete') ?? '').toLowerCase();
    return /(^|\s)(cc-|one-time-code)/.test(autocomplete);
  }

  /**
   * 記録中であることを示す赤い枠と「記録中」の表示を、ページの最前面に置きます（#13）。
   * ページの CSS やスクリプトの影響を受けないよう、閉じた Shadow DOM の中に置きます。
   * クリックは枠を通り抜けるため、ページの操作を妨げず、枠への操作が記録されることもありません。
   * 印刷用の表示では非表示にし、PDF に写り込まないようにします。
   * @returns {HTMLElement}
   */
  function showOverlay() {
    const host = document.createElement('lightomate-recording');
    host.style.cssText =
      'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { pointer-events: none; }
      .frame {
        position: fixed; inset: 0; box-sizing: border-box;
        border: 4px solid #d93025; pointer-events: none;
      }
      .badge {
        position: fixed; top: 8px; left: 8px; padding: 4px 10px; border-radius: 4px;
        background: #d93025; color: #fff; pointer-events: none;
        font: bold 13px/1.4 system-ui, sans-serif;
      }
      /* 要素に直接指定したスタイル（all: initial）より優先させるため、!important を付けます。 */
      @media print { :host { display: none !important; } }
    `;
    const frame = document.createElement('div');
    frame.className = 'frame';
    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = '● 記録中（Lightomate）';

    shadow.append(style, frame, badge);
    document.documentElement.append(host);
    return host;
  }
})();
