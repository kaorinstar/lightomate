// ページのスクリプトが押す操作を受け取ったことを、画面に書き出します。選択モードの間は届かないはずです（#139）。
document.addEventListener('click', (event) => {
  document.getElementById('clicked').textContent = `押されました：${event.target.tagName}`;
});

// Chrome の翻訳と同じく、表示の後に文字を <font> の入れ子で包みます（#139）。翻訳が差し込んだ要素を押しても、
// 翻訳していないページにもある要素（td.no）を選ぶことを確かめるためです。
setTimeout(() => {
  document.documentElement.classList.add('translated-ltr');
  for (const cell of document.querySelectorAll('td.no')) {
    const outer = document.createElement('font');
    outer.style.verticalAlign = 'inherit';
    const inner = document.createElement('font');
    inner.style.verticalAlign = 'inherit';
    inner.textContent = `請求書 ${cell.textContent}`;
    outer.append(inner);
    cell.replaceChildren(outer);
  }
}, 100);
