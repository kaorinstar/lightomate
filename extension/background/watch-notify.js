// 読み取った値が前回の実行から変わったときに、Chrome の通知で知らせます（#251）。
// 知らせるかの判定は shared/watch-value.js、前回の値の保存は common/watch-store.js で行います。
// 通知を押すと、値を読み取ったページを開きます。通知とページの対応は chrome.storage.session に保存し、
// Service Worker が止まった後に押された場合も開けるようにします。

import { firstDecision, watchDecision, watchMessage } from '../shared/watch-value.js';
import { getWatchValue, setWatchValue } from '../common/watch-store.js';

/** chrome.storage.session に、通知の id と開くページの URL の対応を保存するキーです。 */
const NOTIFICATION_PAGES_KEY = 'watchNotificationPages';

/**
 * 読み取った値を前回の値と比べ、変わっていれば知らせます。
 * @param {object} options
 * @param {string} options.flowId
 * @param {string} options.name 読み取りの名前（extract の name）
 * @param {string} options.label 読み取った要素の説明（target.label）
 * @param {string} options.first 今回読み取った値
 * @param {() => Promise<string>} options.reread 待ってから同じ要素を読み直す処理
 * @param {() => Promise<string | undefined>} options.pageUrl 通知を押したときに開くページの URL を返す処理
 * @returns {Promise<'remember' | 'same' | 'notify' | 'unsettled'>} 判定の結果
 */
export async function checkWatchedValue({ flowId, name, label, first, reread, pageUrl }) {
  const previous = await getWatchValue(flowId, name);
  const decision = firstDecision(previous, first);
  if (decision === 'remember') {
    await setWatchValue(flowId, name, first);
    return decision;
  }
  if (decision === 'same' || previous === undefined) {
    return 'same';
  }
  const second = await reread();
  const result = watchDecision(previous, first, second);
  if (result === 'notify') {
    await setWatchValue(flowId, name, second);
    await showNotification(watchMessage(label, previous, second), await pageUrl());
  }
  return result;
}

/**
 * 通知を表示します。
 * @param {string} message
 * @param {string | undefined} url 通知を押したときに開くページ
 */
async function showNotification(message, url) {
  const id = `lightomate-watch-${crypto.randomUUID()}`;
  if (url) {
    const stored = await chrome.storage.session.get(NOTIFICATION_PAGES_KEY);
    const pages = stored[NOTIFICATION_PAGES_KEY] ?? {};
    await chrome.storage.session.set({ [NOTIFICATION_PAGES_KEY]: { ...pages, [id]: url } });
  }
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Lightomate',
    message,
  });
}

/**
 * 通知を押されたときに、値を読み取ったページを開きます。service-worker.js の最上位で登録します。
 * @param {string} id 通知の id
 */
export async function openWatchedPage(id) {
  if (!id.startsWith('lightomate-watch-')) {
    return;
  }
  const stored = await chrome.storage.session.get(NOTIFICATION_PAGES_KEY);
  const pages = /** @type {Record<string, string>} */ (stored[NOTIFICATION_PAGES_KEY] ?? {});
  const url = pages[id];
  delete pages[id];
  await chrome.storage.session.set({ [NOTIFICATION_PAGES_KEY]: pages });
  await chrome.notifications.clear(id);
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    await chrome.tabs.create({ url });
  }
}
