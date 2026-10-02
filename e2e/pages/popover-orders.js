// ［領収書等］を押すと、その注文の小さな枠だけを開きます。ほかの注文の枠は閉じます。
for (const button of document.querySelectorAll('.receipt-menu')) {
  button.addEventListener('click', () => {
    for (const popover of document.querySelectorAll('.popover')) {
      popover.classList.toggle('open', popover.id === `popover-${button.dataset.order}`);
    }
  });
}

// URL に translate=1 がある場合は、Chrome の翻訳と同じく、表示の後に少し遅れて文字を置き換えます（CLAUDE.md）。
// 置き換えた文字は、翻訳と同じく font 要素の入れ子で包みます。
/** @type {Record<string, string>} */
const translations = {
  領収書等: 'Receipts',
  明細書: 'Statement',
  注文の詳細: 'Order details',
};
if (new URLSearchParams(location.search).get('translate') === '1') {
  setTimeout(() => {
    for (const element of document.querySelectorAll('.order-date, .receipt-menu, .popover a')) {
      const text = element.textContent ?? '';
      const outer = document.createElement('font');
      outer.style.verticalAlign = 'inherit';
      const inner = document.createElement('font');
      inner.style.verticalAlign = 'inherit';
      inner.textContent = translations[text] ?? text.replace('2026年9月', 'September ');
      outer.append(inner);
      element.replaceChildren(outer);
    }
  }, 300);
}
