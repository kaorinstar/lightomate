// フローを実行中のタブのページで、Service Worker から届いた手順を 1 つずつ実行します。
//
// 読み込む順序は overlay.js、finder.js、runner.js です（background/runner.js）。
// Service Worker が手順ごとに読み込みます。同じページに 2 回読み込まれても、受け取りは 1 つだけです。
// どの手順を実行するかは Service Worker が決めます。このスクリプトは、届いた手順を実行するだけです。

/* global showStatusOverlay, waitForTarget */

(() => {
  const installedKey = '__lightomateRunner';
  const scope = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
  if (scope[installedKey]) {
    return;
  }
  scope[installedKey] = true;

  // 実行中は黄色で示します。青は画面の配色に紛れて気付きにくかったためです。
  // 黄色の上では白い文字が読みにくいため、文字は黒にします。
  const overlay = showStatusOverlay('▶ 実行中（Lightomate）', '#fbbc04', '#202124');

  /** 実行中の手順で要素を待つ処理を止めるためのものです。停止を指示されたときに使います。 */
  let currentStep = new AbortController();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }
    if (message?.kind === 'runner/abort') {
      currentStep.abort();
      return false;
    }
    if (message?.kind === 'runner/finish') {
      overlay.remove();
      scope[installedKey] = false;
      return false;
    }
    if (message?.kind !== 'runner/step') {
      return false;
    }
    runStep(message.step, message.timeoutMs).then(sendResponse, (error) =>
      sendResponse({ ok: false, error: String(error) }),
    );
    return true;
  });

  /**
   * 手順を 1 つ実行します。
   * @param {{ type: string, target: { selectors: string[], tag: string, text?: string }, value?: string, values?: string[], labels?: string[] }} step
   *   値の中のパラメータは、Service Worker で置き換え済みです。
   * @param {number} timeoutMs 要素を待つ上限（ミリ秒）
   * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
   */
  async function runStep(step, timeoutMs) {
    currentStep = new AbortController();
    const element = await waitForTarget(step.target, timeoutMs, currentStep.signal);
    if (currentStep.signal.aborted) {
      return { ok: false, error: '停止を指示されました。' };
    }
    if (!element) {
      return {
        ok: false,
        error: `要素が見つかりません（${Math.round(timeoutMs / 1000)} 秒待ちました）。`,
      };
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });

    switch (step.type) {
      case 'click':
        // クリックでページを移動すると、このスクリプトは応答する前に失われます。
        // そのため、先に応答してからクリックします。
        setTimeout(() => {
          if (element instanceof HTMLElement) {
            element.click();
          } else {
            element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          }
        }, 0);
        return { ok: true };

      case 'input':
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          return { ok: false, error: '見つかった要素が入力欄ではありません。' };
        }
        element.focus();
        setNativeValue(element, step.value ?? '');
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.blur();
        return { ok: true };

      case 'select':
        return selectOptions(element, step.values ?? [], step.labels ?? []);

      default:
        return { ok: false, error: `この手順の種類（${step.type}）はページでは実行できません。` };
    }
  }

  /**
   * 入力欄の値を設定します。
   * React などの画面の部品は value の設定を独自に監視しているため、要素の種類が持つ本来の
   * 設定処理を呼び出し、画面の部品にも値の変更が伝わるようにします。
   * @param {HTMLInputElement | HTMLTextAreaElement} element
   * @param {string} value
   */
  function setNativeValue(element, value) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
  }

  /**
   * 選択肢を選びます。value で見つからない選択肢は、表示文字列で探します。
   * @param {Element} element
   * @param {string[]} values
   * @param {string[]} labels
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  function selectOptions(element, values, labels) {
    if (!(element instanceof HTMLSelectElement)) {
      return { ok: false, error: '見つかった要素が選択肢ではありません。' };
    }
    const options = Array.from(element.options);
    const chosen = values.map(
      (value, index) =>
        options.find((option) => option.value === value) ??
        options.find((option) => option.label === labels[index]),
    );
    const missing = chosen.findIndex((option) => !option);
    if (missing >= 0) {
      return { ok: false, error: `選択肢「${labels[missing] ?? values[missing]}」がありません。` };
    }
    element.focus();
    for (const option of options) {
      option.selected = chosen.includes(option);
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
    return { ok: true };
  }
})();
