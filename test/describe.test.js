// 手順とパラメータの説明（extension/shared/describe.js）のテストです。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeParam, describeStep, stepKindLabel } from '../extension/shared/describe.js';

const target = { selectors: ['#a'], tag: 'button', label: '注文履歴', text: '注文履歴' };

test('手順の種類を短い名前にする', () => {
  assert.equal(stepKindLabel({ type: 'click', target }), 'クリック');
  assert.equal(stepKindLabel({ type: 'input', target, value: 'x' }), '入力');
  assert.equal(stepKindLabel({ type: 'pause' }), '一時停止');
});

test('年月の既定値の @previous-month と @current-month を、前月と今月と表示する', () => {
  assert.equal(
    describeParam({ name: 't', label: '対象月', type: 'month', default: '@previous-month' }),
    '年月・既定値は前月',
  );
  assert.equal(
    describeParam({ name: 't', label: '対象月', type: 'month', default: '@current-month' }),
    '年月・既定値は今月',
  );
});

test('選択肢と、既定値がない場合を表示する', () => {
  assert.equal(
    describeParam({ name: 's', label: '店舗', type: 'select', options: ['本店', '支店'] }),
    '選択肢（本店、支店）・既定値なし',
  );
  assert.equal(
    describeParam({ name: 'n', label: '数量', type: 'number', default: '3' }),
    '数値・既定値は3',
  );
});

test('待機の手順は「3 秒待つ」の形で説明する（#15）', () => {
  assert.equal(describeStep({ type: 'wait', ms: 3000 }), '3 秒待つ');
  assert.equal(describeStep({ type: 'wait', ms: 1500 }), '1.5 秒待つ');
  assert.equal(stepKindLabel({ type: 'wait', ms: 3000 }), '待機');
});
