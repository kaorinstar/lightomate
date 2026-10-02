// 明細書のリンク先に、読み込むたびに変わる値を入れます（#177）。サイトが発行するダウンロード用の URL の代わりです。
for (const link of document.querySelectorAll('a.volatile')) {
  link.setAttribute(
    'href',
    `/documents/download/${Math.random().toString(36).slice(2)}/invoice.pdf`,
  );
}
