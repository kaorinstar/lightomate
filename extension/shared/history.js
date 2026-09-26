// 実行履歴（#19）の項目の作成、件数の制限、CSV への変換です。chrome.* は使いません。
//
// 実行するときに入力した値（パラメータと、パスワードなど値を記録していない欄の値）は記録しません。
// 止まった理由の説明には、値を当てはめた URL などが含まれることがあるため、記録する前に伏せます。

import { itemText } from './control-flow.js';
import { describeStep } from './describe.js';

/** @typedef {import('./flow.js').Step} Step */

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
 * @property {number[]} [items] 繰り返しの中で止まった場合の、段ごとの何件目の行か（1 から数えます、#6）
 * @property {string} [reason] 止まった理由。入力した値は伏せてあります
 * @property {string[]} files 保存したファイルのパス。ファイルを保存する手順（#16）で記録します
 * @property {string} [step] 止まった手順の説明（describeStep）。入力した値は伏せてあります（#93）
 * @property {string} [pageUrl] 止まったときのタブの URL。クエリとフラグメントを除き、入力した値を
 *   伏せてあります。操作の許可がないサイトのページと、タブが閉じられた場合はありません（#93）
 * @property {number} [retries] 止まった手順で、要素が見つからずにやり直した回数（#93）
 * @property {string} [extensionVersion] 実行した拡張機能の版（manifest.json の version、#93）
 * @property {number} [schemaVersion] 実行したフローの形式の版（#93）
 *
 * step 以降の項目は #93 で加えました。それより前に記録した履歴にはありません。
 */

/**
 * 履歴の 1 件を作るときに、実行の状態のほかに渡す情報です。
 * @typedef {object} HistoryExtra
 * @property {string[]} [files] 保存したファイルのパス（#16）
 * @property {Step} [step] 止まった手順。成功した場合は使いません
 * @property {string} [pageUrl] 止まったときのタブの URL
 * @property {number} [retries] 止まった手順で、要素が見つからずにやり直した回数
 * @property {string} [extensionVersion] 拡張機能の版
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
 * 指定した実行の履歴を除いた一覧を返します。元の一覧は変更しません。
 * 一覧にない runId は無視します。
 * @param {HistoryEntry[]} history
 * @param {Iterable<string>} runIds 除く実行の識別子
 * @returns {HistoryEntry[]}
 */
export function withoutHistoryEntries(history, runIds) {
  const removing = new Set(runIds);
  return history.filter((entry) => !removing.has(entry.runId));
}

/**
 * 終わった実行の状態から、履歴の 1 件を作ります。止まった理由の中の入力した値は伏せます。
 * @param {{
 *   runId: string, flowId: string, flowName: string, origin: string, startedAt: string,
 *   status: string, stepIndex: number, total: number, error?: string, items?: number[],
 *   schemaVersion?: number,
 * }} run 実行の状態（background/runner.js の RunState）
 * @param {string} endedAt 終了した日時（ISO 8601）
 * @param {Iterable<string>} values 伏せる値
 * @param {HistoryExtra} [extra]
 * @returns {HistoryEntry | null} 実行が終わっていない場合は null
 */
export function historyEntryFromRun(run, endedAt, values, extra = {}) {
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
    files: [...(extra.files ?? [])],
  };
  if (status === 'done') {
    return entry;
  }
  // 停止（stopped）の stepIndex は、停止した時点で完了していた手順の数です。次の手順で止まったことになります。
  entry.stepNumber = Math.min(run.stepIndex + 1, run.total);
  if (run.items && run.items.length > 0) {
    entry.items = [...run.items];
  }
  // 複数の項目を伏せるため、1 度だけ読み出します。
  const redacting = [...values];
  if (run.error) {
    entry.reason = redactValues(run.error, redacting);
  }
  // 原因を調べるための情報です（#93）。成功した実行では調べる必要がないため、記録しません。
  if (extra.step) {
    entry.step = redactValues(describeStep(extra.step), redacting);
  }
  if (extra.pageUrl) {
    const pageUrl = pageUrlForHistory(extra.pageUrl, redacting);
    if (pageUrl) {
      entry.pageUrl = pageUrl;
    }
  }
  if (extra.retries && extra.retries > 0) {
    entry.retries = extra.retries;
  }
  if (extra.extensionVersion) {
    entry.extensionVersion = extra.extensionVersion;
  }
  if (run.schemaVersion !== undefined) {
    entry.schemaVersion = run.schemaVersion;
  }
  return entry;
}

