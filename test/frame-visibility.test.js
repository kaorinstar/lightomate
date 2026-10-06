import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isVisibleFrame, visibleFrameOrigins } from '../extension/shared/frame-visibility.js';

// ---- 枠（iframe）が画面に見えるかの判定（#230） ----

/** 決済の入力欄のような、見える枠です。 */
const card = {
  origin: 'https://pay.example.net',
  width: 360,
  height: 160,
  display: 'inline',
  visibility: 'visible',
  opacity: 1,
  right: 400,
  bottom: 300,
};

test('基準の大きさ以上で、表示されている枠は、見える枠とする', () => {
  assert.equal(isVisibleFrame(card), true);
  assert.equal(isVisibleFrame({ ...card, width: 30, height: 30 }), true);
});

test('1×1px の計測用の枠と、幅か高さが 30px 未満の枠は、見えない枠とする', () => {
  assert.equal(isVisibleFrame({ ...card, width: 1, height: 1 }), false);
  assert.equal(isVisibleFrame({ ...card, width: 0, height: 0 }), false);
  assert.equal(isVisibleFrame({ ...card, height: 29 }), false);
});

test('display: none、visibility: hidden、透明度 0 の枠は、見えない枠とする', () => {
  assert.equal(isVisibleFrame({ ...card, display: 'none' }), false);
  assert.equal(isVisibleFrame({ ...card, visibility: 'hidden' }), false);
  assert.equal(isVisibleFrame({ ...card, opacity: 0 }), false);
});

test('画面の左上の外側に置いた枠は、見えない枠とする', () => {
  assert.equal(isVisibleFrame({ ...card, right: -9000 }), false);
  assert.equal(isVisibleFrame({ ...card, bottom: -1 }), false);
});

test('同じサイトの枠が複数ある場合は、1 つでも見えればそのサイトを含める', () => {
  const tracker = { ...card, origin: 'https://ads.example.org', width: 1, height: 1 };
  const origins = visibleFrameOrigins([tracker, { ...card, width: 1 }, card]);
  assert.deepEqual([...origins], ['https://pay.example.net']);
});

test('形が正しくない値と、サイトが読み取れない枠は捨てる', () => {
  assert.deepEqual([...visibleFrameOrigins(null)], []);
  assert.deepEqual([...visibleFrameOrigins([{ origin: 'https://x.example' }, 'x'])], []);
  assert.deepEqual([...visibleFrameOrigins([{ ...card, origin: '' }])], []);
  assert.deepEqual([...visibleFrameOrigins([{ ...card, width: Number.NaN }])], []);
});
