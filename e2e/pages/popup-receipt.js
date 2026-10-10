// 開いたタブで領収書のファイルをダウンロードさせます（#284）。閉じるのは、テストでタブを閉じる処理を確かめるため、
// ページ自身では行いません。
const blob = new Blob(['%PDF-1.4\n% popup\n'], { type: 'application/pdf' });
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = 'receipt.pdf';
document.body.append(link);
link.click();
link.remove();
