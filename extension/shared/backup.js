// すべてのフローと設定の一括バックアップと復元です（#17）。chrome.* は使いません。
//
// バックアップのファイルには、フロー、まとめフロー、必ず止まる場所をまとめて入れます。
// 復元は追加だけを行い、既存のデータを消しません。置き換えは既存のデータを失い、元に戻せないためです。
// 形式は docs/backup-format.md に記載しています。

import { BATCH_MAX_FLOWS, BATCH_NAME_MAX_LENGTH } from './batch.js';
import { namesForImport, flowContentKey } from './flow-file.js';
import { isWebOrigin, orderFlow, validateFlow } from './flow.js';
import { validateStopRule } from './stop-rules.js';

/** @typedef {import('./flow.js').Flow} Flow */
/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */
/** @typedef {import('../common/batch-store.js').StoredBatch} StoredBatch */
/** @typedef {import('./stop-rules.js').StopRule} StopRule */

/** ファイルの種類です。フローのファイルと取り違えて読み込まないために使います。 */
export const BACKUP_KIND = 'lightomate-backup';

/** バックアップの形式の版です。項目を変えるときに上げます。 */
export const BACKUP_VERSION = 1;

/** 1 つのバックアップから復元できるフローの件数の上限です。保存領域を使い切ることを防ぎます。 */
export const MAX_BACKUP_FLOWS = 1000;

/**
 * バックアップの内容です。
 * @typedef {object} Backup
 * @property {typeof BACKUP_KIND} kind
 * @property {number} version
 * @property {string} exportedAt 書き出した日時（ISO 8601）
 * @property {{ id: string, flow: Flow }[]} flows まとめフローから参照するため、ID も含めます
 * @property {{ name: string, flowIds: string[] }[]} batches
 * @property {Record<string, StopRule>} stopRules オリジンごとの指定
 */

/**
 * 保存しているデータ一式です。
 * @typedef {object} BackupSource
 * @property {StoredFlow[]} flows
 * @property {StoredBatch[]} batches
 * @property {Record<string, StopRule>} stopRules
 */

/**
 * 書き出すバックアップの内容を作ります。
 * @param {BackupSource} source
 * @param {Date} now
 * @returns {Backup}
 */
export function createBackup(source, now) {
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    flows: source.flows.map((stored) => ({ id: stored.id, flow: orderFlow(stored.flow) })),
    batches: source.batches.map((batch) => ({ name: batch.name, flowIds: [...batch.flowIds] })),
    stopRules: Object.fromEntries(
      Object.keys(source.stopRules)
        .sort()
        .map((origin) => [
          origin,
          {
            selectors: [...source.stopRules[origin].selectors],
            paths: [...source.stopRules[origin].paths],
          },
        ]),
    ),
  };
}

/**
 * バックアップのファイル名です。例：lightomate-backup-20260928-0930.json
 * @param {Date} now
 * @returns {string}
 */
export function backupFileName(now) {
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `lightomate-backup-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

/**
 * 読み込んだ JSON の値を検証し、バックアップにします。1 件でも誤りがあれば、何も復元しません。
 * どれが復元されたかをわかりにくくしないためです。
 * @param {unknown} value JSON.parse の結果
 * @returns {{ ok: true, backup: Backup } | { ok: false, errors: string[] }}
 */
export function parseBackup(value) {
  if (!isRecord(value) || value.kind !== BACKUP_KIND) {
    return {
      ok: false,
      errors: [
        'Lightomate のバックアップのファイルではありません。フローのファイルは、［保存したフロー］の［JSON から追加］で読み込みます。',
      ],
    };
  }
  if (!Number.isInteger(value.version) || /** @type {number} */ (value.version) < 1) {
    return { ok: false, errors: ['version が 1 以上の整数ではありません。'] };
  }
  if (/** @type {number} */ (value.version) > BACKUP_VERSION) {
    return {
      ok: false,
      errors: [
        `このバックアップは新しい版の Lightomate で作られています（形式の版 ${String(value.version)}）。Lightomate を更新してから復元してください。`,
      ],
    };
  }
  /** @type {string[]} */
  const errors = [];
  const { flows, batches, stopRules } = value;

  if (!Array.isArray(flows)) {
    errors.push('flows が配列ではありません。');
  } else if (flows.length > MAX_BACKUP_FLOWS) {
    errors.push(
      `フローが ${flows.length} 件あります。復元できるのは ${MAX_BACKUP_FLOWS} 件までです。`,
    );
  } else {
    const ids = new Set();
    for (const [index, entry] of flows.entries()) {
      const label = `フローの ${index + 1} 件目`;
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') {
        errors.push(`${label}に id がありません。`);
        continue;
      }
      if (ids.has(entry.id)) {
        errors.push(`${label}の id（${entry.id}）が、ほかのフローと重複しています。`);
      }
      ids.add(entry.id);
      errors.push(...validateFlow(entry.flow).map((error) => `${label}：${error}`));
    }
  }

  if (!Array.isArray(batches)) {
    errors.push('batches が配列ではありません。');
  } else {
    for (const [index, batch] of batches.entries()) {
      errors.push(
        ...batchErrors(batch).map((error) => `まとめフローの ${index + 1} 件目：${error}`),
      );
    }
  }

  if (!isRecord(stopRules)) {
    errors.push('stopRules がオブジェクトではありません。');
  } else {
    for (const [origin, rule] of Object.entries(stopRules)) {
      if (!isWebOrigin(origin)) {
        errors.push(
          `必ず止まる場所の「${origin}」が、サイトのオリジン（例：https://www.example.com）ではありません。`,
        );
        continue;
      }
      errors.push(
        ...validateStopRule(rule).map((error) => `必ず止まる場所（${origin}）：${error}`),
      );
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, backup: /** @type {Backup} */ (value) };
}

