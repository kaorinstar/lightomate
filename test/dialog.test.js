import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runStatusText } from '../extension/shared/describe.js';
import { decideDialog } from '../extension/shared/dialog.js';
import { historyEntryFromRun } from '../extension/shared/history.js';

test('手順の dialog の順に応答する（#88）', () => {
  const confirm = { type: 'confirm', message: '削除しますか？' };
  assert.deepEqual(decideDialog(confirm, ['accept', 'dismiss'], 0), {
    action: 'respond',
    response: 'accept',
  });
  assert.deepEqual(decideDialog(confirm, ['accept', 'dismiss'], 1), {
    action: 'respond',
    response: 'dismiss',
  });
  assert.deepEqual(decideDialog({ type: 'alert', message: '保存しました。' }, ['accept'], 0), {
    action: 'respond',
    response: 'accept',
  });
  assert.deepEqual(decideDialog({ type: 'beforeunload', message: '' }, ['dismiss'], 0), {
    action: 'respond',
    response: 'dismiss',
  });
});

test('指定がない場合と、指定を使い切った後は、一時停止する（#88）', () => {
  const alert = { type: 'alert', message: '入力に誤りがあります。' };
  assert.deepEqual(decideDialog(alert, undefined, 0), {
    action: 'pause',
    note: 'サイトが知らせのダイアログ（「入力に誤りがあります。」）を表示しました。手順に応答の指定（dialog）がないため、応答していません。ダイアログに手で応答してください。',
  });
  assert.deepEqual(decideDialog(alert, ['accept'], 1), {
    action: 'pause',
    note: 'サイトが知らせのダイアログ（「入力に誤りがあります。」）を表示しました。手順の応答の指定（dialog）は 1 回分で、使い切っているため、応答していません。ダイアログに手で応答してください。',
  });
});

test('文字を入力するダイアログには、指定があっても応答しない（#88）', () => {
  const decision = decideDialog({ type: 'prompt', message: '名前' }, ['accept'], 0);
  assert.equal(decision.action, 'pause');
  assert.match(
    decision.action === 'pause' ? decision.note : '',
    /文字を入力するダイアログには、自動では応答しません/,
  );
});

test('確定を表す語を含む確認には、accept の指定があっても応答せずに実行を終える（#88）', () => {
  for (const type of ['confirm', 'beforeunload']) {
    const decision = decideDialog({ type, message: 'ご注文を確定しますか？' }, ['accept'], 0);
    assert.equal(decision.action, 'halt', type);
    assert.match(decision.action === 'halt' ? decision.note : '', /確定を表す語を含むため/);
  }
  // 全角や空白の揺れがあっても判定します。
  assert.equal(
    decideDialog({ type: 'confirm', message: 'Ｐｌａｃｅ ｙｏｕｒ ｏｒｄｅｒ?' }, ['accept'], 0)
      .action,
    'halt',
  );
  // ［キャンセル］は進まない応答のため、そのまま応答します。
  assert.deepEqual(
    decideDialog({ type: 'confirm', message: '注文を確定しますか？' }, ['dismiss'], 0),
    {
      action: 'respond',
      response: 'dismiss',
    },
  );
  // alert は［OK］しかなく、閉じても操作は進まないため、そのまま応答します。
  assert.deepEqual(
    decideDialog({ type: 'alert', message: '注文を確定しました。' }, ['accept'], 0),
    {
      action: 'respond',
      response: 'accept',
    },
  );
});

test('止まった理由のダイアログの文言は、空白を詰め、200 文字で切る（#88）', () => {
  const long = decideDialog({ type: 'confirm', message: `${'あ'.repeat(250)}` }, undefined, 0);
  assert.match(long.action === 'pause' ? long.note : '', new RegExp(`「${'あ'.repeat(200)}…」`));
  const spaced = decideDialog({ type: 'confirm', message: '  一行目\n\n二行目  ' }, undefined, 0);
  assert.match(
    spaced.action === 'pause' ? spaced.note : '',
    /確認のダイアログ（「一行目 二行目」）/,
  );
  const empty = decideDialog({ type: 'beforeunload', message: '' }, undefined, 0);
  assert.match(
    empty.action === 'pause' ? empty.note : '',
    /^サイトがページを離れるかの確認を表示しました。/,
  );
});

test('ダイアログで止まった理由を、実行中の説明と実行履歴に表示する（#88）', () => {
  const paused = decideDialog({ type: 'alert', message: '在庫がありません。' }, undefined, 0);
  assert.equal(paused.action, 'pause');
  const note = paused.action === 'pause' ? paused.note : '';
  assert.match(
    runStatusText({ flowName: '注文', status: 'paused', stepIndex: 2, total: 5, note }, undefined),
    /一時停止しています。サイトが知らせのダイアログ（「在庫がありません。」）を表示しました。.*続ける場合は［再開］を押してください。$/,
  );

  // 実行を終えた場合は、実行履歴の理由に残します。入力した値は伏せます。
  const halted = decideDialog(
    { type: 'confirm', message: '山田 太郎 様の注文を確定しますか？' },
    ['accept'],
    0,
  );
  assert.equal(halted.action, 'halt');
  const entry = historyEntryFromRun(
    {
      runId: 'r',
      flowId: 'f',
      flowName: '注文',
      origin: 'https://www.example.com',
      status: 'halted',
      stepIndex: 2,
      total: 5,
      error: halted.action === 'halt' ? halted.note : '',
      startedAt: '2026-09-26T00:00:00.000Z',
    },
    '2026-09-26T00:01:00.000Z',
    ['山田 太郎'],
  );
  assert.ok(entry?.reason);
  assert.match(entry.reason, /確定を表す語を含むため/);
  assert.doesNotMatch(entry.reason, /山田/);
});
