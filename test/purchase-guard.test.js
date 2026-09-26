import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findConfirm,
  findConfirmKey,
  findConfirmText,
  guardRecordedStep,
  normalizeKey,
  normalizeText,
} from '../extension/shared/purchase-guard.js';

test('表記の揺れを揃える（全角と半角、大文字と小文字、空白）', () => {
  assert.equal(normalizeText('Ｐｌａｃｅ  Your\nOrder'), 'placeyourorder');
  assert.equal(normalizeText(' 注文を 確定する '), '注文を確定する');
});

test('確定ボタンの文言を、確定ボタンと判定する', () => {
  for (const text of [
    '注文を確定する',
    'ご注文を確定',
    '注文する',
    'この商品を購入する',
    '購入を確定する',
    '今すぐ購入',
    '今すぐ買う',
    '支払う',
    'お支払いを確定する',
    '決済する',
    'この内容で申し込む',
    '申込む',
    'Place your order',
    'PLACE ORDER',
    'Buy Now',
    'Ｂｕｙ　ｎｏｗ',
    'Pay now',
    'Complete purchase',
    'Confirm Purchase',
    'Confirm order',
    'Submit order',
  ]) {
    assert.equal(findConfirmText([text]), text, `文言: ${text}`);
  }
});

test('確定の前の画面へ進むボタンなどは、確定ボタンと判定しない', () => {
  for (const text of [
    '購入手続きへ進む',
    'レジに進む',
    'カートに入れる',
    '注文履歴',
    '注文内容を確認',
    '支払い方法を選択',
    'Proceed to checkout',
    'Add to cart',
    'Your orders',
    'ログイン',
    '',
  ]) {
    assert.equal(findConfirmText([text]), undefined, `文言: ${text}`);
  }
});

test('複数の文言のうち、確定を表す語を含むものを返す', () => {
  assert.equal(findConfirmText(['', 'ボタン', '注文を確定する']), '注文を確定する');
  assert.equal(findConfirmText([]), undefined);
});

const target = { selectors: ['#submit'], tag: 'button', label: '次へ', text: '次へ' };

test('記録時、確定ボタンのクリックを一時停止の手順に置き換える', () => {
  const result = guardRecordedStep({ type: 'click', target }, ['注文を確定する']);
  assert.equal(result.confirmText, '注文を確定する');
  assert.equal(result.step.type, 'pause');
  assert.match(
    /** @type {{ note: string }} */ (result.step).note,
    /確定ボタン「注文を確定する」の手前/,
  );
});

test('記録時、要素の文言が届かなくても、手順の説明で判定する', () => {
  const step = { type: 'click', target: { ...target, label: '購入を確定する' } };
  assert.equal(guardRecordedStep(/** @type {any} */ (step), []).step.type, 'pause');
});

test('記録時、確定ボタンでないクリックと、クリック以外の手順は変えない', () => {
  const click = /** @type {const} */ ({ type: 'click', target });
  assert.deepEqual(guardRecordedStep(click, ['次へ']), { step: click });

  const input = /** @type {const} */ ({
    type: 'input',
    target: { ...target, tag: 'input', label: '購入する数' },
    value: '1',
  });
  assert.deepEqual(guardRecordedStep(input, ['購入する']), { step: input });
});

// ---- 翻訳で文字が置き換わる場合（#97） ----

test('英語の確定ボタンを翻訳した言い回しも、確定ボタンと判定する（#97）', () => {
  for (const text of [
    '購入を完了する',
    '注文を完了',
    '注文を送信する',
    '支払いを完了する',
    '購入を確認する',
  ]) {
    assert.equal(findConfirmText([text]), text, `文言: ${text}`);
  }
  // 確定の前の画面の文言は、これまでどおり判定しません。
  for (const text of ['注文内容を確認', '購入手続きへ進む', 'チェックアウトに進む']) {
    assert.equal(findConfirmText([text]), undefined, `文言: ${text}`);
  }
});

test('翻訳で変わらない手がかりは、英数字以外を除いて比べる（#97）', () => {
  assert.equal(normalizeKey('place-your_order Button'), 'placeyourorderbutton');
  assert.equal(normalizeKey('#submitOrderButtonId'), 'submitorderbuttonid');
});

test('要素の id、name、class、リンク先、フォームの送信先、セレクターに確定を表す語があれば判定する（#97）', () => {
  for (const key of [
    'placeYourOrder1',
    'submitOrderButtonId',
    'btn btn-primary place-order',
    'buy_now_button',
    '/checkout/complete-purchase',
    '#placeOrder',
    'button[name="placeYourOrder1"]',
    '/gp/buy/spc/handlers/place-order.html',
  ]) {
    assert.equal(findConfirmKey([key]), key, `手がかり: ${key}`);
  }
  for (const key of [
    'proceedToCheckout',
    'add-to-cart-button',
    '#main > div:nth-of-type(2) > button',
    '/gp/css/order-history',
    'nav-orders',
  ]) {
    assert.equal(findConfirmKey([key]), undefined, `手がかり: ${key}`);
  }
});

test('文言で判定できない場合は、手がかりで判定し、手順の説明を理由に使う（#97）', () => {
  // 翻訳で「ご注文手続き完了」のような一覧にない言い回しになった場合です。
  assert.equal(
    findConfirm(['ご注文手続き完了'], ['placeOrder'], 'ご注文手続き完了'),
    'ご注文手続き完了',
  );
  assert.equal(findConfirm(['ご注文手続き完了'], ['placeOrder'], ''), 'placeOrder');
  // 文言で判定できた場合は、その文言を使います。
  assert.equal(findConfirm(['注文を確定する'], ['placeOrder'], 'ボタン'), '注文を確定する');
  assert.equal(findConfirm(['次へ'], ['next-page'], '次へ'), undefined);
});

test('記録時、文言が翻訳されていても、手がかりで確定ボタンを一時停止に置き換える（#97）', () => {
  const step = {
    type: 'click',
    target: {
      selectors: ['#po'],
      tag: 'button',
      label: 'ご注文手続き完了',
      text: 'ご注文手続き完了',
    },
  };
  const guarded = guardRecordedStep(
    /** @type {any} */ (step),
    ['ご注文手続き完了'],
    ['po', 'btn-place-order'],
  );
  assert.equal(guarded.step.type, 'pause');
  assert.equal(guarded.confirmText, 'ご注文手続き完了');
  // 記録したセレクターにも手がかりがあれば、要素の手がかりが届かなくても判定します。
  const bySelector = {
    type: 'click',
    target: { selectors: ['#placeYourOrder'], tag: 'input', label: '送信' },
  };
  assert.equal(guardRecordedStep(/** @type {any} */ (bySelector), []).step.type, 'pause');
  // 手がかりに確定を表す語がなければ、これまでどおりクリックとして記録します。
  assert.equal(
    guardRecordedStep(/** @type {any} */ (step), ['ご注文手続き完了'], ['po']).step.type,
    'click',
  );
});
