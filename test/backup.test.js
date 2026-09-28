// すべてのフローと設定の一括バックアップ（extension/shared/backup.js、#17）のテストです。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_KIND,
  BACKUP_VERSION,
  backupFileName,
  createBackup,
  parseBackup,
  planRestore,
} from '../extension/shared/backup.js';
import { SCHEMA_VERSION } from '../extension/shared/flow.js';

/** @typedef {import('../extension/shared/flow.js').Flow} Flow */
/** @typedef {import('../extension/shared/backup.js').BackupSource} BackupSource */

/**
 * @param {string} name
 * @param {string} [path]
 * @returns {Flow}
 */
function flow(name, path = '/') {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    origin: 'https://www.example.com',
    steps: [{ type: 'navigate', url: `https://www.example.com${path}`, cause: 'user' }],
  };
}

const now = new Date(2026, 8, 28, 9, 5);

/** @returns {BackupSource} */
function source() {
  return {
    flows: [
      { id: 'a', createdAt: '2026-01-01', updatedAt: '2026-01-01', flow: flow('領収書', '/a') },
      { id: 'b', createdAt: '2026-01-02', updatedAt: '2026-01-02', flow: flow('請求書', '/b') },
    ],
    batches: [{ id: 'x', name: '月初', flowIds: ['a', 'b'], createdAt: '2026-01-03' }],
    stopRules: { 'https://www.example.com': { selectors: ['#placeOrder'], paths: [] } },
  };
}

/** @returns {BackupSource} */
function empty() {
  return { flows: [], batches: [], stopRules: {} };
}

/** 呼ぶたびに new-1、new-2 … を返す関数を作ります。 */
function ids() {
  let count = 0;
  return () => `new-${(count += 1)}`;
}

test('書き出しの内容は、フロー・まとめフロー・必ず止まる場所をすべて含み、kind と version を持つ', () => {
  const backup = createBackup(source(), now);
  assert.equal(backup.kind, BACKUP_KIND);
  assert.equal(backup.version, BACKUP_VERSION);
  assert.equal(backup.exportedAt, now.toISOString());
  assert.deepEqual(
    backup.flows.map(({ id, flow }) => [id, flow.name]),
    [
      ['a', '領収書'],
      ['b', '請求書'],
    ],
  );
  assert.deepEqual(backup.batches, [{ name: '月初', flowIds: ['a', 'b'] }]);
  assert.deepEqual(backup.stopRules, {
    'https://www.example.com': { selectors: ['#placeOrder'], paths: [] },
  });
});

test('書き出した内容は JSON を経由しても検証を通る', () => {
  const parsed = parseBackup(JSON.parse(JSON.stringify(createBackup(source(), now))));
  assert.equal(parsed.ok, true);
});

test('ファイル名は lightomate-backup-年月日-時分.json', () => {
  assert.equal(backupFileName(now), 'lightomate-backup-20260928-0905.json');
});

test('kind が違うファイル（フローのファイルなど）は誤りとする', () => {
  for (const value of [
    flow('a'),
    [flow('a')],
    null,
    { ...createBackup(source(), now), kind: 'x' },
  ]) {
    const parsed = parseBackup(value);
    assert.equal(parsed.ok, false);
    assert.match(!parsed.ok ? parsed.errors[0] : '', /バックアップのファイルではありません/);
  }
});

test('version が新しすぎるファイルと、整数でない version は誤りとする', () => {
  const backup = createBackup(source(), now);
  const newer = parseBackup({ ...backup, version: BACKUP_VERSION + 1 });
  assert.equal(newer.ok, false);
  assert.match(!newer.ok ? newer.errors[0] : '', /Lightomate を更新してから/);
  for (const version of [0, 1.5, '1', undefined]) {
    assert.equal(parseBackup({ ...backup, version }).ok, false, `値: ${String(version)}`);
  }
});

test('形式に誤りのあるフローを 1 件でも含むファイルは、誤りとして何も復元しない', () => {
  const backup = createBackup(source(), now);
  const broken = {
    ...backup,
    flows: [...backup.flows, { id: 'c', flow: { ...flow('壊れた'), steps: 'x' } }],
  };
  const parsed = parseBackup(broken);
  assert.equal(parsed.ok, false);
  assert.match(!parsed.ok ? parsed.errors.join('\n') : '', /フローの 3 件目/);
});

