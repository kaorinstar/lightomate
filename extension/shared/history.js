// 実行履歴（#19）の項目の作成、件数の制限、CSV への変換です。chrome.* は使いません。
//
// 実行するときに入力した値（パラメータと、パスワードなど値を記録していない欄の値）は記録しません。
// 止まった理由の説明には、値を当てはめた URL などが含まれることがあるため、記録する前に伏せます。

/**
 * 実行履歴の 1 件です。
 * @typedef {object} HistoryEntry
 * @property {string} runId 実行の識別子
 * @property {string} flowId
 * @property {string} flowName 実行した時点のフロー名
 * @property {string} origin フローのオリジン
 * @property {string} startedAt 開始した日時（ISO 8601）
 * @property {string} endedAt 終了した日時（ISO 8601）
 * @property {'done' | 'failed' | 'stopped' | 'halted'} status
 *   done は成功、failed は失敗、stopped は中止（利用者が停止）、halted は一時停止（確定の手前など）です。
 * @property {number} total 手順の数
 * @property {number} [stepNumber] 止まった手順の番号（1 から数えます）。成功した場合はありません
 * @property {string} [reason] 止まった理由。入力した値は伏せてあります
 * @property {string[]} files 保存したファイルのパス。ファイルを保存する手順（#16）で記録します
 */

/** 保存する履歴の件数の上限です。超えた分は古い順に削除します。 */
export const HISTORY_LIMIT = 200;

/** 伏せた値の代わりに記録する文字列です。 */
export const REDACTED = '＊＊＊';

/** 結果の表示名です。 */
export const STATUS_LABELS = {
  done: '成功',
  failed: '失敗',
  stopped: '中止',
  halted: '一時停止',
};

/**
 * 新しい履歴を先頭に加え、上限を超えた古い履歴を削除した一覧を返します。元の一覧は変更しません。
 * 同じ実行の履歴がすでにある場合は、新しい内容に置き換えます。
 * @param {HistoryEntry[]} history 新しい順の一覧
 * @param {HistoryEntry} entry
 * @param {number} [limit]
 * @returns {HistoryEntry[]}
 */
export function appendHistory(history, entry, limit = HISTORY_LIMIT) {
  return [entry, ...history.filter((item) => item.runId !== entry.runId)].slice(0, limit);
}

/**
 * 終わった実行の状態から、履歴の 1 件を作ります。止まった理由の中の入力した値は伏せます。
 * @param {{
 *   runId: string, flowId: string, flowName: string, origin: string, startedAt: string,
 *   status: string, stepIndex: number, total: number, error?: string,
 * }} run 実行の状態（background/runner.js の RunState）
 * @param {string} endedAt 終了した日時（ISO 8601）
 * @param {Iterable<string>} values 伏せる値
 * @param {string[]} [files] 保存したファイルのパス（#16）
 * @returns {HistoryEntry | null} 実行が終わっていない場合は null
 */
export function historyEntryFromRun(run, endedAt, values, files = []) {
  if (!['done', 'failed', 'stopped', 'halted'].includes(run.status)) {
    return null;
  }
  const status = /** @type {HistoryEntry['status']} */ (run.status);
  /** @type {HistoryEntry} */
  const entry = {
    runId: run.runId,
    flowId: run.flowId,
    flowName: run.flowName,
    origin: run.origin,
    startedAt: run.startedAt,
    endedAt,
    status,
    total: run.total,
    files: [...files],
  };
  if (status !== 'done') {
    // 停止（stopped）の stepIndex は、停止した時点で完了していた手順の数です。次の手順で止まったことになります。
    entry.stepNumber = Math.min(run.stepIndex + 1, run.total);
  }
  if (status !== 'done' && run.error) {
    entry.reason = redactValues(run.error, values);
  }
  return entry;
}

/**
 * 文字列の中の、入力した値を伏せます。URL に含まれる形（エンコードした形）も伏せます。
 * 1 文字の値は伏せません。数字 1 文字などは説明の文中のほかの部分と区別できず、説明が読めなくなるためです。
 * @param {string} text
 * @param {Iterable<string>} values 入力した値と、そこから作った値（年月の年・月など）
 * @returns {string}
 */
export function redactValues(text, values) {
  const targets = new Set();
  for (const value of values) {
    if (value.length < 2) {
      continue;
    }
    targets.add(value);
    targets.add(encodeURIComponent(value));
  }
  // 長い値から置き換えます。短い値が長い値の一部である場合に、長い値が残らないようにするためです。
  let result = text;
  for (const target of [...targets].sort((a, b) => b.length - a.length)) {
    result = result.split(target).join(REDACTED);
  }
  return result;
}

/** CSV の列です。 */
const CSV_COLUMNS = /** @type {const} */ ([
  ['開始', (/** @type {HistoryEntry} */ entry) => entry.startedAt],
  ['終了', (/** @type {HistoryEntry} */ entry) => entry.endedAt],
  ['フロー', (/** @type {HistoryEntry} */ entry) => entry.flowName],
  ['サイト', (/** @type {HistoryEntry} */ entry) => entry.origin],
  ['結果', (/** @type {HistoryEntry} */ entry) => STATUS_LABELS[entry.status]],
  ['止まった手順', (/** @type {HistoryEntry} */ entry) => stepText(entry)],
  ['理由', (/** @type {HistoryEntry} */ entry) => entry.reason ?? ''],
  ['保存したファイル', (/** @type {HistoryEntry} */ entry) => entry.files.join('\n')],
]);

/**
 * 止まった手順の表示です（例：「3 / 5」）。成功した場合は空の文字列です。
 * @param {HistoryEntry} entry
 * @returns {string}
 */
export function stepText(entry) {
  return entry.stepNumber === undefined ? '' : `${entry.stepNumber} / ${entry.total}`;
}

/**
 * 履歴を CSV の文字列にします。RFC 4180 に従い、区切りの文字、改行、引用符を含む値を引用符で囲みます。
 * 改行は CRLF です。Excel で開けるよう、先頭に BOM（U+FEFF）を付けます。
 * @param {HistoryEntry[]} history
 * @returns {string}
 */
export function historyToCsv(history) {
  const rows = [
    CSV_COLUMNS.map(([title]) => title),
    ...history.map((entry) => CSV_COLUMNS.map(([, value]) => value(entry))),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/**
 * CSV の 1 つの値です。表計算ソフトが数式として実行しないよう、=、+、-、@、タブ、CR で始まる値の
 * 先頭に ' を付けます（OWASP の CSV Injection の対策）。フロー名は JSON から追加したフローでは
 * 他人が付けた可能性があるためです。
 * https://owasp.org/www-community/attacks/CSV_Injection
 * @param {string} value
 * @returns {string}
 */
function csvField(value) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
