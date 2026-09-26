// 一覧で選んだフローの扱い（extension/shared/flow-selection.js）のテストです（#83）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pruneSelection,
  selectAllState,
  splitDeletable,
} from '../extension/shared/flow-selection.js';

test('［すべて選択］の状態を、表示中のフローと選択から決める', () => {
  const shown = ['a', 'b', 'c'];
  assert.equal(selectAllState(shown, new Set()), 'none');
  assert.equal(selectAllState(shown, new Set(['a'])), 'some');
  assert.equal(selectAllState(shown, new Set(['a', 'b', 'c'])), 'all');
  // 表示していないフローの選択は数えません。
  assert.equal(selectAllState(shown, new Set(['x'])), 'none');
  assert.equal(selectAllState([], new Set()), 'none');
});

test('検索で表示から外れたフローの選択を外す', () => {
  const selected = new Set(['a', 'b', 'c']);
  assert.deepEqual([...pruneSelection(selected, ['b', 'd'])], ['b']);
  // 元の選択は変えません。
  assert.equal(selected.size, 3);
});

test('一括削除で、実行中のフローを削除の対象から外す', () => {
  const runs = [
    { flowId: 'a', status: 'running' },
    { flowId: 'b', status: 'paused' },
    { flowId: 'c', status: 'done' },
  ];
  assert.deepEqual(splitDeletable(['a', 'b', 'c', 'd'], runs), {
    remove: ['c', 'd'],
    running: ['a', 'b'],
  });
  assert.deepEqual(splitDeletable(['c'], []), { remove: ['c'], running: [] });
});
