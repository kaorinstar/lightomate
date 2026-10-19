// 日付の欄のパターンのサンプルの、選択の欄の選択肢を作ります（#289）。
// 年は 2024〜2027 年、月と日は先頭に 0 を付けた 2 桁です。

/** @param {number} n */
const padded = (n) => String(n).padStart(2, '0');

for (const select of document.querySelectorAll('select')) {
  const element = /** @type {HTMLSelectElement} */ (select);
  if (element.classList.contains('year')) {
    for (let year = 2024; year <= 2027; year += 1) {
      element.add(new Option(String(year), String(year)));
    }
  } else {
    const count = element.classList.contains('month') ? 12 : 31;
    for (let n = 1; n <= count; n += 1) {
      element.add(new Option(padded(n), padded(n)));
    }
  }
}
