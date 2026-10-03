// ログインした状態の代わりに、ログインの Cookie を付けます（#172）。
document.cookie = 'lm_auth=1; path=/; SameSite=Strict';

/** 注文ごとの明細書の ID です。M-002 だけ、明細書が 2 件あります。 */
/** @type {Record<string, string[]>} */
const invoices = {
  'M-001': ['M-001-0000aaaa'],
  'M-002': ['M-002-1111bbbb', 'M-002-2222cccc'],
  'M-003': ['M-003-3333dddd'],
};

let popoverCount = 0;

/**
 * 注文の小さな枠を作って開きます。前に開いた枠は隠します。
 * @param {string} order
 */
function openPopover(order) {
  for (const popover of document.querySelectorAll('.popover')) {
    popover.setAttribute('hidden', '');
  }
  popoverCount += 1;
  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.id = `popover-content-${popoverCount}`;
  const list = document.createElement('ul');
  const ids = invoices[order] ?? [];
  /**
   * @param {string} text
   * @param {string} href
   */
  const add = (text, href) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = href;
    link.textContent = text;
    item.append(link);
    list.append(item);
  };
  add('印刷可能な注文概要', `/summary.html?order=${order}`);
  ids.forEach((id, index) => {
    add(
      ids.length === 1 ? '明細書／適格請求書' : `明細書／適格請求書 ${index + 1}`,
      `/documents/download/${id}/invoice.pdf`,
    );
  });
  popover.append(list);
  document.body.append(popover);
}

const orders = document.getElementById('orders');
for (const order of Object.keys(invoices)) {
  const row = document.createElement('div');
  row.className = 'order';
  const number = document.createElement('span');
  number.className = 'order-number';
  number.textContent = order;
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'receipt-menu';
  menu.textContent = '領収書等';
  menu.addEventListener('click', () => openPopover(order));
  row.append(number, menu);
  orders?.append(row);
}

// URL に translate=1 がある場合は、Chrome の翻訳と同じく、表示の後に少し遅れて文字を置き換えます（CLAUDE.md）。
// 置き換えた文字は、翻訳と同じく font 要素の入れ子で包みます。小さな枠は開くたびに作るため、作った後も置き換えます。
if (new URLSearchParams(location.search).get('translate') === '1') {
  const translate = () => {
    for (const element of document.querySelectorAll('.receipt-menu, .popover a')) {
      if (element.querySelector('font')) {
        continue;
      }
      const text = element.textContent ?? '';
      const outer = document.createElement('font');
      outer.style.verticalAlign = 'inherit';
      const inner = document.createElement('font');
      inner.style.verticalAlign = 'inherit';
      inner.textContent = text
        .replace('領収書等', 'Receipts')
        .replace('明細書／適格請求書', 'Statement / Invoice')
        .replace('印刷可能な注文概要', 'Printable order summary');
      outer.append(inner);
      element.replaceChildren(outer);
    }
  };
  setTimeout(translate, 300);
  new MutationObserver(() => setTimeout(translate, 300)).observe(document.body, {
    childList: true,
  });
}
