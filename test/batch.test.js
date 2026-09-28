// まとめフローの一括実行の判定（extension/shared/batch.js）のテストです（#7）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_MAX_PARALLEL,
  HELD_LIMIT_MS,
  abortItem,
  acknowledgeItem,
  batchConflictMessage,
  batchConflicts,
  batchItemLabel,
  batchItemTone,
  batchOverall,
  batchProblems,
  batchSummary,
  expireHeld,
  finishItem,
  hasWaitingFollower,
  isBatchFinished,
  needsAttention,
  nextToStart,
  skipWaiting,
} from '../extension/shared/batch.js';

/** @typedef {import('../extension/shared/batch.js').BatchItem} BatchItem */

const A = 'https://a.example.com';
const B = 'https://b.example.com';
const C = 'https://c.example.com';
const D = 'https://d.example.com';

/**
 * @param {string} flowId
 * @param {string} origin
 * @param {BatchItem['status']} [status]
 * @returns {BatchItem}
 */
function item(flowId, origin, status = 'waiting') {
  return { flowId, flowName: flowId, origin, status };
}

const now = new Date('2026-09-28T10:00:00Z');

test('同じサイトのフローは登録順に 1 件ずつ、別のサイトのフローは並行して始める', () => {
  const items = [item('a1', A), item('b1', B), item('a2', A), item('b2', B)];
  assert.deepEqual(nextToStart(items), [0, 1]);

  // a1 の実行中は a2 を始めません。
  const running = items.map((entry, i) =>
    i < 2 ? { ...entry, status: /** @type {const} */ ('running') } : entry,
  );
  assert.deepEqual(nextToStart(running), []);

  // a1 が完了すると、a2 を始めます。
  const afterA1 = finishItem(running, 0, 'done', undefined, now);
  assert.deepEqual(nextToStart(afterA1), [2]);
});

test('別のサイトのフローを並行して始める数は、上限を超えない', () => {
  assert.equal(BATCH_MAX_PARALLEL, 3);
  const items = [item('a', A), item('b', B), item('c', C), item('d', D)];
  assert.deepEqual(nextToStart(items), [0, 1, 2]);

  const started = items.map((entry, i) =>
    i < 3 ? { ...entry, status: /** @type {const} */ ('running') } : entry,
  );
  assert.deepEqual(nextToStart(started), []);

  // 1 件が終わると、空いた 1 件分だけ始めます。
  assert.deepEqual(nextToStart(finishItem(started, 1, 'done', undefined, now)), [3]);
  // 確定の手前で止まったフロー（held）は、並行して実行する数に数えません。
  assert.deepEqual(nextToStart(finishItem(started, 1, 'halted', undefined, now)), [3]);
});

test('同じサイトの前のフローが一時停止中・確定の手前で停止の間は、次のフローを始めない', () => {
  // 一時停止中の実行は、一括実行の中では running のままです。
  const paused = [item('a1', A, 'running'), item('a2', A)];
  assert.deepEqual(nextToStart(paused), []);

  const held = finishItem(paused, 0, 'halted', undefined, now);
  assert.equal(held[0].status, 'held');
  assert.equal(held[0].heldAt, now.toISOString());
  assert.deepEqual(nextToStart(held), []);
  assert.equal(isBatchFinished(held), false);

  // ［確認済み・次へ］の後に始めます。
  const acknowledged = acknowledgeItem(held, 0);
  assert.ok(acknowledged.ok);
  assert.equal(acknowledged.items[0].status, 'done');
  assert.deepEqual(nextToStart(acknowledged.items), [1]);
});

test('［確認済み・次へ］は、同じサイトの次のフローを待っている held のフローだけに使える', () => {
  const last = finishItem([item('a1', A, 'running'), item('b1', B)], 0, 'halted', undefined, now);
  assert.equal(hasWaitingFollower(last, 0), false);
  assert.equal(acknowledgeItem(last, 0).ok, false);
  assert.equal(acknowledgeItem([item('a1', A, 'running'), item('a2', A)], 0).ok, false);
});

