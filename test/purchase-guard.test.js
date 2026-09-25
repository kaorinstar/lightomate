import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findConfirmText,
  guardRecordedStep,
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
