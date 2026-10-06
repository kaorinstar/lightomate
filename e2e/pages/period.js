// 期間の指定のページの選択肢を作ります（#216）。

/**
 * @param {string} id
 * @param {number} count
 * @param {(n: number) => string} value
 * @param {(n: number) => string} label
 */
function fill(id, count, value, label) {
  const select = /** @type {HTMLSelectElement} */ (document.getElementById(id));
  for (let n = 1; n <= count; n += 1) {
    select.add(new Option(label(n), value(n)));
  }
}

const padded = (/** @type {number} */ n) => String(n).padStart(2, '0');
fill('from-month', 12, padded, padded);
fill('from-day', 31, padded, padded);
fill('to-month', 12, padded, padded);
fill('to-day', 31, padded, padded);
fill('plain-month', 12, String, String);
fill('coded-month', 12, (n) => `m${n}`, padded);

// 対象のサイトと同じく、期間の選択肢を変えると「期間を指定する」を選びます。
for (const select of document.querySelectorAll('select.pick')) {
  select.addEventListener('change', () => {
    /** @type {HTMLInputElement} */ (document.getElementById('period')).checked = true;
  });
}
