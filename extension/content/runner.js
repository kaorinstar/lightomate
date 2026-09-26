// フローを実行中のタブのページで、Service Worker から届いた手順を 1 つずつ実行します。
//
// 読み込む順序は overlay.js、finder.js、element-text.js、runner.js です（background/runner.js）。
// Service Worker が手順ごとに読み込みます。同じページに 2 回読み込まれても、受け取りは 1 つだけです。
// どの手順を実行するかは Service Worker が決めます。このスクリプトは、届いた手順を実行するだけです。

/* global elementTexts, findAllTargets, matchStopSelector, searchRoot, showStatusOverlay, waitForTarget */

(() => {
  const installedKey = '__lightomateRunner';
  const scope = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
  if (scope[installedKey]) {
    return;
  }
  scope[installedKey] = true;

  /**
   * ページの枠と左上の文字です。
   * 実行中は黄色で示します。青は画面の配色に紛れて気付きにくかったためです。
   * 黄色の上では白い文字が読みにくいため、文字は黒にします。
   * 一時停止中と、以降を人が操作する場合は、黄色や記録中の赤と区別できる紫で示します（#13、#37）。
   * @type {Record<'running' | 'paused' | 'handOver', [string, string, string]>}
   */
  const indicators = {
    running: ['▶ 実行中（Lightomate）', '#fbbc04', '#202124'],
    paused: ['⏸ 一時停止中（Lightomate）', '#8e24aa', '#ffffff'],
    handOver: ['■ 停止：ここから手で操作してください（Lightomate）', '#8e24aa', '#ffffff'],
  };

  /** 1 行目の目印として返す長さの上限です（#95）。比べるだけのため、全文は要りません。 */
  const FIRST_KEY_MAX_LENGTH = 500;

  let overlay = showStatusOverlay(...indicators.running);

  /**
   * 枠と文字を、指定した表示に置き換えます。
   * @param {unknown} name
   */
  function showIndicator(name) {
    if (name === 'running' || name === 'paused' || name === 'handOver') {
      overlay.remove();
      overlay = showStatusOverlay(...indicators[name]);
    }
  }

  /** 実行中の手順で要素を待つ処理を止めるためのものです。停止を指示されたときに使います。 */
  let currentStep = new AbortController();

  /**
   * クリックの前に確かめた要素です（#29）。Service Worker が文言を確かめて確定ボタンでないと
   * 判定した後、探し直さずにこの要素をクリックします。確かめた要素と押す要素が食い違わないためです。
   * @type {Element | null}
   */
  let inspected = null;

  /**
   * Service Worker からの依頼を受け取ります。
   * @param {any} message
   * @param {chrome.runtime.MessageSender} sender
   * @param {(response?: unknown) => void} sendResponse
   * @returns {boolean} 応答を後で返す場合は true
   */
  function onMessage(message, sender, sendResponse) {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }
    if (message?.kind === 'runner/abort') {
      currentStep.abort();
      return false;
    }
    // PDF を画面の表示で作る間（#73）、枠と文字が PDF に写らないよう隠します。
    // 印刷用の表示では @media print で隠れますが、画面の表示では隠れないためです。
    if (message?.kind === 'runner/overlay') {
      overlay.style.display = message.hidden ? 'none' : '';
      sendResponse({ ok: true });
      return false;
    }
    if (message?.kind === 'runner/indicator') {
      showIndicator(message.indicator);
      return false;
    }
    if (message?.kind === 'runner/finish') {
      // 確定ボタンの手前などで終えた場合は、以降を人が操作することを示す表示を残します（#13）。
      // ページを移動すると、このスクリプトとともに消えます。
      if (message.indicator === 'handOver') {
        showIndicator('handOver');
      } else {
        overlay.remove();
      }
      // 受け取りをやめます。残したまま次の実行でこのスクリプトが読み込まれると、受け取りが増え、
      // 1 つの手順を受け取りの数だけ行うためです（#82）。
      chrome.runtime.onMessage.removeListener(onMessage);
      scope[installedKey] = false;
      return false;
    }
    if (message?.kind === 'runner/authSignals') {
      sendResponse({ ok: true, signals: authSignals() });
      return false;
    }
    if (message?.kind === 'runner/inspect') {
      inspect(message.step, message.scope, message.timeoutMs, message.stopSelectors).then(
        sendResponse,
        (error) => sendResponse({ ok: false, error: String(error) }),
      );
      return true;
    }
    if (message?.kind === 'runner/exists') {
      exists(message.target, message.scope, message.timeoutMs).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;
    }
    if (message?.kind === 'runner/count') {
      countItems(message.items, message.scope, message.timeoutMs).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;
    }
    if (message?.kind !== 'runner/step') {
      return false;
    }
    runStep(message.step, message.scope, message.timeoutMs).then(sendResponse, (error) =>
      sendResponse({ ok: false, error: String(error) }),
    );
    return true;
  }

  chrome.runtime.onMessage.addListener(onMessage);

  /**
   * クリックする要素を探し、押さずに、その要素の文言と、止める要素の指定に一致したかを返します。
   * @param {{ target: { selectors: string[], tag: string, text?: string, scope?: string } }} step
   * @param {unknown} scope 繰り返しで処理中の行の指定（#6）
   * @param {number} timeoutMs 要素を待つ上限（ミリ秒）
   * @param {unknown} stopSelectors サイトごとの止める要素の指定（#54）
   * @returns {Promise<{ ok: true, texts: string[], matchedSelector?: string } | { ok: false, error: string, notFound?: true }>}
   */
  async function inspect(step, scope, timeoutMs, stopSelectors) {
    inspected = null;
    const found = await findElement(step.target, scope, timeoutMs);
    if (!found.ok) {
      return found;
    }
    inspected = found.element;
    return {
      ok: true,
      texts: elementTexts(found.element),
      matchedSelector: matchStopSelector(found.element, stopSelectors),
    };
  }

  /**
   * 手順の要素を探します。
   * @param {{ selectors: string[], tag: string, text?: string, scope?: string }} target
   * @param {unknown} scope 繰り返しで処理中の行の指定（#6）
   * @param {number} timeoutMs
   * @returns {Promise<{ ok: true, element: Element } | { ok: false, error: string, notFound?: true }>}
   */
  async function findElement(target, scope, timeoutMs) {
    const base = searchRoot(target, scope);
    if (!base.ok) {
      // 行が見つからない場合も、表示の遅れの可能性があるため、やり直してよいことにします。
      return { ok: false, notFound: true, error: base.error };
    }
    currentStep = new AbortController();
    const element = await waitForTarget(target, timeoutMs, currentStep.signal, base.root);
    if (currentStep.signal.aborted) {
      return { ok: false, error: '停止を指示されました。' };
    }
    if (!element) {
      // notFound は、Service Worker がこの手順をやり直してよいことを示します（#18）。
      return {
        ok: false,
        notFound: true,
        error: `要素が見つかりません（${Math.round(timeoutMs / 1000)} 秒待ちました）。`,
      };
    }
    return { ok: true, element };
  }

  /**
   * if の条件の要素があるかを調べます（#6）。ページは変更しません。
   * 要素がない場合は、上限の時間まで待ってから、ないと判定します。
   * @param {{ selectors: string[], tag: string, text?: string, scope?: string }} target
   * @param {unknown} scope 繰り返しで処理中の行の指定
   * @param {number} timeoutMs 要素を待つ上限（ミリ秒）
   * @returns {Promise<{ ok: true, exists: boolean } | { ok: false, error: string, notFound?: true }>}
   */
  async function exists(target, scope, timeoutMs) {
    const base = searchRoot(target, scope);
    if (!base.ok) {
      return { ok: false, notFound: true, error: base.error };
    }
    currentStep = new AbortController();
    const element = await waitForTarget(target, timeoutMs, currentStep.signal, base.root);
    if (currentStep.signal.aborted) {
      return { ok: false, error: '停止を指示されました。' };
    }
    return { ok: true, exists: element !== null };
  }

  /**
   * forEach の行の数を数えます（#6）。ページは変更しません。
   * 行が 1 つも見つからない場合は、上限の時間まで待ってから 0 件と判定します。
   * @param {{ selectors: string[], tag: string, text?: string, scope?: string }} items
   * @param {unknown} scope 外側の繰り返しで処理中の行の指定
   * @param {number} timeoutMs 行を待つ上限（ミリ秒）
   * @returns {Promise<{ ok: true, count: number, firstKey?: string } | { ok: false, error: string, notFound?: true }>}
   *   firstKey は 1 行目の目印です（rowKey）。「次へ」のクリックの後に一覧が差し替わったか、一覧のページへ
   *   戻った後に同じ一覧かを判定するために使います（#95）
   */
  async function countItems(items, scope, timeoutMs) {
    const base = searchRoot(items, scope);
    if (!base.ok) {
      return { ok: false, notFound: true, error: base.error };
    }
    currentStep = new AbortController();
    const first = await waitForTarget(
      { ...items, text: undefined },
      timeoutMs,
      currentStep.signal,
      base.root,
    );
    if (currentStep.signal.aborted) {
      return { ok: false, error: '停止を指示されました。' };
    }
    const rows = first ? findAllTargets(items, base.root) : [];
    return {
      ok: true,
      count: rows.length,
      firstKey: rows.length > 0 ? rowKey(rows[0]) : undefined,
    };
  }

  /**
   * 行の目印です（#95）。行の中のリンク先（a 要素の href の値）を並べたものです。リンクがない行では、
   * 画像の src の値を並べます。どちらもない行では undefined を返し、行数だけで確かめてもらいます。
   * 表示の文字は使いません。Chrome の翻訳などが表示の後に文字を置き換えるため、同じ一覧でも読み取った時点に
   * よって文字が異なるためです。href と src の値は、翻訳では変わりません。
   * @param {Element} row
   * @returns {string | undefined}
   */
  function rowKey(row) {
    /**
     * @param {string} selector
     * @param {string} name
     */
    const values = (selector, name) =>
      [row, ...row.querySelectorAll(selector)]
        .filter((element) => element.matches(selector))
        .map((element) => element.getAttribute(name) ?? '');
    const links = values('a[href]', 'href');
    if (links.length > 0) {
      return `link:${links.join(' ')}`.slice(0, FIRST_KEY_MAX_LENGTH);
    }
    const images = values('img[src]', 'src');
    if (images.length > 0) {
      return `image:${images.join(' ')}`.slice(0, FIRST_KEY_MAX_LENGTH);
    }
    return undefined;
  }

  /**
   * 手順を 1 つ実行します。
   * @param {{ type: string, target: { selectors: string[], tag: string, text?: string, scope?: string }, value?: string, values?: string[], labels?: string[] }} step
   *   値の中のパラメータは、Service Worker で置き換え済みです。
   * @param {unknown} scope 繰り返しで処理中の行の指定（#6）
   * @param {number} timeoutMs 要素を待つ上限（ミリ秒）
   * @returns {Promise<{ ok: true, text?: string } | { ok: false, error: string, notFound?: true }>}
   */
  async function runStep(step, scope, timeoutMs) {
    /** @type {Element} */
    let element;
    if (step.type === 'click') {
      // クリックは、文言を確かめた要素だけに行います。確かめていない要素は押しません（#29）。
      const checked = inspected;
      inspected = null;
      if (!checked?.isConnected) {
        return {
          ok: false,
          error:
            'クリックの前に確かめた要素が、ページから消えました。安全のため、クリックしません。',
        };
      }
      element = checked;
    } else {
      const found = await findElement(step.target, scope, timeoutMs);
      if (!found.ok) {
        return found;
      }
      element = found.element;
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

      case 'extract':
        // 読み取るだけで、ページは変更しません（#16）。入力欄と選択肢は、表示している値を読み取ります。
        return { ok: true, text: readText(element) };

      default:
        return { ok: false, error: `この手順の種類（${step.type}）はページでは実行できません。` };
    }
  }

  /**
   * ページに、認証の画面の印があるかを調べます（#18）。ページは変更しません。
   * 止めるかどうかは、この結果と URL をもとに Service Worker が判定します（shared/run-guard.js）。
   * 画像認証は、表示されている枠だけを数えます。見えない reCAPTCHA（size=invisible）は、多くのページに
   * 常に置かれているため除きます。
   * @returns {{ password: boolean, oneTimeCode: boolean, captcha: boolean, loginForm: boolean }}
   */
  function authSignals() {
    const visible = (/** @type {Element} */ element) => {
      if (element.getClientRects().length === 0) {
        return false;
      }
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const any = (/** @type {string} */ selector) =>
      [...document.querySelectorAll(selector)].some(visible);
    return {
      password: any('input[type="password"]'),
      oneTimeCode: any('input[autocomplete~="one-time-code"]'),
      captcha: [
        ...document.querySelectorAll(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"]',
        ),
      ].some(
        (frame) => visible(frame) && !/[?&]size=invisible/.test(frame.getAttribute('src') ?? ''),
      ),
      // パスワードを次の画面で尋ねるサイト（Amazon など）の、ログインの ID の入力欄です。
      loginForm:
        any('input[autocomplete~="username"]') ||
        [...document.querySelectorAll('form')].some(
          (form) =>
            /sign[-_]?in|log[-_]?in/i.test(
              `${form.id} ${form.getAttribute('name') ?? ''} ${form.getAttribute('action') ?? ''}`,
            ) &&
            [
              ...form.querySelectorAll(
                'input[type="email"], input[type="text"], input:not([type])',
              ),
            ].some(visible),
        ),
    };
  }

  /**
   * 要素の表示文字列を、空白をまとめて 1 行にして返します。
   * @param {Element} element
   * @returns {string}
   */
  function readText(element) {
    const raw =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value
        : element instanceof HTMLSelectElement
          ? (element.selectedOptions[0]?.label ?? '')
          : element instanceof HTMLElement
            ? element.innerText
            : (element.textContent ?? '');
    return raw.replace(/\s+/g, ' ').trim();
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
