// 記録中のタブのページで、利用者の操作を記録します。
//
// 読み込む順序は selector.js、overlay.js、element-text.js、picker-rows.js、recorder.js です（background/recording.js）。
// Service Worker が、記録を始めたときと、記録中にページを移動したときに、このスクリプトを
// ページへ読み込みます（chrome.scripting.executeScript）。読み込まれた時点で記録を始め、
// Service Worker から停止の連絡を受けると終了します。
// 記録した手順は Service Worker へ送り、ここでは保存しません。

/* global buildTarget, elementKeys, elementTexts, isPageTranslated, matchStopSelector, pagerSelectors, rowCandidates, shadowRootOf, showNotice, showStatusOverlay */

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

  /**
   * change と focusin を受け取っている Shadow DOM です（#20）。change は Shadow DOM の外へ伝わらないため、
   * Shadow DOM ごとに受け取ります。focusin も、同じ部品の中で選ぶ要素が移った場合は、部品の外へ伝わりません。
   * 部品の外からは、選ばれている要素（部品そのもの）が変わらないように見えるためです。
   * @type {Set<ShadowRoot>}
   */
  const watchedRoots = new Set();

  /** @param {MouseEvent} event */
  const onClick = (event) => {
    // ページのスクリプトが発生させた操作（element.click() など）は記録しません（#14）。
    if (!event.isTrusted || !(event.target instanceof Element)) {
      return;
    }
    const pressed = deepTarget(event);
    const element = pressed.closest(clickable) ?? pressed;
    if (isTextEntry(element) || element === document.body || element === document.documentElement) {
      // 入力欄へのクリックは、入力の準備にすぎないため記録しません。値は change で記録します。
      return;
    }
    // Shadow DOM の中の要素では、ページ送りの指定を作りません（#20）。ページ全体で探す指定のため、部品の内側の
    // 要素を指せないためです。
    const inShadow = element.getRootNode() instanceof ShadowRoot;
    // 確定ボタンかどうかを Service Worker が判定できるよう、要素の文言も送ります（#29）。
    // サイトごとの止める要素の指定（#54）は、Service Worker がこのスクリプトより先に置きます。
    send(
      { type: 'click', target: buildTarget(element) },
      elementTexts(element),
      matchStopSelector(pressed, scope.__lightomateStopSelectors),
      elementKeys(element),
      rowHint(element),
      inShadow ? undefined : pagerSelectors(element),
      linkHref(element),
    );
  };

  /**
   * 入力欄などを選んだ時点で、その要素を含む Shadow DOM の change を受け取り始めます（#20）。
   * ページ全体の Shadow DOM を最初にすべて探すと、要素の多いページで重くなるため、選んだ部品だけを対象にします。
   * @param {Event} event
   */
  const onFocusIn = (event) => {
    if (event.target instanceof Element) {
      watchRoots(deepTarget(event));
    }
  };

  /** @param {Event} event */
  const onChange = (event) => {
    if (!event.isTrusted) {
      return;
    }
    const element = event.target;

    if (element instanceof HTMLSelectElement) {
      const options = Array.from(element.selectedOptions);
      send(
        {
          type: 'select',
          target: buildTarget(element),
          values: options.map((option) => option.value),
          labels: options.map((option) => option.label),
        },
        undefined,
        undefined,
        undefined,
        rowHint(element),
      );
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
        undefined,
        undefined,
        undefined,
        rowHint(element),
      );
    }
  };

  /**
   * 最上位のページに埋め込まれた枠（iframe）の大きさと表示の状態を測ります（#230）。Service Worker が、許可がない枠の
   * うち、画面に見える枠だけを知らせるために使います。判定は shared/frame-visibility.js で行います。
   * 測った枠は、大きさの変化を見張ります。最初は隠れていて、操作の後に表示される決済の枠を取りこぼさないためです。
   * @returns {object[]}
   */
  function measureFrames() {
    return [...document.querySelectorAll('iframe')].map((frame) => {
      watchFrame(frame);
      const rect = frame.getBoundingClientRect();
      const style = getComputedStyle(frame);
      let origin = '';
      try {
        origin = new URL(frame.src, location.href).origin;
      } catch {
        // src が URL として読み取れない枠は、サイトがわからない枠として扱います。
      }
      return {
        origin: origin === 'null' ? '' : origin,
        width: rect.width,
        height: rect.height,
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        right: rect.right + scrollX,
        bottom: rect.bottom + scrollY,
      };
    });
  }

  /** 枠が見えるかの目安の大きさです。正確な判定は Service Worker が行い、ここでは変化の検出にだけ使います。 */
  const frameSizeHint = 30;
  /** @type {WeakMap<Element, boolean>} 見張っている枠と、前回の大きさが目安以上だったか */
  const watchedFrames = new WeakMap();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let framesChangedTimer;
  // 最上位のページだけで見張ります。枠の中のページの枠（2 段以上の埋め込み）は対象外のためです。
  const frameObserver =
    window === window.top
      ? new ResizeObserver((entries) => {
          let changed = false;
          for (const entry of entries) {
            const large =
              entry.contentRect.width >= frameSizeHint && entry.contentRect.height >= frameSizeHint;
            if (watchedFrames.get(entry.target) !== large) {
              watchedFrames.set(entry.target, large);
              changed = true;
            }
          }
          if (!changed) {
            return;
          }
          // 表示の切り替えで続けて変わる場合に、まとめて 1 回だけ知らせます。
          clearTimeout(framesChangedTimer);
          framesChangedTimer = setTimeout(() => {
            chrome.runtime.sendMessage({ kind: 'recording/framesChanged' }).catch(() => {});
          }, 300);
        })
      : null;

  /** @param {HTMLIFrameElement} frame */
  function watchFrame(frame) {
    if (!frameObserver || watchedFrames.has(frame)) {
      return;
    }
    const rect = frame.getBoundingClientRect();
    watchedFrames.set(frame, rect.width >= frameSizeHint && rect.height >= frameSizeHint);
    frameObserver.observe(frame);
  }

  // 取り込み（capture）の段階で受け取ります。ページが操作の伝わりを止めても記録できるようにするためです。
  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('focusin', onFocusIn, true);
  // 記録を始める前から選ばれている入力欄（ページを開いたときに自動で選ばれる欄など）は、focusin が起きないため、
  // ここで対象にします。
  watchRoots(focusedElement());

  /**
   * Service Worker からの知らせを受け取ります。
   * @param {any} message
   * @param {chrome.runtime.MessageSender} sender
   * @param {(response: unknown) => void} sendResponse
   */
  function onMessage(message, sender, sendResponse) {
    if (sender.id !== chrome.runtime.id) {
      return;
    }
    if (message?.kind === 'recorder/frameSizes') {
      sendResponse(window === window.top ? measureFrames() : []);
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
    document.removeEventListener('focusin', onFocusIn, true);
    for (const root of watchedRoots) {
      root.removeEventListener('change', onChange, true);
      root.removeEventListener('focusin', onFocusIn, true);
    }
    watchedRoots.clear();
    frameObserver?.disconnect();
    clearTimeout(framesChangedTimer);
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
   * @param {object[]} [rows] 操作した要素を含む一覧の行の候補（#167）。後で「各行で繰り返す」に変えるときに使います
   * @param {string[]} [pager] 押した要素を、繰り返しのページ送りに使う場合の指定（#182）
   * @param {string} [href] 押したリンクのリンク先（絶対 URL）。リンク先のファイルを保存する指定に変えるときに、
   *   同じ種類のリンクを探す指定を作るために使います（#185）
   */
  function send(step, texts, matchedSelector, keys, rows, pager, href) {
    // 記録したときにページが翻訳されていたことを残します。実行時に見つからなかった場合の説明に使います（#99）。
    const recorded = isPageTranslated() ? { ...step, translated: true } : step;
    chrome.runtime
      .sendMessage({
        kind: 'recording/step',
        step: recorded,
        texts,
        matchedSelector,
        keys,
        rows,
        pager,
        href,
      })
      .catch(() => {
        // 拡張機能を再読み込みした後など、Service Worker と接続できない場合は記録を続けられません。
        overlay.remove();
      });
  }

  /**
   * 操作した要素を返します。Shadow DOM の中の要素を操作した場合も、外側の部品ではなく、その要素を返します（#20）。
   *
   * ページ全体で受け取った操作の target は、外側の部品に置き換わっています。開いた Shadow DOM の中の要素は
   * composedPath で得られます。閉じた Shadow DOM の中は composedPath に含まれないため、部品の Shadow DOM の中を、
   * マウスの操作では押した位置の要素、キーボードの操作では選ばれている要素でたどります。
   * @param {Event} event
   * @returns {Element}
   */
  function deepTarget(event) {
    const [first] = event.composedPath();
    let element = first instanceof Element ? first : /** @type {Element} */ (event.target);
    const pointed = event instanceof MouseEvent && event.detail > 0;
    for (let root = shadowRootOf(element); root; root = shadowRootOf(element)) {
      const inner = pointed
        ? root.elementFromPoint(
            /** @type {MouseEvent} */ (event).clientX,
            /** @type {MouseEvent} */ (event).clientY,
          )
        : root.activeElement;
      if (!inner || inner === element || inner.getRootNode() !== root) {
        break;
      }
      element = inner;
    }
    return element;
  }

  /**
   * 要素を含む Shadow DOM を、内側から外側まで、change と focusin を受け取る対象に加えます（#20）。
   * @param {Element | null} element
   */
  function watchRoots(element) {
    for (let root = element?.getRootNode(); root instanceof ShadowRoot;) {
      if (!watchedRoots.has(root)) {
        root.addEventListener('change', onChange, true);
        root.addEventListener('focusin', onFocusIn, true);
        watchedRoots.add(root);
      }
      root = root.host.getRootNode();
    }
  }

  /**
   * 選ばれている要素を返します。Shadow DOM の中の要素が選ばれている場合は、外側の部品ではなく、その要素です（#20）。
   * @returns {Element | null}
   */
  function focusedElement() {
    let element = document.activeElement;
    for (let root = element && shadowRootOf(element); root?.activeElement;) {
      element = root.activeElement;
      root = shadowRootOf(element);
    }
    return element;
  }

  /**
   * 操作した要素を含む一覧の行の候補です。Shadow DOM の中の要素では作りません（#20）。
   * @param {Element} element
   * @returns {object[] | undefined}
   */
  function rowHint(element) {
    return element.getRootNode() instanceof ShadowRoot ? undefined : rowCandidates(element);
  }

  /**
   * 押した要素を含むリンクのリンク先（絶対 URL）を返します（#185）。リンクの中でない場合は undefined です。
   * @param {Element} element
   * @returns {string | undefined}
   */
  function linkHref(element) {
    const link = element.closest('a[href]');
    return link instanceof HTMLAnchorElement ? link.href : undefined;
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
