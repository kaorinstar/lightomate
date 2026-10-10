// 銀行の入出金明細の画面を再現したサンプルの処理です（#217）。
// 照会の画面（bank-period.html）では期間を選び、結果の画面（bank-result.html）では照会した期間を表示して、
// 期間を名前に含む CSV をダウンロードします。照会した期間は sessionStorage で受け渡します。
// 実際のサイトと同じく、結果の画面の URL は期間によらず同じです。

const STORAGE_KEY = 'lightomate-sample-period';

/** @param {number} n */
const padded = (n) => String(n).padStart(2, '0');

/**
 * 年のない月日から、照会の対象の日付を作ります。実行した日より後の月は、前年として扱います。
 * @param {number} month
 * @param {number} day
 * @param {Date} now
 */
function toDate(month, day, now) {
  const year = month > now.getMonth() + 1 ? now.getFullYear() - 1 : now.getFullYear();
  return new Date(year, month - 1, day);
}

/** @param {Date} date */
const formatDate = (date) =>
  `${date.getFullYear()}年${padded(date.getMonth() + 1)}月${padded(date.getDate())}日`;

/** @param {Date} date */
const compactDate = (date) =>
  `${date.getFullYear()}${padded(date.getMonth() + 1)}${padded(date.getDate())}`;

/**
 * 選択肢を作り、今日の月日を選んだ状態にします。
 * @param {string} id
 * @param {number} count
 * @param {number} selected
 */
function fill(id, count, selected) {
  const select = /** @type {HTMLSelectElement} */ (document.getElementById(id));
  for (let n = 1; n <= count; n += 1) {
    select.add(new Option(padded(n), padded(n), false, n === selected));
  }
  return select;
}

const form = document.getElementById('inquiry-form');
if (form) {
  const now = new Date();
  const fromMonth = fill('pulldown002', 12, now.getMonth() + 1);
  const fromDay = fill('pulldown003', 31, now.getDate());
  const toMonth = fill('pulldown004', 12, now.getMonth() + 1);
  const toDay = fill('pulldown005', 31, now.getDate());
  const period = /** @type {HTMLInputElement} */ (document.getElementById('radio008'));
  const error = /** @type {HTMLElement} */ (document.getElementById('error'));

  // 実際のサイトと同じく、期間の選択肢を変えると「期間を指定する」を選びます。
  for (const select of [fromMonth, fromDay, toMonth, toDay]) {
    select.addEventListener('change', () => {
      period.checked = true;
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.textContent = '';
    /** @type {Date} */
    let from;
    /** @type {Date} */
    let to;
    if (period.checked) {
      const values = [fromMonth, fromDay, toMonth, toDay].map((select) => Number(select.value));
      from = toDate(values[0], values[1], now);
      to = toDate(values[2], values[3], now);
      // 存在しない日付（9 月 31 日など）は、実際のサイトと同じく照会しません。
      if (from.getDate() !== values[1] || to.getDate() !== values[3]) {
        error.textContent = '指定された日付は存在しません。日付を確認してください。';
        return;
      }
      if (from > to) {
        error.textContent = '開始日が終了日より後になっています。';
        return;
      }
    } else {
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ from: from.getTime(), to: to.getTime() }));
    location.href = 'bank-result.html';
  });
}

const result = document.getElementById('period');
if (result) {
  const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
  if (stored) {
    const from = new Date(stored.from);
    const to = new Date(stored.to);
    result.textContent = `${formatDate(from)} ～ ${formatDate(to)}`;
    const rows = /** @type {HTMLElement} */ (document.getElementById('rows'));
    const lines = [['日付', '摘要', 'お支払金額', 'お預り金額']];
    for (const [offset, text, out, into] of [
      [0, 'カード利用', '3,300', ''],
      [1, '振込', '', '50,000'],
    ]) {
      const date = new Date(from.getTime() + Number(offset) * 86_400_000);
      if (date > to) {
        continue;
      }
      const line = [formatDate(date), String(text), String(out), String(into)];
      lines.push(line);
      const row = rows.insertRow();
      for (const cell of line) {
        row.insertCell().textContent = cell;
      }
    }
    document.getElementById('download')?.addEventListener('click', () => {
      const csv = lines.map((line) => line.join(',')).join('\r\n');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      link.download = `meisai_${compactDate(from)}_${compactDate(to)}.csv`;
      link.click();
      // 押した直後に解放するとダウンロードが始まらない場合があるため、少し待ってから解放します。
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    });
  } else {
    result.textContent = '照会していません。照会の画面から照会してください。';
  }
}
