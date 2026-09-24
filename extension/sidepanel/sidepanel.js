// サイドパネルです。記録の開始・停止、フローの一覧と実行、実行中の進み具合を表示します。

const version = document.getElementById('version');
if (version) {
  version.textContent = chrome.runtime.getManifest().version;
}
