// 値の変化を知らせる読み取り（#251）で、前回の実行で読み取った値を保存します。
// chrome.storage.local の watchValues に、フローの id ごと、読み取りの名前（extract の name）ごとに保存します。
// 値はこの端末の中だけに保存し、外部へは送りません。フローを削除すると、そのフローの値も削除します。

/** chrome.storage.local に前回の値を保存するキーです。 */
export const WATCH_VALUES_KEY = 'watchValues';

/**
 * @returns {Promise<Record<string, Record<string, string>>>}
 */
async function readAll() {
  const stored = await chrome.storage.local.get(WATCH_VALUES_KEY);
  const all = stored[WATCH_VALUES_KEY];
  return all && typeof all === 'object'
    ? /** @type {Record<string, Record<string, string>>} */ (all)
    : {};
}

/**
 * 前回の実行で読み取った値を返します。ない場合は undefined です。
 * @param {string} flowId
 * @param {string} name
 * @returns {Promise<string | undefined>}
 */
export async function getWatchValue(flowId, name) {
  const value = (await readAll())[flowId]?.[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * 読み取った値を、次の実行で比べるために保存します。
 * @param {string} flowId
 * @param {string} name
 * @param {string} value
 */
export async function setWatchValue(flowId, name, value) {
  const all = await readAll();
  all[flowId] = { ...(all[flowId] ?? {}), [name]: value };
  await chrome.storage.local.set({ [WATCH_VALUES_KEY]: all });
}

/**
 * 削除したフローの値を削除します。
 * @param {string[]} flowIds
 */
export async function deleteWatchValues(flowIds) {
  const all = await readAll();
  if (!flowIds.some((id) => id in all)) {
    return;
  }
  for (const id of flowIds) {
    delete all[id];
  }
  await chrome.storage.local.set({ [WATCH_VALUES_KEY]: all });
}
