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
 * 知らせを、操作した区画の中の表示欄に出します。文字列が空の場合は表示欄を隠します。
 * エラーは画面の上部にまとめず、原因の場所に出す規則です（docs/design-guidelines.md）。
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
