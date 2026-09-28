// すべてのフローと設定の一括バックアップの読み書きです（#17）。拡張機能の画面から使います。
//
// 内容の組み立てと検証は shared/backup.js で行います。ここでは chrome.storage.local との読み書きだけを行います。
// 復元は、フロー・まとめフロー・必ず止まる場所を 1 回の書き込みで追加します。途中で失敗して一部だけが
// 復元された状態にならないようにするためです。

import { STOP_RULES_KEY } from '../shared/stop-rules.js';
import { createBackup, planRestore } from '../shared/backup.js';
import { BATCHES_KEY } from './batch-store.js';
import { FLOWS_KEY } from './flow-store.js';

/** @typedef {import('../shared/backup.js').Backup} Backup */
/** @typedef {import('../shared/backup.js').BackupSource} BackupSource */
/** @typedef {import('../shared/backup.js').RestorePlan} RestorePlan */
/** @typedef {import('./flow-store.js').StoredFlow} StoredFlow */
/** @typedef {import('./batch-store.js').StoredBatch} StoredBatch */
/** @typedef {import('../shared/stop-rules.js').StopRule} StopRule */

/**
 * 保存しているデータ一式を、保存したままの形（ID で引ける形）で読み取ります。
 * @returns {Promise<{ flows: Record<string, StoredFlow>, batches: Record<string, StoredBatch>,
 *   stopRules: Record<string, StopRule> }>}
 */
async function readAll() {
  const stored = await chrome.storage.local.get([FLOWS_KEY, BATCHES_KEY, STOP_RULES_KEY]);
  const record = (/** @type {unknown} */ value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
  return {
    flows: /** @type {Record<string, StoredFlow>} */ (record(stored[FLOWS_KEY])),
    batches: /** @type {Record<string, StoredBatch>} */ (record(stored[BATCHES_KEY])),
    stopRules: /** @type {Record<string, StopRule>} */ (record(stored[STOP_RULES_KEY])),
  };
}

/**
 * @param {Awaited<ReturnType<typeof readAll>>} all
 * @returns {BackupSource}
 */
function toSource(all) {
  return {
    flows: Object.values(all.flows).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    batches: Object.values(all.batches).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    stopRules: all.stopRules,
  };
}

/**
 * 書き出すバックアップの内容を作ります。
 * @returns {Promise<Backup>}
 */
export async function exportBackup() {
  return createBackup(toSource(await readAll()), new Date());
}

/**
 * バックアップの内容を、保存しているデータに追加する計画を作ります。書き込みはしません。
 * 復元の前の確認で、追加する件数とサイトを表示するために使います。
 * @param {Backup} backup parseBackup で検証したもの
 * @returns {Promise<RestorePlan>}
 */
export async function previewRestore(backup) {
  return planRestore(backup, toSource(await readAll()), () => crypto.randomUUID(), new Date());
}

/**
 * バックアップの内容を、保存しているデータに追加します。既存のデータは変えません。
 * 確認を表示している間にデータが変わる場合に備え、書き込む直前に計画を作り直します。
 * @param {Backup} backup parseBackup で検証したもの
 * @returns {Promise<RestorePlan>}
 */
export async function restoreBackup(backup) {
  const all = await readAll();
  const plan = planRestore(backup, toSource(all), () => crypto.randomUUID(), new Date());
  await chrome.storage.local.set({
    [FLOWS_KEY]: {
      ...all.flows,
      ...Object.fromEntries(plan.flows.map((stored) => [stored.id, stored])),
    },
    [BATCHES_KEY]: {
      ...all.batches,
      ...Object.fromEntries(plan.batches.map((batch) => [batch.id, batch])),
    },
    [STOP_RULES_KEY]: { ...all.stopRules, ...plan.stopRules },
  });
  return plan;
}