/**
 * 履歴に記録するページの URL です。クエリ（? 以降）とフラグメント（# 以降）を除き、入力した値を伏せます。
 * クエリには検索語やセッションの識別子が含まれることが多く、原因の調査にはパスまでで足りるためです。
 * https:// と http:// 以外の URL（chrome:// など）と、URL として読めない文字列は記録しません。
 * @param {string} url
 * @param {Iterable<string>} values 伏せる値
 * @returns {string | undefined}
 */
export function pageUrlForHistory(url, values) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return undefined;
  }
  return redactValues(`${parsed.origin}${parsed.pathname}`, values);
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
  ['止まった手順の内容', (/** @type {HistoryEntry} */ entry) => entry.step ?? ''],
  ['ページ', (/** @type {HistoryEntry} */ entry) => entry.pageUrl ?? ''],
  ['やり直し', (/** @type {HistoryEntry} */ entry) => retryText(entry)],
  ['理由', (/** @type {HistoryEntry} */ entry) => entry.reason ?? ''],
  ['保存したファイル', (/** @type {HistoryEntry} */ entry) => entry.files.join('\n')],
]);

/**
 * 止まった手順の表示です（例：「3 / 5」、繰り返しの中では「3 / 5（2 件目）」）。成功した場合は空の文字列です。
 * @param {HistoryEntry} entry
 * @returns {string}
 */
export function stepText(entry) {
  if (entry.stepNumber === undefined) {
    return '';
  }
  const item = itemText(entry.items);
  return `${entry.stepNumber} / ${entry.total}${item ? `（${item}）` : ''}`;
}

/**
 * やり直した回数の表示です（例：「3 回」）。やり直していない場合は空の文字列です。
 * @param {HistoryEntry} entry
 * @returns {string}
 */
function retryText(entry) {
  return entry.retries ? `${entry.retries} 回` : '';
}

/**
 * 報告用のテキストの日時です（例：「2026/9/26 10:00:42」）。画面の表示と異なり秒まで示します。
 * 実行は 1 分以内に終わることが多く、分まででは開始と終了の区別がつかないためです。
 * @param {string} iso ISO 8601 の日時
 * @returns {string}
 */
export function reportDateTime(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * 履歴 1 件を、そのまま貼り付けて報告できるテキストにします（#93）。値がない項目の行は省きます。
 * 改行は LF です。貼り付け先（チャットや Issue）で行が崩れないようにするためです。
 * @param {HistoryEntry} entry
 * @returns {string}
 */
export function historyEntryText(entry) {
  const flowVersion =
    entry.schemaVersion === undefined ? '' : `（形式の版 ${entry.schemaVersion}）`;
  const lines = [
    `Lightomate${entry.extensionVersion ? ` ${entry.extensionVersion}` : ''} の実行履歴`,
    `フロー：${entry.flowName}${flowVersion}`,
    `サイト：${entry.origin}`,
    `開始：${reportDateTime(entry.startedAt)}`,
    `終了：${reportDateTime(entry.endedAt)}`,
    `結果：${STATUS_LABELS[entry.status]}`,
  ];
  if (entry.stepNumber !== undefined) {
    lines.push(`止まった手順：${stepText(entry)}${entry.step ? `（${entry.step}）` : ''}`);
  }
  if (entry.pageUrl) {
    lines.push(`ページ：${entry.pageUrl}`);
  }
  if (entry.retries) {
    lines.push(`やり直し：${retryText(entry)}`);
  }
  if (entry.reason) {
    lines.push(`理由：${entry.reason}`);
  }
  if (entry.files.length > 0) {
    lines.push(`保存したファイル：${entry.files.join('、')}`);
  }
  return `${lines.join('\n')}\n`;
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
