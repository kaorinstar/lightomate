// 実行中の異常への対応（extension/shared/run-guard.js、#18）のテストです。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authPauseNoteForPage,
  isLoginUrl,
  isRetryableFailure,
  shouldPauseForAuth,
} from '../extension/shared/run-guard.js';

const target = { selectors: ['#a'], tag: 'button', label: 'ボタン' };
/** @type {import('../extension/shared/flow.js').Step} */
const click = { type: 'click', target };
const none = { password: false, oneTimeCode: false, captcha: false, loginForm: false };
const password = { ...none, password: true };

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

test('ページの移動の後に止まった場合は、表示してほしい移動先を説明に含める', () => {
  const note = authPauseNoteForPage('https://a.example.com/orders');
  assert.match(note, /［再開］/);
  assert.ok(note.endsWith('https://a.example.com/orders'));
});

test('Amazon のように ID だけを尋ねるログインの画面でも、URL から止める', () => {
  assert.equal(
    shouldPauseForAuth({
      signals: none,
      currentUrl:
        'https://www.amazon.co.jp/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.co.jp',
      expectedUrl: 'https://www.amazon.co.jp/checkout/entry/cart',
      step: click,
    }),
    true,
  );
});

test('ログインの画面を示す語を、区切られた語としてだけ判定する', () => {
  for (const url of [
    'https://www.amazon.co.jp/ap/signin?x=1',
    'https://a.example.com/login',
    'https://a.example.com/users/sign_in',
    'https://a.example.com/account/log-in/',
    'https://a.example.com/auth/start',
    'https://a.example.com/login.php',
  ]) {
    assert.equal(isLoginUrl(url), true, url);
  }
  for (const url of [
    'https://a.example.com/author/1',
    'https://a.example.com/blog/designing-logins',
    'https://a.example.com/orders?next=/login',
    'https://a.example.com/',
  ]) {
    assert.equal(isLoginUrl(url), false, url);
  }
});
