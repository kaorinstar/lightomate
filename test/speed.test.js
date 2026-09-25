// 実行速度（extension/shared/speed.js、#15）のテストです。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_INTERVAL,
  MAX_INTERVAL_MS,
  formatSeconds,
  parseSeconds,
  pickDelay,
  stepInterval,
} from '../extension/shared/speed.js';

test('待つ時間は、最短と最長の範囲内の整数になる', () => {
  const interval = { min: 1000, max: 3000 };
  assert.equal(
    pickDelay(interval, () => 0),
    1000,
  );
  assert.equal(
    pickDelay(interval, () => 0.5),
    2000,
  );
  assert.equal(
    pickDelay(interval, () => 0.9999999),
    3000,
  );
  for (let i = 0; i < 1000; i += 1) {
    const delay = pickDelay(interval);
    assert.ok(Number.isInteger(delay) && delay >= 1000 && delay <= 3000, `値: ${delay}`);
  }
});

test('最短と最長が同じ場合は、その値になる', () => {
  assert.equal(
    pickDelay({ min: 2000, max: 2000 }, () => 0.7),
    2000,
  );
  assert.equal(
    pickDelay({ min: 0, max: 0 }, () => 0.7),
    0,
  );
});

test('interval を省略したフローの間隔は、既定の 1,000 ミリ秒になる', () => {
  assert.deepEqual(stepInterval({}), { min: 1000, max: 1000 });
  assert.equal(stepInterval({}), DEFAULT_INTERVAL);
  assert.deepEqual(stepInterval({ interval: { min: 0, max: 500 } }), { min: 0, max: 500 });
});

test('画面で入力した秒数を、小数第 1 位までミリ秒にする', () => {
  assert.deepEqual(parseSeconds('1.5', MAX_INTERVAL_MS), { ok: true, ms: 1500 });
  assert.deepEqual(parseSeconds(' 3 ', MAX_INTERVAL_MS), { ok: true, ms: 3000 });
  assert.deepEqual(parseSeconds('0', MAX_INTERVAL_MS), { ok: true, ms: 0 });
  assert.deepEqual(parseSeconds('60', MAX_INTERVAL_MS), { ok: true, ms: 60000 });
  for (const text of ['', '-1', '1.25', 'a', '1e3', '６０']) {
    assert.equal(parseSeconds(text, MAX_INTERVAL_MS).ok, false, `値: ${text}`);
  }
  assert.equal(parseSeconds('60.1', MAX_INTERVAL_MS).ok, false);
});

test('ミリ秒を秒数で表示する', () => {
  assert.equal(formatSeconds(1000), '1');
  assert.equal(formatSeconds(1500), '1.5');
  assert.equal(formatSeconds(0), '0');
});
