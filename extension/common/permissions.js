// サイトを操作する許可を求める処理です。サイドパネルと管理画面の両方から使います。

/**
 * すべてのサイトの許可です（#41）。manifest.json の optional_host_permissions と同じ範囲です。
 * 管理画面の［設定］の「すべてのサイトを許可」で求め、外します。
 */
export const ALL_SITES = ['https://*/*', 'http://*/*'];

/** @returns {Promise<boolean>} すべてのサイトの許可があるか */
export function hasAllSites() {
  return chrome.permissions.contains({ origins: ALL_SITES });
}

/**
 * サイトを操作する許可を求めます。許可済みの場合、画面は表示されません。
 * 複数のサイトは、1 回の確認でまとめて求めます（#41）。一部でも許可されなかった場合は、得られなかったとします。
 * Chrome は、ボタンを押した直後にしか許可を求める画面を出しません。呼び出す前に待ち時間を入れないでください。
 * @param {string | string[]} origins
 * @returns {Promise<string>} 許可が得られなかった理由。得られた場合は空の文字列
 */
export async function requestPermission(origins) {
  const list = Array.isArray(origins) ? origins : [origins];
  try {
    if (await chrome.permissions.request({ origins: list.map((origin) => `${origin}/*`) })) {
      return '';
    }
  } catch (error) {
    return `許可を求められませんでした。${String(error)}`;
  }
  return `${list.join('、')} を操作する許可が得られなかったため、続けられません。もう一度押し、表示される画面で「許可」を選んでください。`;
}
