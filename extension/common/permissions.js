// サイトを操作する許可を求める処理です。サイドパネルと管理画面の両方から使います。

/**
 * サイトを操作する許可を求めます。許可済みの場合、画面は表示されません。
 * Chrome は、ボタンを押した直後にしか許可を求める画面を出しません。呼び出す前に待ち時間を入れないでください。
 * @param {string} origin
 * @returns {Promise<string>} 許可が得られなかった理由。得られた場合は空の文字列
 */
export async function requestPermission(origin) {
  try {
    if (await chrome.permissions.request({ origins: [`${origin}/*`] })) {
      return '';
    }
  } catch (error) {
    return `許可を求められませんでした。${String(error)}`;
  }
  return `${origin} を操作する許可が得られなかったため、続けられません。もう一度押し、表示される画面で「許可」を選んでください。`;
}
