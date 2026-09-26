// 記録中のタブのページで、利用者の操作を記録します。
//
// 読み込む順序は selector.js、overlay.js、element-text.js、recorder.js です（background/recording.js）。
// Service Worker が、記録を始めたときと、記録中にページを移動したときに、このスクリプトを
// ページへ読み込みます（chrome.scripting.executeScript）。読み込まれた時点で記録を始め、
// Service Worker から停止の連絡を受けると終了します。
// 記録した手順は Service Worker へ送り、ここでは保存しません。

/* global buildTarget, elementKeys, elementTexts, isPageTranslated, matchStopSelector, showNotice, showStatusOverlay */

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

  const overlay = showStatusOverlay('● 記録中（Lightomate）', '#d93025', '#fff');

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
    // 確定ボタンかどうかを Service Worker が判定できるよう、要素の文言も送ります（#29）。
    // サイトごとの止める要素の指定（#54）は、Service Worker がこのスクリプトより先に置きます。
    send(
      { type: 'click', target: buildTarget(element) },
      elementTexts(element),
      matchStopSelector(event.target, scope.__lightomateStopSelectors),
      elementKeys(element),
    );
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

  /**
   * Service Worker からの知らせを受け取ります。
   * @param {any} message
   * @param {chrome.runtime.MessageSender} sender
   */
  function onMessage(message, sender) {
    if (sender.id !== chrome.runtime.id) {
      return;
    }
    if (message?.kind === 'recorder/notice' && typeof message.text === 'string') {
      showNotice(message.text);
      return;
    }
    if (message?.kind !== 'recorder/stop') {
      return;
    }
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    overlay.remove();
    // 受け取りをやめます。残したまま同じページで記録を始め直すと、受け取りが増えるためです（#82）。
    chrome.runtime.onMessage.removeListener(onMessage);
    scope[installedKey] = false;
  }

  chrome.runtime.onMessage.addListener(onMessage);

  /**
   * 手順を Service Worker へ送ります。
   * @param {object} step
   * @param {string[]} [texts] クリックした要素の文言
   * @param {string} [matchedSelector] クリックした要素が一致した、止める要素の指定
   * @param {string[]} [keys] クリックした要素の、翻訳で変わらない手がかり（#97）
   */
  function send(step, texts, matchedSelector, keys) {
    // 記録したときにページが翻訳されていたことを残します。実行時に見つからなかった場合の説明に使います（#99）。
    const recorded = isPageTranslated() ? { ...step, translated: true } : step;
    chrome.runtime
      .sendMessage({ kind: 'recording/step', step: recorded, texts, matchedSelector, keys })
      .catch(() => {
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
})();
