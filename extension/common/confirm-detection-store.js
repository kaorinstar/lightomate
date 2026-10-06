// 確定ボタンの自動検出（#29）を有効にするかの設定の読み書きです（#47）。Service Worker と拡張機能の画面から使います。
//
// 設定は 2 段です。1 段目（confirmDetection）は手動の実行とまとめフロー、記録に効きます。2 段目
// （confirmDetectionSchedule）は定期実行に効き、1 段目を無効にしている間だけ無効にできます。人がその場にいない
// 定期実行のリスクには、別に同意してもらうためです。
//
// どちらも chrome.storage.local に、無効にした場合だけ false を保存します。値がない場合は有効（初期値）です。
// 一括バックアップ（shared/backup.js）には含めません。バックアップから復元しただけで、確認を経ずに無効になることを
// 防ぐためです。

/** @typedef {import('../shared/purchase-guard.js').ConfirmDetectionSettings} ConfirmDetectionSettings */

/** chrome.storage.local に 1 段目の設定を保存するキーです。 */
export const CONFIRM_DETECTION_KEY = 'confirmDetection';

/** chrome.storage.local に 2 段目（定期実行）の設定を保存するキーです。 */
export const CONFIRM_DETECTION_SCHEDULE_KEY = 'confirmDetectionSchedule';

/**
 * 2 段の設定を読み取ります。1 段目が有効の場合、2 段目は有効として扱います。
 * @returns {Promise<ConfirmDetectionSettings>}
 */
export async function getConfirmDetectionSettings() {
  const stored = await chrome.storage.local.get([
    CONFIRM_DETECTION_KEY,
    CONFIRM_DETECTION_SCHEDULE_KEY,
  ]);
  const enabled = stored[CONFIRM_DETECTION_KEY] !== false;
  return { enabled, schedule: enabled || stored[CONFIRM_DETECTION_SCHEDULE_KEY] !== false };
}

/**
 * 1 段目の確定ボタンの自動検出が有効かを返します。記録で使います。
 * @returns {Promise<boolean>}
 */
export async function getConfirmDetection() {
  return (await getConfirmDetectionSettings()).enabled;
}

/**
 * 1 段目を有効・無効にします。有効に戻す場合は、2 段目も有効に戻します。次に 1 段目を無効にしたときに、
 * 定期実行まで知らないうちに止まらなくなることを防ぐためです。無効にする前の確認は、呼び出す側（設定画面）で行います。
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setConfirmDetection(enabled) {
  if (enabled) {
    await chrome.storage.local.remove([CONFIRM_DETECTION_KEY, CONFIRM_DETECTION_SCHEDULE_KEY]);
  } else {
    await chrome.storage.local.set({ [CONFIRM_DETECTION_KEY]: false });
  }
}

/**
 * 2 段目（定期実行での自動検出）を有効・無効にします。1 段目が有効の間は、無効にしません。
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setConfirmDetectionSchedule(enabled) {
  if (enabled) {
    await chrome.storage.local.remove(CONFIRM_DETECTION_SCHEDULE_KEY);
  } else if (!(await getConfirmDetectionSettings()).enabled) {
    await chrome.storage.local.set({ [CONFIRM_DETECTION_SCHEDULE_KEY]: false });
  }
}
