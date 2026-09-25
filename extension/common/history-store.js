// 実行履歴（#19）の保存です。chrome.storage.local に、新しい順の配列として保存します。
// 書き込むのは Service Worker だけです。拡張機能の画面は読み取りと、変化の受け取りだけを行います。

import { appendHistory } from '../shared/history.js';

/** @typedef {import('../shared/history.js').HistoryEntry} HistoryEntry */

const HISTORY_KEY = 'history';

/**
 * 書き込みを 1 つずつ順に行うための待ち行列です。複数の実行が同時に終わった場合に、読み込みと
 * 書き込みが入れ違って履歴が失われることを防ぎます。
 */
let queue = Promise.resolve();

/**
 * 実行履歴を、新しい順に返します。
 * @returns {Promise<HistoryEntry[]>}
 */
export async function listHistory() {
  const stored = await chrome.storage.local.get(HISTORY_KEY);
  const history = stored[HISTORY_KEY];
  return Array.isArray(history) ? /** @type {HistoryEntry[]} */ (history) : [];
}

/**
 * 実行履歴に 1 件加えます。件数の上限を超えた古い履歴は削除します。
 * @param {HistoryEntry} entry
 * @returns {Promise<void>}
 */
export function addHistory(entry) {
  const result = queue.then(async () => {
    const history = appendHistory(await listHistory(), entry);
    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  });
  queue = result.catch(() => {});
  return result;
}

/**
 * 実行履歴が変わったときに呼び出す処理を登録します。
 * @param {() => void} listener
 */
export function onHistoryChanged(listener) {
  chrome.storage.local.onChanged.addListener((changes) => {
    if (HISTORY_KEY in changes) {
      listener();
    }
  });
}
