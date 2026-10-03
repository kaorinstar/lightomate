// お支払いの画面（frame-host.html）に埋め込む、カード情報の iframe です（#20）。
// ［確認へ］を押すと、入力した名義を埋め込み元のページへ送ります。

document.getElementById('confirm')?.addEventListener('click', () => {
  const holder = /** @type {HTMLInputElement} */ (document.querySelector('input[name="holder"]'))
    .value;
  window.parent.postMessage({ kind: 'frame-card/submit', holder }, '*');
});
