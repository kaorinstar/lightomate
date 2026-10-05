// 確定ボタンの自動検出を無効にする設定（#47）を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideDialog } from '../extension/shared/dialog.js';
import {
  CONFIRM_DETECTION_OFF_NOTE,
  confirmDetectionFor,
} from '../extension/shared/purchase-guard.js';
import {
  CONFIRM_DETECTION_KEY,
  CONFIRM_DETECTION_SCHEDULE_KEY,
  getConfirmDetection,
  getConfirmDetectionSettings,
  setConfirmDetection,
  setConfirmDetectionSchedule,
} from '../extension/common/confirm-detection-store.js';
import { exportBackup } from '../extension/common/backup-store.js';

/**
 * chrome.storage.local を、読み書きを記録する簡易な実装に置き換えます。
 * @param {Record<string, unknown>} [initial]
 */
function fakeStorage(initial = {}) {
  /** @type {Record<string, unknown>} */
  const data = structuredClone(initial);
  /** @type {Record<string, unknown>} */ (globalThis).chrome = {
    storage: {
      local: {
        get: async (/** @type {string | string[]} */ keys) =>
          Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .filter((key) => key in data)
              .map((key) => [key, structuredClone(data[key])]),
          ),
        set: async (/** @type {Record<string, unknown>} */ items) => {
          Object.assign(data, structuredClone(items));
        },
        remove: async (/** @type {string | string[]} */ keys) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete data[key];
          }
        },
      },
    },
  };
  return data;
}

test('定期実行は 2 段目の設定に従い、それ以外の実行は 1 段目の設定に従う（#47）', () => {
  const on = { enabled: true, schedule: true };
  const manualOff = { enabled: false, schedule: true };
  const bothOff = { enabled: false, schedule: false };
  assert.equal(confirmDetectionFor(on, undefined), true);
  assert.equal(confirmDetectionFor(on, 'schedule'), true);
  assert.equal(confirmDetectionFor(manualOff, undefined), false);
  assert.equal(confirmDetectionFor(manualOff, 'schedule'), true);
  assert.equal(confirmDetectionFor(bothOff, undefined), false);
  assert.equal(confirmDetectionFor(bothOff, 'schedule'), false);
  assert.equal(CONFIRM_DETECTION_OFF_NOTE, '確定ボタンの自動検出を無効にして実行しました。');
});

test('検出を無効にした実行では、確定を表す語を含む確認にも指定どおり応答する（#47）', () => {
  const dialog = { type: 'confirm', message: 'ご注文を確定しますか？' };
  assert.equal(decideDialog(dialog, ['accept'], 0, true).action, 'halt');
  assert.deepEqual(decideDialog(dialog, ['accept'], 0, false), {
    action: 'respond',
    response: 'accept',
  });
  // 文字を入力するダイアログには、検出の設定にかかわらず応答しません。
  assert.equal(
    decideDialog({ type: 'prompt', message: '名前' }, ['accept'], 0, false).action,
    'pause',
  );
});

test('設定は初期値が有効で、無効にした場合だけ保存する（#47）', async () => {
  const data = fakeStorage();
  assert.deepEqual(await getConfirmDetectionSettings(), { enabled: true, schedule: true });
  await setConfirmDetection(false);
  assert.equal(data[CONFIRM_DETECTION_KEY], false);
  assert.equal(await getConfirmDetection(), false);
  assert.deepEqual(await getConfirmDetectionSettings(), { enabled: false, schedule: true });
  await setConfirmDetection(true);
  assert.equal(CONFIRM_DETECTION_KEY in data, false);
  assert.equal(await getConfirmDetection(), true);
});

test('定期実行の設定は 1 段目が無効の間だけ無効にでき、1 段目を有効に戻すと外れる（#47）', async () => {
  const data = fakeStorage();
  // 1 段目が有効の間は、無効にしません。
  await setConfirmDetectionSchedule(false);
  assert.equal(CONFIRM_DETECTION_SCHEDULE_KEY in data, false);

  await setConfirmDetection(false);
  await setConfirmDetectionSchedule(false);
  assert.deepEqual(await getConfirmDetectionSettings(), { enabled: false, schedule: false });
  await setConfirmDetectionSchedule(true);
  assert.deepEqual(await getConfirmDetectionSettings(), { enabled: false, schedule: true });

  await setConfirmDetectionSchedule(false);
  await setConfirmDetection(true);
  assert.equal(CONFIRM_DETECTION_SCHEDULE_KEY in data, false);
  // 再び 1 段目を無効にしても、定期実行では止まるままです。
  await setConfirmDetection(false);
  assert.deepEqual(await getConfirmDetectionSettings(), { enabled: false, schedule: true });
});

test('一括バックアップには、確定ボタンの自動検出の設定を含めない（#47）', async () => {
  fakeStorage({ [CONFIRM_DETECTION_KEY]: false, [CONFIRM_DETECTION_SCHEDULE_KEY]: false });
  const backup = await exportBackup();
  assert.equal(JSON.stringify(backup).includes(CONFIRM_DETECTION_KEY), false);
});
