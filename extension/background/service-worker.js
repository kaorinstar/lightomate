// バックグラウンド処理（Service Worker）です。
// フローの実行管理、タブの制御、ダウンロードをここに置きます。
//
// Service Worker は操作がない状態が約 30 秒続くと停止し、変数の内容は失われます。
// 実行中のフローの状態は、変数ではなく chrome.storage に保存してください。
// 停止中に起きた出来事を受け取れるよう、イベントの受け取りは必ず最上位で登録します。

import {
  addStep,
  allowRecordingOrigin,
  attachRecordedPager,
  cancelPickSecond,
  finishRecordingGuide,
  makeRecordedLoop,
  onCommitted,
  onDOMContentLoaded,
  onDownloadCreated,
  onFramesChanged,
  onSecondPicked,
  onTabRemoved,
  removeRecordedStep,
  resetRecording,
  setRecordingGuide,
  startPickSecond,
  startRecording,
  stepRecordingGuide,
  stopRecording,
} from './recording.js';
import { removeHistory } from '../common/history-store.js';
import {
  abortAllBatches,
  abortBatch,
  abortBatchItem,
  acknowledgeBatchItem,
  markInterruptedBatches,
  startBatch,
} from './batch.js';
import {
  markInterruptedRuns,
  registerDialogEvents,
  requestPause,
  requestResume,
  requestStop,
  requestStopAll,
  startRun,
} from './runner.js';
import { registerScheduleEvents } from './scheduler.js';
import { onPickerCommitted, onPickerResult, onPickerTabRemoved, startPicker } from './picker.js';
import { openWatchedPage } from './watch-notify.js';

// ツールバーのアイコンを押したときに、ポップアップではなくサイドパネルを開きます。
// ポップアップはページをクリックした時点で閉じるため、記録中に開いたままにできないためです。
// この設定は Chrome が保持しますが、Service Worker の起動のたびに設定し直しても問題はありません。
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('サイドパネルの設定に失敗しました。', error));

const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

registerDialogEvents();
markInterruptedRuns().catch((error) => console.error('実行の状態を確認できませんでした。', error));
markInterruptedBatches().catch((error) =>
  console.error('一括実行の状態を確認できませんでした。', error),
);
// 定期実行（#22）の予約をやり直し、取りこぼした予約を実行します。
registerScheduleEvents();

// 値の変化の通知（#251）を押されたときに、値を読み取ったページを開きます。
chrome.notifications.onClicked.addListener((id) => {
  openWatchedPage(id).catch((error) => console.error('通知のページを開けませんでした。', error));
});

