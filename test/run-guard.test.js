// 実行中の異常への対応（extension/shared/run-guard.js、#18）のテストです。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  expectedPageUrl,
  isRetryableFailure,
  shouldPauseForAuth,
} from '../extension/shared/run-guard.js';

const target = { selectors: ['#a'], tag: 'button', label: 'ボタン' };
/** @type {import('../extension/shared/flow.js').Step} */
const click = { type: 'click', target };
const none = { password: false, oneTimeCode: false, captcha: false };
const password = { ...none, password: true };

test('直前のページの移動の URL を返す', () => {
  /** @type {import('../extension/shared/flow.js').Step[]} */
  const steps = [
    { type: 'navigate', cause: 'user', url: 'https://a.example.com/orders' },
    click,
    { type: 'navigate', cause: 'page', url: 'https://a.example.com/orders/1' },
    click,
  ];
  assert.equal(expectedPageUrl(steps, 1), 'https://a.example.com/orders');
  assert.equal(expectedPageUrl(steps, 3), 'https://a.example.com/orders/1');
  assert.equal(expectedPageUrl(steps, 0), undefined);
});

test('認証の画面の印があり、パスが直前の移動と異なる場合は止める', () => {
  for (const signals of [password, { ...none, oneTimeCode: true }, { ...none, captcha: true }]) {
    assert.equal(
      shouldPauseForAuth({
        signals,
        currentUrl: 'https://a.example.com/signin?return=/orders',
        expectedUrl: 'https://a.example.com/orders',
        step: click,
      }),
      true,
      JSON.stringify(signals),
    );
  }
});

test('パスが直前の移動と同じ場合は止めない（ログインの画面を記録したフロー）', () => {
  assert.equal(
    shouldPauseForAuth({
      signals: password,
      currentUrl: 'https://a.example.com/signin/?step=2',
      expectedUrl: 'https://a.example.com/signin',
      step: click,
    }),
    false,
  );
});

test('認証の画面の印がない場合は止めない', () => {
  assert.equal(
    shouldPauseForAuth({
      signals: none,
      currentUrl: 'https://a.example.com/other',
      expectedUrl: 'https://a.example.com/orders',
      step: click,
    }),
    false,
  );
});

test('パスワードなど値を記録していない入力欄への入力の手順では止めない', () => {
  assert.equal(
    shouldPauseForAuth({
      signals: password,
      currentUrl: 'https://a.example.com/signin',
      expectedUrl: 'https://a.example.com/orders',
      step: { type: 'input', target: { ...target, tag: 'input' }, secret: true },
    }),
    false,
  );
});

test('直前のページの移動がない場合は止めない', () => {
  assert.equal(
    shouldPauseForAuth({
      signals: password,
      currentUrl: 'https://a.example.com/signin',
      expectedUrl: undefined,
      step: click,
    }),
    false,
  );
});

test('要素が見つからなかった失敗だけを、やり直す', () => {
  assert.equal(
    isRetryableFailure({ ok: false, notFound: true, error: '要素が見つかりません' }),
    true,
  );
  for (const response of [
    { ok: false, error: '見つかった要素が入力欄ではありません。' },
    { ok: false, error: 'クリックの前に確かめた要素が、ページから消えました。' },
    { ok: true },
    { ok: true, notFound: true },
    undefined,
    null,
  ]) {
    assert.equal(isRetryableFailure(response), false, JSON.stringify(response));
  }
});
