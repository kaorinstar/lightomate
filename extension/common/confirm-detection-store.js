// 確定ボタンの自動検出（#29）を有効にするかの設定の読み書きです（#47）。Service Worker と拡張機能の画面から使います。
//
// 設定は chrome.storage.local の confirmDetection に保存します。保存するのは無効にした場合だけで、値がない場合は
// 有効（初期値）として扱います。一括バックアップ（shared/backup.js）には含めません。バックアップから復元しただけで、
// 確認を経ずに無効になることを防ぐためです。

/** chrome.storage.local に設定を保存するキーです。 */
export const CONFIRM_DETECTION_KEY = 'confirmDetection';

/**
 * 確定ボタンの自動検出が有効かを返します。無効にした記録がない場合は有効です。
 * @returns {Promise<boolean>}
 */
export async function getConfirmDetection() {
  const stored = await chrome.storage.local.get(CONFIRM_DETECTION_KEY);
  return stored[CONFIRM_DETECTION_KEY] !== false;
}

/**
 * 確定ボタンの自動検出を有効・無効にします。有効にする場合は、無効にした記録を消します。
 * 無効にする前の確認は、呼び出す側（設定画面）で行います。
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setConfirmDetection(enabled) {
  if (enabled) {
    await chrome.storage.local.remove(CONFIRM_DETECTION_KEY);
  } else {
    await chrome.storage.local.set({ [CONFIRM_DETECTION_KEY]: false });
  }
}