// 緊急停止のキー（#18）です。既定は Alt+Shift+Q で、chrome://extensions/shortcuts で変えられます。
// サイドパネルを開いていなくても、実行中と一時停止中のすべての実行を停止します。
chrome.commands.onCommand.addListener((command) => {
  if (command === 'emergency-stop') {
    // まとめフローの一括実行（#7）では、まだ始めていないフローも始めないようにします。
    abortAllBatches().catch((error) => console.error('一括実行を停止できませんでした。', error));
    requestStopAll().catch((error) => console.error('実行を停止できませんでした。', error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // この拡張機能以外からのメッセージは受け付けません。
  // externally_connectable を宣言していないため、通常は届きませんが、念のため確認します。
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  // 拡張機能の画面（サイドパネル）からの指示です。content script は送信元の URL がページの
  // URL になるため、ここで区別します。ページから記録の開始や停止を指示することはできません。
  const fromExtensionPage =
    sender.url !== undefined && new URL(sender.url).origin === extensionOrigin;

  switch (message?.kind) {
    case 'recording/start':
      if (!fromExtensionPage || typeof message.tabId !== 'number') {
        return false;
      }
      startRecording(message.tabId).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/stop':
      if (!fromExtensionPage) {
        return false;
      }
      stopRecording().then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/allowOrigin':
      if (!fromExtensionPage) {
        return false;
      }
      allowRecordingOrigin(message.origin).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/removeStep':
      if (!fromExtensionPage) {
        return false;
      }
      removeRecordedStep(message.index, message.count).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/makeLoop':
      if (!fromExtensionPage) {
        return false;
      }
      makeRecordedLoop(
        message.from,
        message.to,
        message.key,
        message.count,
        message.names,
        message.withSite,
        message.nextPage,
        message.dateStep,
        message.stopAtOlder,
      ).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case 'recording/guide':
      if (!fromExtensionPage) {
        return false;
      }
      setRecordingGuide(message.purpose).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/guideFinish':
      if (!fromExtensionPage) {
        return false;
      }
      finishRecordingGuide(message.count).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/guideStep':
      if (!fromExtensionPage) {
        return false;
      }
      stepRecordingGuide(message.action, message.count).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/attachPager':
      if (!fromExtensionPage) {
        return false;
      }
      attachRecordedPager(message.index, message.count).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/pickSecond':
      if (!fromExtensionPage) {
        return false;
      }
      startPickSecond().then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/pickCancel':
      if (!fromExtensionPage) {
        return false;
      }
      cancelPickSecond().then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'recording/secondPicked':
      onSecondPicked(message.result, sender).catch((error) =>
        console.error('2 件目の指定を受け取れませんでした。', error),
      );
      return false;

    case 'recording/reset':
      if (!fromExtensionPage) {
        return false;
      }
      resetRecording().then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'runner/start':
      if (
        !fromExtensionPage ||
        typeof message.flowId !== 'string' ||
        !isStringRecord(message.params) ||
        !isStringRecord(message.secrets)
      ) {
        return false;
      }
      startRun(message.flowId, message.params, message.secrets).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'runner/stop':
      if (!fromExtensionPage || typeof message.runId !== 'string') {
        return false;
      }
      requestStop(message.runId).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'runner/pause':
      if (!fromExtensionPage || typeof message.runId !== 'string') {
        return false;
      }
      requestPause(message.runId).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'runner/resume':
      if (!fromExtensionPage || typeof message.runId !== 'string') {
        return false;
      }
      requestResume(message.runId).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'batch/start':
      if (
        !fromExtensionPage ||
        typeof message.batchId !== 'string' ||
        !isBatchInputs(message.inputs)
      ) {
        return false;
      }
      startBatch(message.batchId, message.inputs).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'batch/abortAll':
      if (!fromExtensionPage || typeof message.batchRunId !== 'string') {
        return false;
      }
      abortBatch(message.batchRunId).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'batch/acknowledge':
    case 'batch/abort':
      if (
        !fromExtensionPage ||
        typeof message.batchRunId !== 'string' ||
        !Number.isInteger(message.index)
      ) {
        return false;
      }
      (message.kind === 'batch/acknowledge' ? acknowledgeBatchItem : abortBatchItem)(
        message.batchRunId,
        message.index,
      ).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error) }));
      return true;

    case 'history/remove':
      if (
        !fromExtensionPage ||
        !Array.isArray(message.runIds) ||
        !message.runIds.every((/** @type {unknown} */ id) => typeof id === 'string')
      ) {
        return false;
      }
      removeHistory(message.runIds).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'picker/start':
      // 要素の選択モード（#139）は、管理画面のブロックの［ページで選ぶ］から始めます。
      if (!fromExtensionPage) {
        return false;
      }
      startPicker(message, sender).then(sendResponse, (error) =>
        sendResponse({ ok: false, error: String(error) }),
      );
      return true;

    case 'picker/result':
      // 選んだ要素の指定は、選択中のタブのページのスクリプトからだけ受け付けます（picker.js で照らし合わせます）。
      onPickerResult(message, sender).catch((error) =>
        console.error('選んだ要素を管理画面へ届けられませんでした。', error),
      );
      return false;

    // 最上位のページの枠の大きさが変わったときの知らせです（#230）。
    case 'recording/framesChanged':
      onFramesChanged(sender).catch((error) =>
        console.error('枠の知らせを判定し直せませんでした。', error),
      );
      return false;

    case 'recording/step':
      addStep(
        message.step,
        sender,
        message.texts,
        message.matchedSelector,
        message.keys,
        message.rows,
        message.pager,
        message.href,
      ).catch((error) => console.error('手順を記録できませんでした。', error));
      return false;

    default:
      return false;
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  onCommitted(details).catch((error) => console.error('移動を記録できませんでした。', error));
  onPickerCommitted(details).catch((error) =>
    console.error('要素の選択を終えられませんでした。', error),
  );
});

chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  onDOMContentLoaded(details).catch((error) =>
    console.error('記録用のスクリプトを読み込めませんでした。', error),
  );
});

chrome.downloads.onCreated.addListener((item) => {
  onDownloadCreated(item).catch((error) =>
    console.error('ダウンロードを記録できませんでした。', error),
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  onTabRemoved(tabId).catch((error) => console.error('記録を停止できませんでした。', error));
  onPickerTabRemoved(tabId).catch((error) =>
    console.error('要素の選択を終えられませんでした。', error),
  );
});

/**
 * 値がすべて文字列のオブジェクトかを判定します。
 * @param {unknown} value
 * @returns {value is Record<string, string>}
 */
function isStringRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

/**
 * 一括実行の、フローごとの実行する値かを判定します。キーはフローの id です。
 * @param {unknown} value
 * @returns {value is Record<string, { params: Record<string, string>, secrets: Record<string, string> }>}
 */
function isBatchInputs(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (input) =>
        typeof input === 'object' &&
        input !== null &&
        isStringRecord(input.params) &&
        isStringRecord(input.secrets),
    )
  );
}
