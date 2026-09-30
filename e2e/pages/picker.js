// ページのスクリプトが押す操作を受け取ったことを、画面に書き出します。選択モードの間は届かないはずです（#139）。
document.addEventListener('click', (event) => {
  document.getElementById('clicked').textContent = `押されました：${event.target.tagName}`;
});
