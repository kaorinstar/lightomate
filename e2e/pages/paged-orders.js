// ログインした状態の代わりに、ログインの Cookie を付けます（#172）。
document.cookie = 'lm_auth=1; path=/; SameSite=Strict';

const page = Number(new URLSearchParams(location.search).get('p') ?? '1');
const lastPage = 3;

const orders = document.getElementById('orders');
for (let number = 1; number <= 2; number += 1) {
  const id = `P${page}-${number}`;
  const order = document.createElement('div');
  order.className = 'order';
  const label = document.createElement('span');
  label.className = 'order-number';
  label.textContent = id;
  const invoice = document.createElement('a');
  invoice.className = 'invoice';
  invoice.href = `/auth/invoice.pdf?n=${id}`;
  invoice.textContent = '明細書';
  order.append(label, invoice);
  orders?.append(order);
}

/**
 * ページ送りの項目を 1 つ加えます。href がない場合は、押せない項目（リンクではない文字）にします。
 * @param {string} text
 * @param {string | null} href
 * @param {string} [className]
 */
function addItem(text, href, className) {
  const item = document.createElement('li');
  if (className) {
    item.className = className;
  }
  if (href === null) {
    item.textContent = text;
  } else {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    item.append(link);
  }
  document.querySelector('ul.pagination')?.append(item);
}

addItem('前へ', page > 1 ? `?p=${page - 1}` : null, 'previous');
// 1 ページ目は 1 ページ分、2 ページ目以降は全ページ分の番号を出します。「次へ」が何番目の li かが変わり、
// 1 ページ目で「次へ」がある位置は、2 ページ目では押せない今のページの番号になります。
for (let number = 1; number <= (page === 1 ? 1 : lastPage); number += 1) {
  addItem(String(number), number === page ? null : `?p=${number}`);
}
addItem(
  '次へ',
  page < lastPage ? `?p=${page + 1}` : null,
  page < lastPage ? 'next' : 'next disabled',
);
