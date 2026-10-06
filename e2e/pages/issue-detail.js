// ［発行する］を押すと、ページが領収書のファイルを作り、ダウンロードさせます（#223）。
// 楽天市場の領収書のように、リンク先のファイルではなく、ページの処理で始まるダウンロードを再現します。
const number = new URLSearchParams(location.search).get('n') ?? '';
document.getElementById('number').textContent = number;
document.getElementById('issue').addEventListener('click', () => {
  // 確認の画面を経てファイルを作るサイトの代わりに、少し待ってからダウンロードを始めます。
  setTimeout(() => {
    const blob = new Blob([`%PDF-1.4\n% ${number}\n`], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'receipt.pdf';
    document.body.append(link);
    link.click();
    link.remove();
  }, 300);
});