test('フローの id の欠落・重複、まとめフロー・必ず止まる場所の誤りを報告する', () => {
  const backup = createBackup(source(), now);
  for (const value of [
    { ...backup, flows: [{ flow: flow('a') }] },
    { ...backup, flows: [backup.flows[0], { ...backup.flows[1], id: 'a' }] },
    { ...backup, batches: [{ name: '', flowIds: [] }] },
    { ...backup, batches: [{ name: 'a', flowIds: [1] }] },
    { ...backup, stopRules: { 'https://www.example.com/path': { selectors: [], paths: [] } } },
    { ...backup, stopRules: { 'https://www.example.com': { selectors: 'x', paths: [] } } },
    { ...backup, flows: {} },
  ]) {
    assert.equal(parseBackup(value).ok, false, JSON.stringify(value).slice(0, 120));
  }
});

test('空の環境に復元すると、すべてを追加し、まとめフローのフロー ID を新しい ID に付け替える', () => {
  const backup = createBackup(source(), now);
  const plan = planRestore(backup, empty(), ids(), now);
  assert.deepEqual(
    plan.flows.map(({ id, flow }) => [id, flow.name]),
    [
      ['new-1', '領収書'],
      ['new-2', '請求書'],
    ],
  );
  assert.deepEqual(
    plan.batches.map(({ id, name, flowIds }) => ({ id, name, flowIds })),
    [{ id: 'new-3', name: '月初', flowIds: ['new-1', 'new-2'] }],
  );
  assert.deepEqual(Object.keys(plan.stopRules), ['https://www.example.com']);
  assert.deepEqual(plan.duplicateFlows, []);
  assert.deepEqual(plan.skippedBatches, []);
  assert.deepEqual(plan.skippedStopOrigins, []);
});

test('同じ内容のフローは追加せず、まとめフローは保存済みのフローを参照する', () => {
  const backup = createBackup(source(), now);
  const current = empty();
  current.flows = [
    { id: 'kept', createdAt: '', updatedAt: '', flow: { ...flow('名前だけ違う', '/a') } },
  ];
  const plan = planRestore(backup, current, ids(), now);
  assert.deepEqual(
    plan.flows.map(({ flow }) => flow.name),
    ['請求書'],
  );
  assert.deepEqual(
    plan.duplicateFlows.map((flow) => flow.name),
    ['領収書'],
  );
  assert.deepEqual(plan.batches[0].flowIds, ['kept', 'new-1']);
});

test('同じサイトに同じ名前のフローがある場合は、名前に番号を付ける', () => {
  const backup = createBackup(source(), now);
  const current = empty();
  current.flows = [{ id: 'other', createdAt: '', updatedAt: '', flow: flow('領収書', '/other') }];
  const plan = planRestore(backup, current, ids(), now);
  assert.equal(plan.flows[0].flow.name, '領収書 (2)');
});

test('バックアップに含まれないフローの ID は、付け替えずにそのまま残す', () => {
  const backup = {
    ...createBackup(source(), now),
    batches: [{ name: 'b', flowIds: ['a', 'gone'] }],
  };
  const plan = planRestore(backup, empty(), ids(), now);
  assert.deepEqual(plan.batches[0].flowIds, ['new-1', 'gone']);
});

test('同じサイトの必ず止まる場所がすでにある場合は、保存済みの指定を残す', () => {
  const backup = createBackup(source(), now);
  const current = empty();
  current.stopRules = { 'https://www.example.com': { selectors: ['#mine'], paths: [] } };
  const plan = planRestore(backup, current, ids(), now);
  assert.deepEqual(plan.stopRules, {});
  assert.deepEqual(plan.skippedStopOrigins, ['https://www.example.com']);
});

test('同じバックアップを 2 回復元しても、何も重複しない', () => {
  const backup = createBackup(source(), now);
  const first = planRestore(backup, empty(), ids(), now);
  const afterFirst = {
    flows: first.flows,
    batches: first.batches,
    stopRules: first.stopRules,
  };
  const second = planRestore(backup, afterFirst, ids(), now);
  assert.deepEqual(second.flows, []);
  assert.deepEqual(second.batches, []);
  assert.deepEqual(second.stopRules, {});
  assert.equal(second.duplicateFlows.length, 2);
  assert.deepEqual(second.skippedBatches, ['月初']);
  assert.deepEqual(second.skippedStopOrigins, ['https://www.example.com']);
});

test('復元の計画は、元のバックアップと保存済みのデータを変えない', () => {
  const backup = createBackup(source(), now);
  const before = JSON.stringify(backup);
  const current = source();
  const currentBefore = JSON.stringify(current);
  planRestore(backup, current, ids(), now);
  assert.equal(JSON.stringify(backup), before);
  assert.equal(JSON.stringify(current), currentBefore);
});
