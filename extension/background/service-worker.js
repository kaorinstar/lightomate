// バックグラウンド処理（Service Worker）です。
// フローの実行管理、タブの制御、ダウンロードをここに置きます。
//
// Service Worker は操作がない状態が約 30 秒続くと停止し、変数の内容は失われます。
// 実行中のフローの状態は、変数ではなく chrome.storage に保存してください。
// 停止中に起きた出来事を受け取れるよう、イベントの受け取りは必ず最上位で登録します。

import {
  addStep,
  onCommitted,
  onDOMContentLoaded,
  onTabRemoved,
  startRecording,
  stopRecording,
} from './recording.js';
import { markInterruptedRuns, requestStop, startRun } from './runner.js';

// ツールバーのアイコンを押したときに、ポップアップではなくサイドパネルを開きます。
// ポップアップはページをクリックした時点で閉じるため、記録中に開いたままにできないためです。
// この設定は Chrome が保持しますが、Service Worker の起動のたびに設定し直しても問題はありません。
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('サイドパネルの設定に失敗しました。', error));

const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

markInterruptedRuns().catch((error) => console.error('実行の状態を確認できませんでした。', error));

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

    case 'recording/step':
      addStep(message.step, sender, message.texts, message.matchedSelector).catch((error) =>
        console.error('手順を記録できませんでした。', error),
      );
      return false;

    default:
      return false;
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  onCommitted(details).catch((error) => console.error('移動を記録できませんでした。', error));
});

chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  onDOMContentLoaded(details).catch((error) =>
    console.error('記録用のスクリプトを読み込めませんでした。', error),
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  onTabRemoved(tabId).catch((error) => console.error('記録を停止できませんでした。', error));
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
