// バックグラウンド処理（Service Worker）です。
// フローの実行管理、タブの制御、ダウンロードをここに置きます。
//
// Service Worker は操作がない状態が約 30 秒続くと停止し、変数の内容は失われます。
// 実行中のフローの状態は、変数ではなく chrome.storage に保存してください。

// ツールバーのアイコンを押したときに、ポップアップではなくサイドパネルを開きます。
// ポップアップはページをクリックした時点で閉じるため、記録中に開いたままにできないためです。
// この設定は Chrome が保持しますが、Service Worker の起動のたびに設定し直しても問題はありません。
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('サイドパネルの設定に失敗しました。', error));
