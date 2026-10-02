// URL の n の値を表示し、開いた順に localStorage の invoices に加えます（#167）。
// 自動テストが、どの注文の明細書を開いたかを確かめるために使います。
const number = new URLSearchParams(location.search).get('n') ?? '';
document.getElementById('number').textContent = number;
const opened = JSON.parse(localStorage.getItem('invoices') ?? '[]');
localStorage.setItem('invoices', JSON.stringify([...opened, number]));
