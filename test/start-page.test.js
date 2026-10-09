import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rebaseOrigin, withOpenPage } from '../extension/shared/start-page.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */

/**
 * @param {string} text
 * @returns {Step}
 */
const click = (text) => ({
  type: 'click',
  target: { selectors: ['.x'], tag: 'button', label: text, text },
});

test('最初の手順が「ページを開く」でない場合は、表示中のページを開く手順を先頭に加える（#277）', () => {
  /** @type {Step[]} */
  const steps = [click('前の操作')];
  const opened = withOpenPage(
    {
      steps,
      rowHints: ['行'],
      pagerHints: [null],
      origin: 'https://shop.example.com',
      extraOrigins: [],
    },
    'https://shop.example.com/orders',
  );
  assert.ok(opened);
  assert.deepEqual(opened.steps, [
    { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
    steps[0],
  ]);
  assert.deepEqual(opened.rowHints, [null, '行']);
  assert.deepEqual(opened.pagerHints, [null, null]);
  assert.equal(opened.origin, 'https://shop.example.com');
  assert.deepEqual(opened.extraOrigins, []);
});

test('0 件の状態でも、表示中のページを開く手順を加える（#277）', () => {
  const opened = withOpenPage(
    {
      steps: [],
      rowHints: [],
      pagerHints: [],
      origin: 'https://shop.example.com',
      extraOrigins: [],
    },
    'https://shop.example.com/orders',
  );
  assert.ok(opened);
  assert.deepEqual(opened.steps, [
    { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' },
  ]);
});

test('最初の手順が「ページを開く」の場合は、何も加えない（#277）', () => {
  assert.equal(
    withOpenPage(
      {
        steps: [{ type: 'navigate', url: 'https://shop.example.com/', cause: 'user' }, click('a')],
        rowHints: [null, null],
        pagerHints: [null, null],
        origin: 'https://shop.example.com',
        extraOrigins: [],
      },
      'https://shop.example.com/orders',
    ),
    undefined,
  );
});

test('表示中のページのサイトが記録を始めたサイトと異なる場合は、そのサイトを origin にする（#277）', () => {
  const opened = withOpenPage(
    {
      steps: [click('前の操作')],
      rowHints: [null],
      pagerHints: [null],
      origin: 'https://www.example.com',
      extraOrigins: ['https://order.example.com'],
    },
    'https://order.example.com/history',
  );
  assert.ok(opened);
  assert.equal(opened.origin, 'https://order.example.com');
  // 元のサイトで記録した手順には、元のサイトを書き、extraOrigins に残します。
  assert.equal(/** @type {any} */ (opened.steps[1]).origin, 'https://www.example.com');
  assert.deepEqual(opened.extraOrigins, ['https://www.example.com']);
});

test('使わなくなった元のサイトは extraOrigins に残さない', () => {
  const rebased = rebaseOrigin(
    [{ type: 'navigate', url: 'https://order.example.com/history', cause: 'user' }],
    'https://www.example.com',
    'https://order.example.com/history',
    [],
  );
  assert.deepEqual(rebased.extraOrigins, []);
  assert.equal(rebased.origin, 'https://order.example.com');
});