/**
 * 復元の結果です。
 * @typedef {object} RestorePlan
 * @property {StoredFlow[]} flows 追加するフロー
 * @property {StoredBatch[]} batches 追加するまとめフロー
 * @property {Record<string, StopRule>} stopRules 追加する必ず止まる場所
 * @property {Flow[]} duplicateFlows 同じ内容のフローがすでにあるため、追加しないフロー
 * @property {string[]} skippedBatches 同じ名前・同じフローのまとめフローがすでにあるため、追加しないもの
 * @property {string[]} skippedStopOrigins 同じサイトの指定がすでにあるため、追加しないサイト
 */

/**
 * 保存しているデータに、バックアップの内容を追加する計画を作ります。既存のデータは変えません。
 *
 * - フロー：保存済みのフローと内容が同じフローは追加せず、まとめフローからは保存済みのフローを参照します。
 *   同じサイトに同じ名前のフローがある場合は、名前に番号を付けます（［JSON から追加］と同じです）。
 * - まとめフロー：含むフローの ID を、追加したフロー（または同じ内容の保存済みのフロー）の ID に付け替えます。
 *   バックアップに含まれないフローの ID はそのまま残し、実行の前に誤りとして知らせます（batchProblems）。
 * - 必ず止まる場所：同じサイトの指定がすでにある場合は、保存済みの指定を残します。
 * @param {Backup} backup parseBackup で検証したもの
 * @param {BackupSource} current 保存しているデータ
 * @param {() => string} newId 新しい ID を作る関数
 * @param {Date} now
 * @returns {RestorePlan}
 */
export function planRestore(backup, current, newId, now) {
  const createdAt = now.toISOString();
  /** @type {Map<string, string>} 内容 → ID */
  const byContent = new Map(
    current.flows.map((stored) => [flowContentKey(stored.flow), stored.id]),
  );
  /** @type {Map<string, string>} バックアップの ID → 復元後の ID */
  const idMap = new Map();
  /** @type {{ id: string, flow: Flow }[]} */
  const fresh = [];
  /** @type {Flow[]} */
  const duplicateFlows = [];
  for (const { id, flow } of backup.flows) {
    const key = flowContentKey(flow);
    const existing = byContent.get(key);
    if (existing !== undefined) {
      idMap.set(id, existing);
      duplicateFlows.push(flow);
      continue;
    }
    const added = newId();
    idMap.set(id, added);
    byContent.set(key, added);
    fresh.push({ id: added, flow });
  }
  const names = namesForImport(
    fresh.map(({ flow }) => flow),
    current.flows,
  );
  const flows = fresh.map(({ id, flow }, index) => ({
    id,
    createdAt,
    updatedAt: createdAt,
    flow: { ...flow, name: names[index] },
  }));

  /** @type {StoredBatch[]} */
  const batches = [];
  /** @type {string[]} */
  const skippedBatches = [];
  const batchKey = (/** @type {{ name: string, flowIds: string[] }} */ batch) =>
    JSON.stringify([batch.name.trim(), batch.flowIds]);
  const knownBatches = new Set(current.batches.map(batchKey));
  for (const batch of backup.batches) {
    const mapped = {
      name: batch.name.trim(),
      flowIds: batch.flowIds.map((id) => idMap.get(id) ?? id),
    };
    if (knownBatches.has(batchKey(mapped))) {
      skippedBatches.push(mapped.name);
      continue;
    }
    knownBatches.add(batchKey(mapped));
    batches.push({ id: newId(), ...mapped, createdAt });
  }

  /** @type {Record<string, StopRule>} */
  const stopRules = {};
  /** @type {string[]} */
  const skippedStopOrigins = [];
  for (const [origin, rule] of Object.entries(backup.stopRules)) {
    if (Object.hasOwn(current.stopRules, origin)) {
      skippedStopOrigins.push(origin);
      continue;
    }
    // 空の指定は、保存するときと同じく、指定なしとして扱います。
    if (rule.selectors.length === 0 && rule.paths.length === 0) {
      continue;
    }
    stopRules[origin] = { selectors: [...rule.selectors], paths: [...rule.paths] };
  }

  return { flows, batches, stopRules, duplicateFlows, skippedBatches, skippedStopOrigins };
}

/**
 * まとめフロー 1 件の誤りを返します。保存するとき（batch-store.js の saveBatch）と同じ条件です。
 * @param {unknown} batch
 * @returns {string[]}
 */
function batchErrors(batch) {
  if (!isRecord(batch)) {
    return ['オブジェクトではありません。'];
  }
  /** @type {string[]} */
  const errors = [];
  if (typeof batch.name !== 'string' || batch.name.trim() === '') {
    errors.push('name がありません。');
  } else if (batch.name.trim().length > BATCH_NAME_MAX_LENGTH) {
    errors.push(`name は ${BATCH_NAME_MAX_LENGTH} 文字以内にしてください。`);
  }
  if (!Array.isArray(batch.flowIds) || batch.flowIds.some((id) => typeof id !== 'string')) {
    errors.push('flowIds が文字列の配列ではありません。');
  } else if (batch.flowIds.length > BATCH_MAX_FLOWS) {
    errors.push(`含められるフローは ${BATCH_MAX_FLOWS} 件までです。`);
  }
  return errors;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
