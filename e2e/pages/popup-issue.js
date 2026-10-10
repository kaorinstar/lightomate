// ［発行する］を押すと、新しいタブを開き、そのタブで領収書をダウンロードさせて閉じます（#284）。
// 楽天市場の領収書の［発行する］を再現します。window.open は、利用者の操作でないと Chrome に止められます。
document.getElementById('issue').addEventListener('click', () => {
  window.open('popup-receipt.html', '_blank');
});
// ほかの要素が重なったボタンです。押すと、このページでダウンロードを始めます（#284）。
document.getElementById('covered').addEventListener('click', () => {
  const blob = new Blob(['%PDF-1.4\n% covered\n'], { type: 'application/pdf' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'covered.pdf';
  document.body.append(link);
  link.click();
  link.remove();
});
