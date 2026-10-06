import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WATCH_MESSAGE_VALUE_LENGTH,
  firstDecision,
  watchDecision,
  watchMessage,
} from '../extension/shared/watch-value.js';

test('初回の実行（前回の値がない）は知らせずに覚え、前回と同じ値は何もしない（#251）', () => {
  assert.equal(firstDecision(undefined, '在庫なし'), 'remember');
  assert.equal(firstDecision('在庫なし', '在庫なし'), 'same');
  assert.equal(firstDecision('在庫なし', '在庫あり'), 'recheck');
});

test('読み直した値が 1 回目と同じで前回と異なる場合だけ知らせる（#251）', () => {
  assert.equal(watchDecision('在庫なし', '在庫あり', '在庫あり'), 'notify');
  // 翻訳で文字が置き換わる途中の値です。知らせず、覚えもしません。
  assert.equal(watchDecision('Out of stock', '在庫なし', 'Out of stock'), 'same');
  assert.equal(watchDecision('Out of stock', '在庫なし', 'In stock'), 'unsettled');
});

test('通知の本文は、要素の説明と前回・今回の値を載せ、長い値を短くする（#251）', () => {
  assert.equal(
    watchMessage('在庫', '在庫なし', '在庫あり'),
    '「在庫」の値が変わりました：前回 在庫なし → 今回 在庫あり',
  );
  const long = 'あ'.repeat(WATCH_MESSAGE_VALUE_LENGTH + 5);
  assert.equal(
    watchMessage('説明', long, '短い'),
    `「説明」の値が変わりました：前回 ${'あ'.repeat(WATCH_MESSAGE_VALUE_LENGTH)}… → 今回 短い`,
  );
});