test('同じサイトの前のフローが失敗・中止した場合は、残りを未実行にし、別のサイトは続ける', () => {
  const items = [
    item('a1', A, 'running'),
    item('b1', B, 'running'),
    item('a2', A),
    item('a3', A),
    item('b2', B),
  ];

  const failed = finishItem(items, 0, 'failed', '要素が見つかりません。', now);
  assert.equal(failed[0].status, 'failed');
  assert.equal(failed[0].note, '要素が見つかりません。');
  assert.deepEqual(
    failed.map((entry) => entry.status),
    ['failed', 'running', 'skipped', 'skipped', 'waiting'],
  );
  assert.match(failed[2].note ?? '', /前の「a1」が失敗したため/);
  assert.deepEqual(nextToStart(failed), []);
  // 別のサイトは、前のフローが終われば続けます。
  assert.deepEqual(nextToStart(finishItem(failed, 1, 'done', undefined, now)), [4]);

  const stopped = finishItem(items, 0, 'stopped', undefined, now);
  assert.deepEqual(
    stopped.map((entry) => entry.status),
    ['stopped', 'running', 'skipped', 'skipped', 'waiting'],
  );
  assert.match(stopped[2].note ?? '', /中止したため/);
});

test('まだ始めていないフローと、held のフローの［中止］', () => {
  const items = [item('a1', A), item('a2', A), item('b1', B)];
  const aborted = abortItem(items, 0);
  assert.deepEqual(
    aborted.map((entry) => entry.status),
    ['skipped', 'skipped', 'waiting'],
  );
  assert.deepEqual(nextToStart(aborted), [2]);

  const held = finishItem([item('a1', A, 'running'), item('a2', A)], 0, 'halted', undefined, now);
  const abortedHeld = abortItem(held, 0);
  assert.deepEqual(
    abortedHeld.map((entry) => entry.status),
    ['held', 'skipped'],
  );
  assert.equal(isBatchFinished(abortedHeld), true);

  // 実行中のフローは、停止を求めた後、実行が終わったときに扱うため、変えません。
  const running = [item('a1', A, 'running')];
  assert.equal(abortItem(running, 0), running);
});

test('緊急停止などで、まだ始めていないフローをすべて未実行にする', () => {
  const items = [item('a1', A, 'running'), item('b1', B), item('c1', C, 'held')];
  assert.deepEqual(
    skipWaiting(items, '緊急停止のため、実行しませんでした。').map((entry) => entry.status),
    ['running', 'skipped', 'held'],
  );
});

test('［確認済み・次へ］を 30 分押されなかった場合は、同じサイトの後のフローを未実行にする', () => {
  const held = finishItem([item('a1', A, 'running'), item('a2', A)], 0, 'halted', undefined, now);
  const before = new Date(now.getTime() + HELD_LIMIT_MS - 1);
  assert.equal(expireHeld(held, before), held);
  const after = expireHeld(held, new Date(now.getTime() + HELD_LIMIT_MS));
  assert.equal(after[1].status, 'skipped');
  assert.match(after[1].note ?? '', /30 分以内/);
  assert.equal(isBatchFinished(after), true);
});

test('実行中のフローと同じサイトのフローを含む場合は、一括実行を始めず、重なっているサイトを返す', () => {
  const runs = [
    { origin: A, flowName: '発注', status: 'paused' },
    { origin: C, flowName: '終わった', status: 'done' },
  ];
  assert.deepEqual(batchConflicts([A, B, C], runs, []), [{ origin: A, flowName: '発注' }]);
  assert.deepEqual(batchConflicts([B, C], runs, []), []);

  // ほかの一括実行でまだ終わっていないフロー（次を待っている held を含む）も、実行中として扱います。
  const other = {
    batchRunId: 'x',
    batchId: 'y',
    name: '別のまとめ',
    startedAt: '',
    items: [item('b1', B, 'held'), item('b2', B), item('c1', C, 'held')],
  };
  assert.deepEqual(batchConflicts([B, C, D], [], [other]), [{ origin: B, flowName: 'b1' }]);

  const message = batchConflictMessage([{ origin: A, flowName: '発注' }]);
  assert.match(message, /まとめて実行できません/);
  assert.match(message, /https:\/\/a\.example\.com（「発注」を実行中）/);
});

