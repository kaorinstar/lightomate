// サイトごとの「必ず止まる場所」の指定の読み書きです（#54）。Service Worker と拡張機能の画面から使います。
//
// 指定は chrome.storage.local に、フローとは別に保存します。Chrome を終了しても残りますが、
// 暗号化はされません。拡張機能を削除すると、指定も削除されます。

import { STOP_RULES_KEY, ruleForOrigin, validateStopRule } from '../shared/stop-rules.js';

/** @typedef {import('../shared/stop-rules.js').StopRule} StopRule */

/** @returns {Promise<Record<string, StopRule>>} */
async function readAll() {
  const stored = await chrome.storage.local.get(STOP_RULES_KEY);
  const all = stored[STOP_RULES_KEY];
  return typeof all === 'object' && all !== null
    ? /** @type {Record<string, StopRule>} */ (all)
    : {};
}

/**
 * 指定のあるサイトの一覧を、オリジンの順に返します。
 * @returns {Promise<{ origin: string, rule: StopRule }[]>}
 */
export async function listStopRules() {
  const all = await readAll();
  return Object.keys(all)
    .sort()
    .map((origin) => ({ origin, rule: ruleForOrigin(all, origin) }));
}

/**
 * サイトの指定を返します。指定がない場合は空の指定を返します。
 * @param {string} origin
 * @returns {Promise<StopRule>}
 */
export async function getStopRule(origin) {
  return ruleForOrigin(await readAll(), origin);
}

/**
 * サイトの指定を保存します。止める要素と止める画面がどちらも空の場合は、指定を削除します。
 * 形式に誤りがある場合は保存せず、誤りの説明を返します。
 * @param {string} origin
 * @param {StopRule} rule
 * @returns {Promise<{ ok: true } | { ok: false, errors: string[] }>}
 */
export async function saveStopRule(origin, rule) {
  const errors = validateStopRule(rule);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const all = await readAll();
  if (rule.selectors.length === 0 && rule.paths.length === 0) {
    delete all[origin];
  } else {
    all[origin] = { selectors: [...rule.selectors], paths: [...rule.paths] };
  }
  await chrome.storage.local.set({ [STOP_RULES_KEY]: all });
  return { ok: true };
}

/**
 * 指定が変わったときに呼び出す処理を登録します。
 * @param {() => void} listener
 */
export function onStopRulesChanged(listener) {
  chrome.storage.local.onChanged.addListener((changes) => {
    if (STOP_RULES_KEY in changes) {
      listener();
    }
  });
}
