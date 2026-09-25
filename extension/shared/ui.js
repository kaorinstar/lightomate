// 拡張機能の画面（サイドパネルと管理画面）で共通に使う、表示の部品です。
// 表示の規則は docs/design-guidelines.md に記載しています。
// chrome.* は使いません。Node.js のテストから読み込むためです。

/** @typedef {'error' | 'warning' | 'success' | 'info'} NoticeKind */

/**
 * 知らせの種類ごとの、Tabler のクラスと読み上げの役割です。
 * エラーは読み上げを割り込ませる alert、それ以外は割り込ませない status とします。
 * @param {NoticeKind} kind
 * @returns {{ className: string, role: 'alert' | 'status' }}
 */
export function noticeStyle(kind) {
  switch (kind) {
    case 'error':
      return { className: 'lm-notice alert alert-danger', role: 'alert' };
    case 'warning':
      return { className: 'lm-notice alert alert-warning', role: 'status' };
    case 'success':
      return { className: 'lm-notice alert alert-success', role: 'status' };
    case 'info':
      return { className: 'lm-notice alert alert-info', role: 'status' };
  }
}

/**
 * 知らせを、押したボタンの直下の表示欄に出します。文字列が空の場合は表示欄を隠します。
 * 誤りと警告は、画面の上部にまとめず、操作した場所に出す規則です（docs/design-guidelines.md）。
 * 表示欄が画面に置かれている場合は、画面の外に出ないよう、見える位置まで移動します。
 * 一覧を作り直すときのように、画面に置く前の要素に出す場合は移動しません。
 * @param {HTMLElement} element 表示欄
 * @param {string} text 知らせる内容。改行を含めてよい
 * @param {NoticeKind} [kind]
 */
export function showNotice(element, text, kind = 'info') {
  const { className, role } = noticeStyle(kind);
  element.className = className;
  element.setAttribute('role', role);
  element.textContent = text;
  element.hidden = !text;
  if (text && element.isConnected) {
    element.scrollIntoView({ block: 'nearest' });
  }
}

/** トーストを表示しておく時間（ミリ秒）です。 */
export const TOAST_DURATION = 5000;

/**
 * @typedef {object} Timers
 * @property {(callback: () => void, ms: number) => any} setTimeout
 * @property {(id: any) => void} clearTimeout
 */

/** 表示欄ごとの、表示中のトーストを消す処理です。新しいトーストで置き換えるときに呼びます。 */
const toastDismissers = new WeakMap();

/**
 * 操作の成功を、画面の上部に固定した欄（トースト）に出します。一定時間の後、または［✕］で消えます。
 * マウスを重ねている間とフォーカスがある間は消さず、離れてから数え直します。
 * 誤りと警告には使いません。自動で消える表示は見落とされるためです（docs/design-guidelines.md）。
 * 結果が画面のほかの場所にも残る知らせ（一覧に行が増える、消えるなど）だけに使います。
 * @param {HTMLElement} region トーストの表示欄。role="status" を付け、画面の上部に固定します。
 *   読み上げの対象として登録されたままにするため、hidden にせず、空の要素として置いておきます
 * @param {string} text 知らせる内容
 * @param {{ kind?: 'success' | 'info', duration?: number, timers?: Timers }} [options]
 *   timers はテストで時間の処理を差し替えるためのものです
 */
export function showToast(
  region,
  text,
  { kind = 'success', duration = TOAST_DURATION, timers = globalThis } = {},
) {
  toastDismissers.get(region)?.();
  const document = region.ownerDocument;

  const message = document.createElement('span');
  message.className = 'lm-toast-text';
  message.textContent = text;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'lm-toast-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', '閉じる');
  const toast = document.createElement('div');
  toast.className = `lm-toast ${noticeStyle(kind).className}`;
  toast.append(message, close);

  /** @type {any} */
  let timer;
  let hovered = false;
  let focused = false;
  const stop = () => {
    if (timer !== undefined) {
      timers.clearTimeout(timer);
      timer = undefined;
    }
  };
  const start = () => {
    stop();
    if (!hovered && !focused) {
      timer = timers.setTimeout(dismiss, duration);
    }
  };
  const dismiss = () => {
    stop();
    toast.remove();
    toastDismissers.delete(region);
  };

  close.addEventListener('click', dismiss);
  toast.addEventListener('mouseenter', () => {
    hovered = true;
    stop();
  });
  toast.addEventListener('mouseleave', () => {
    hovered = false;
    start();
  });
  toast.addEventListener('focusin', () => {
    focused = true;
    stop();
  });
  toast.addEventListener('focusout', () => {
    focused = false;
    start();
  });

  region.replaceChildren(toast);
  toastDismissers.set(region, dismiss);
  start();
}

/**
 * 入力欄の誤りを、その入力欄の直下に表示します。文字列が空の場合は誤りの表示を消します。
 * @param {HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement} control 入力欄
 * @param {HTMLElement} feedback 入力欄の直後に置いた、誤りを表示する要素（class="invalid-feedback"）
 * @param {string} text
 */
export function showFieldError(control, feedback, text) {
  control.classList.toggle('is-invalid', Boolean(text));
  if (text) {
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', feedback.id);
  } else {
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
  feedback.textContent = text;
}

/**
 * 確認を、操作した区画の中に表示します。ブラウザ標準の confirm() は使いません。
 * 画面の中央に出る確認は、どの操作の確認かが画面上の位置から読み取れないためです。
 * @param {HTMLElement} container 確認を表示する要素。表示中は中身を置き換えます
 * @param {{ message: string, confirmLabel: string, danger?: boolean }} options
 *   danger は、元に戻せない操作（削除など）のときに true にします
 * @returns {Promise<boolean>} 確定のボタンを押した場合は true
 */
export function confirmInline(container, { message, confirmLabel, danger = false }) {
  const document = container.ownerDocument;
  return new Promise((resolve) => {
    const text = document.createElement('p');
    text.className = 'mb-2';
    text.textContent = message;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    ok.textContent = confirmLabel;
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'キャンセル';
    const buttons = document.createElement('div');
    buttons.className = 'lm-buttons';
    buttons.append(ok, cancel);

    /** @param {boolean} answer */
    const finish = (answer) => {
      container.replaceChildren();
      container.hidden = true;
      resolve(answer);
    };
    ok.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));

    container.className = danger
      ? 'lm-confirm alert alert-danger'
      : 'lm-confirm alert alert-warning';
    container.setAttribute('role', 'alertdialog');
    container.replaceChildren(text, buttons);
    container.hidden = false;
    cancel.focus();
  });
}

/**
 * 明るい表示と暗い表示を、OS の設定に合わせて切り替えます。Tabler は data-bs-theme 属性で切り替えます。
 * @param {HTMLElement} root 属性を付ける要素（document.documentElement）
 * @param {MediaQueryList} darkQuery matchMedia('(prefers-color-scheme: dark)') の結果
 */
export function followColorScheme(root, darkQuery) {
  const apply = () => root.setAttribute('data-bs-theme', darkQuery.matches ? 'dark' : 'light');
  apply();
  darkQuery.addEventListener('change', apply);
}