test('最初の手順がページの移動でないフローと、削除済みのフローを含む場合は誤りにする', () => {
  const navigate = [{ type: 'navigate' }, { type: 'click' }];
  const flows = [
    { id: 'a', flow: { name: '発注 A', origin: A, steps: navigate } },
    { id: 'b', flow: { name: '発注 B', origin: B, steps: navigate } },
    { id: 'c', flow: { name: '表示中のページ', origin: C, steps: [{ type: 'click' }] } },
  ];
  assert.deepEqual(batchProblems(['a', 'b'], flows), []);
  assert.deepEqual(batchProblems(['a', 'c'], flows), [
    '「表示中のページ」は、最初の手順がページを開く手順ではないため、まとめて実行できません。',
  ]);
  assert.match(batchProblems(['a', 'deleted'], flows)[0], /1 件が削除されています/);
  assert.match(batchProblems(['a'], flows)[0], /2 件以上/);
  assert.match(batchProblems(['a', 'a'], flows)[0], /同じフローを 2 回/);
});

test('フロー 1 件の状態の表示', () => {
  assert.equal(batchItemLabel(item('a', A), undefined), '待機中');
  assert.equal(batchItemLabel(item('a', A, 'running'), { status: 'running' }), '実行中');
  assert.equal(batchItemLabel(item('a', A, 'running'), { status: 'paused' }), '一時停止中');
  assert.equal(batchItemLabel(item('a', A, 'held'), undefined), '確定の手前で停止');
  assert.equal(batchItemLabel(item('a', A, 'skipped'), undefined), '未実行');
});

test('一括実行全体の進み具合の文と、全体の状態の印', () => {
  const items = [
    { ...item('a1', A, 'done') },
    { ...item('b1', B, 'running'), runId: 'r1' },
    item('a2', A),
    item('c1', C, 'skipped'),
  ];
  const summary = batchSummary(items);
  assert.equal(summary.ended, 2);
  assert.equal(summary.total, 4);
  assert.equal(summary.text, '4 件中 2 件が終了');

  assert.deepEqual(batchOverall(items, [{ runId: 'r1', status: 'running' }]), {
    label: '実行中',
    tone: 'primary',
  });
  // 一時停止中のフローがあれば、操作待ちです。
  assert.equal(batchOverall(items, [{ runId: 'r1', status: 'paused' }]).label, '操作待ち');
  // 次のフローを待っている、確定の手前のフローがあれば、操作待ちです。
  const held = [item('a1', A, 'held'), item('a2', A)];
  assert.equal(batchOverall(held, []).label, '操作待ち');

  assert.equal(batchOverall([item('a', A, 'done'), item('b', B, 'done')], []).label, '完了');
  assert.deepEqual(batchOverall([item('a', A, 'done'), item('b', B, 'failed')], []), {
    label: '失敗あり',
    tone: 'danger',
  });
  assert.equal(batchOverall([item('a', A, 'done'), item('b', B, 'skipped')], []).label, '終了');
});

test('操作が必要な行（実行中・確定の手前・失敗）だけに、ボタンと進み具合の文を出す', () => {
  assert.equal(needsAttention(item('a', A, 'running')), true);
  assert.equal(needsAttention(item('a', A, 'held')), true);
  assert.equal(needsAttention(item('a', A, 'failed')), true);
  for (const status of /** @type {const} */ (['waiting', 'done', 'stopped', 'skipped'])) {
    assert.equal(needsAttention(item('a', A, status)), false);
  }
});

test('状態の印の色は、操作が必要な状態を目立たせる', () => {
  assert.equal(batchItemTone(item('a', A, 'done'), undefined), 'success');
  assert.equal(batchItemTone(item('a', A, 'running'), { status: 'running' }), 'primary');
  assert.equal(batchItemTone(item('a', A, 'running'), { status: 'paused' }), 'warning');
  assert.equal(batchItemTone(item('a', A, 'held'), undefined), 'warning');
  assert.equal(batchItemTone(item('a', A, 'failed'), undefined), 'danger');
  assert.equal(batchItemTone(item('a', A, 'skipped'), undefined), 'muted');
});
