// まとめフロー（複数のフローの一括実行、#7）の読み書きです。Service Worker と拡張機能の画面から使います。
//
// まとめフローは、名前と、含めるフローの id の一覧（登録した順）だけを chrome.storage.local に保存します。
// フロー定義（docs/flow-format.md）には含めません。フローを削除しても、まとめフローは自動では変えず、
// 実行の前に誤りとして知らせます（shared/batch.js の batchProblems）。

import { BATCH_MAX_FLOWS, BATCH_NAME_MAX_LENGTH } from '../shared/batch.js';

/**
 * 保存したまとめフローです。
 * @typedef {object} StoredBatch
 * @property {string} id 識別子
 * @property {string} name 名前
 * @property {string[]} flowIds 含めるフローの id。登録した順です
 * @property {string} createdAt 作成した日時（ISO 8601）
 */

const BATCHES_KEY = 'batches';

/** @returns {Promise<Record<string, StoredBatch>>} */
async function readAll() {
  const stored = await chrome.storage.local.get(BATCHES_KEY);
  return /** @type {Record<string, StoredBatch>} */ (stored[BATCHES_KEY] ?? {});
}

/**
 * 保存したまとめフローの一覧を、名前の順に返します。
 * @returns {Promise<StoredBatch[]>}
 */
export async function listBatches() {
  return Object.values(await readAll()).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/**
 * @param {string} id
 * @returns {Promise<StoredBatch | undefined>}
 */
export async function getBatch(id) {
  return (await readAll())[id];
}

/**
 * まとめフローを新しく保存します。フローの内容の確認（batchProblems）は、呼び出す側で行います。
 * @param {string} name
 * @param {string[]} flowIds
 * @returns {Promise<{ ok: true, id: string } | { ok: false, error: string }>}
 */
export async function saveBatch(name, flowIds) {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: 'まとめフローの名前を入力してください。' };
  }
  if (trimmed.length > BATCH_NAME_MAX_LENGTH) {
    return { ok: false, error: `名前は ${BATCH_NAME_MAX_LENGTH} 文字以内にしてください。` };
  }
  if (flowIds.length > BATCH_MAX_FLOWS) {
    return { ok: false, error: `まとめフローに含められるフローは ${BATCH_MAX_FLOWS} 件までです。` };
  }
  const all = await readAll();
  const id = crypto.randomUUID();
  all[id] = { id, name: trimmed, flowIds: [...flowIds], createdAt: new Date().toISOString() };
  await chrome.storage.local.set({ [BATCHES_KEY]: all });
  return { ok: true, id };
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBatch(id) {
  const all = await readAll();
  delete all[id];
  await chrome.storage.local.set({ [BATCHES_KEY]: all });
}

/**
 * まとめフローが変わったときに呼び出す処理を登録します。
 * @param {() => void} listener
 */
export function onBatchesChanged(listener) {
  chrome.storage.local.onChanged.addListener((changes) => {
    if (BATCHES_KEY in changes) {
      listener();
    }
  });
}
