// 実行中の異常への対応です（#18）。chrome.* は使いません。
//
// - 認証の画面の検出：ログインの有効期限切れなどで、ログインや確認コード、画像認証の画面が表示された
//   場合に、手順を行わずに一時停止するかを判定します。CAPTCHA や二段階認証を自動で通過することはしません。
// - 再試行：要素が見つからなかった手順だけを、決まった回数までやり直します。ページに何も操作して
//   いないため、やり直しても購入などの操作が重なることはありません。

/** @typedef {import('./flow.js').Step} Step */

/**
 * ページで見つけた、認証の画面の印です（content/runner.js が調べます）。
 * @typedef {object} AuthSignals
 * @property {boolean} password 表示されているパスワードの入力欄がある
 * @property {boolean} oneTimeCode 確認コードの入力欄（autocomplete="one-time-code"）がある
 * @property {boolean} captcha 画像認証の枠（reCAPTCHA、hCaptcha、Cloudflare Turnstile）がある
 * @property {boolean} loginForm ログインの ID（メールアドレスなど）の入力欄がある。
 *   autocomplete="username" の入力欄か、id・name・action に signin や login を含むフォームの中の
 *   メールアドレス・文字の入力欄です。Amazon のように、パスワードを次の画面で尋ねるサイトのためです
 */

/**
 * ログインの画面の URL のパスに含まれる語です（例：Amazon の /ap/signin）。語の前後が / や - などで
 * 区切られている場合だけ一致させ、/author のような別の語に一致しないようにします。
 */
const LOGIN_PATH = /(^|[/._-])(sign[-_]?in|log[-_]?in|log[-_]?on|authenticate|auth)(?=$|[/._-])/i;

/** 要素が見つからなかった手順を、やり直す回数の上限です。 */
export const MAX_RETRIES = 2;

/** 認証の画面で一時停止したときの説明です。 */
export const AUTH_PAUSE_NOTE =
  'ログインや認証の画面が表示されたため、一時停止しました。ログインなどを済ませ、元の画面に戻ってから［再開］を押してください。';

/**
 * ページの移動の手順の後に、認証の画面で一時停止したときの説明です。
 * ［再開］では移動の手順をやり直さず、次の手順から続けるため、移動先の画面を表示してもらいます。
 * @param {string} url 移動の手順の移動先
 * @returns {string}
 */
export function authPauseNoteForPage(url) {
  return `ログインや認証の画面が表示されたため、一時停止しました。ログインなどを済ませ、次の画面を表示してから［再開］を押してください。\n${url}`;
}

/**
 * 認証の画面のため、手順を行わずに一時停止するかを判定します。
 * 次の 2 つを両方満たす場合に止めます。
 * - ページに認証の画面の印（パスワードの入力欄、確認コードの入力欄、画像認証の枠、ログインの ID の
 *   入力欄）があるか、URL のパスがログインの画面を示す語（signin、login など）を含む。
 * - 表示中の URL のパスが、直前のページの移動の URL のパスと異なる。
 * ログインの画面を記録したフローでは、ログインの画面にいることが想定どおりのため止めません。
 * ログインの有効期限切れでは、サイトが別のパス（例：/orders から /signin）に転送するため、パスが異なります。
 * パスワードなど値を記録していない入力欄への入力の手順も、止めません。
 * @param {{ signals: AuthSignals, currentUrl: string, expectedUrl: string | undefined, step: Step }} input
 * @returns {boolean}
 */
export function shouldPauseForAuth({ signals, currentUrl, expectedUrl, step }) {
  if (
    !signals.password &&
    !signals.oneTimeCode &&
    !signals.captcha &&
    !signals.loginForm &&
    !isLoginUrl(currentUrl)
  ) {
    return false;
  }
  if (step.type === 'input' && step.secret) {
    return false;
  }
  if (expectedUrl === undefined) {
    return false;
  }
  return pathOf(currentUrl) !== pathOf(expectedUrl);
}

/**
 * URL のパスが、ログインの画面を示す語（signin、login など）を含むかを判定します。
 * @param {string} url
 * @returns {boolean}
 */
export function isLoginUrl(url) {
  try {
    return LOGIN_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * ページからの応答が、やり直してよい失敗（要素が見つからなかった）かを判定します。
 * 別のサイトへの移動、確定の手前での停止など、ほかの理由の失敗はやり直しません。
 * @param {unknown} response content/runner.js の応答
 * @returns {boolean}
 */
export function isRetryableFailure(response) {
  return (
    typeof response === 'object' &&
    response !== null &&
    /** @type {{ ok?: unknown, notFound?: unknown }} */ (response).ok === false &&
    /** @type {{ notFound?: unknown }} */ (response).notFound === true
  );
}

/**
 * ページを操作せず、要素を探して調べるだけの依頼の種類です（#90）。
 * 応答の前にページが移動して通信が途切れた場合も、ページに何も操作していないため、やり直してよい依頼です。
 */
const READ_ONLY_REQUESTS = [
  'runner/inspect',
  'runner/exists',
  'runner/read',
  'runner/count',
  'runner/authSignals',
];

/**
 * ページとの通信が途切れた場合に、やり直してよい依頼かを判定します（#90）。
 * 要素を待っている間にページが遅れて転送されると、通信が途切れます。調べるだけの依頼は、転送の後の
 * ページでやり直します。クリック・入力・選択の依頼（runner/step）は、操作の途中で途切れた可能性が
 * あるため、やり直さずに止めます。
 * @param {unknown} message content/runner.js に送った依頼
 * @returns {boolean}
 */
export function isReadOnlyRequest(message) {
  return (
    typeof message === 'object' &&
    message !== null &&
    READ_ONLY_REQUESTS.includes(String(/** @type {{ kind?: unknown }} */ (message).kind))
  );
}

/**
 * URL のパスを、末尾の / を除いて返します。読み取れない場合は、そのまま返します。
 * @param {string} url
 * @returns {string}
 */
function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}
