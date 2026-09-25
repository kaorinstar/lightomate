// 保存したフローの読み書きです。Service Worker と拡張機能の画面から使います。
//
// フローは chrome.storage.local に保存します。Chrome を終了しても残りますが、暗号化はされません。
// 拡張機能を削除すると、保存したフローも削除されます。

import { orderFlow, validateFlow } from '../shared/flow.js';
import { uniqueName } from '../shared/flow-list.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */

/**
 * 保存したフローです。
 * @typedef {object} StoredFlow
 * @property {string} id 識別子
 * @property {string} createdAt 作成した日時（ISO 8601）
 * @property {string} updatedAt 更新した日時（ISO 8601）
 * @property {Flow} flow フロー定義
 */

const FLOWS_KEY = 'flows';

/** @returns {Promise<Record<string, StoredFlow>>} */
async function readAll() {
  const stored = await chrome.storage.local.get(FLOWS_KEY);
  return /** @type {Record<string, StoredFlow>} */ (stored[FLOWS_KEY] ?? {});
}

/**
 * 保存したフローの一覧を、更新した日時の新しい順に返します。
 * @returns {Promise<StoredFlow[]>}
 */
export async function listFlows() {
  const all = await readAll();
  return Object.values(all)
    .map((stored) => ({ ...stored, flow: orderFlow(stored.flow) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * @param {string} id
 * @returns {Promise<StoredFlow | undefined>}
 */
export async function getFlow(id) {
  const stored = (await readAll())[id];
  return stored && { ...stored, flow: orderFlow(stored.flow) };
}

/**
 * フローを保存します。id を指定しない場合は、新しいフローとして追加します。
 * 形式に誤りがある場合は保存せず、誤りの説明を返します。
 *
 * 同じサイトに同じ名前のフローがある場合は、上書きせず、名前に番号を付けて保存します
 * （例：「領収書 (2)」）。保存した名前を name で返します。
 * @param {unknown} flow
 * @param {string} [id]
 * @returns {Promise<{ ok: true, id: string, name: string } | { ok: false, errors: string[] }>}
 */
export async function saveFlow(flow, id) {
  const errors = validateFlow(flow);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const all = await readAll();
  const now = new Date().toISOString();
  const flowId = id ?? crypto.randomUUID();
  const valid = /** @type {Flow} */ (flow);
  const name = uniqueName(valid.name, valid.origin, Object.values(all), flowId);
  all[flowId] = {
    id: flowId,
    createdAt: all[flowId]?.createdAt ?? now,
    updatedAt: now,
    flow: { ...valid, name },
  };
  await chrome.storage.local.set({ [FLOWS_KEY]: all });
  return { ok: true, id: flowId, name };
}

/**
 * フローの名前を変えます。同じサイトに同じ名前のフローがある場合は、番号を付けます。
 * @param {string} id
 * @param {string} name
 * @returns {Promise<{ ok: true, id: string, name: string } | { ok: false, errors: string[] }>}
 */
export async function renameFlow(id, name) {
  const stored = (await readAll())[id];
  if (!stored) {
    return { ok: false, errors: ['フローが見つかりません。'] };
  }
  return saveFlow({ ...stored.flow, name }, id);
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteFlow(id) {
  const all = await readAll();
  delete all[id];
  await chrome.storage.local.set({ [FLOWS_KEY]: all });
}

/**
 * 保存したフローが変わったときに呼び出す処理を登録します。
 * @param {() => void} listener
 */
export function onFlowsChanged(listener) {
  chrome.storage.local.onChanged.addListener((changes) => {
    if (FLOWS_KEY in changes) {
      listener();
    }
  });
}
