// 手順とパラメータの説明（extension/shared/describe.js）のテストです。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeParam,
  describeStep,
  runStatusText,
  stepKindLabel,
} from '../extension/shared/describe.js';

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

test('一時停止中の状態の説明に、手順の番号と次の手順を含める（#37）', () => {
  const run = { flowName: '領収書', status: 'paused', stepIndex: 2, total: 8 };
  assert.equal(
    runStatusText(run, { type: 'click', target }),
    '「領収書」は 手順 3 / 8 の前で一時停止しています（次の手順：クリック：注文履歴）。' +
      '続ける場合は［再開］を押してください。',
  );
  assert.match(
    runStatusText({ ...run, note: '確定は手で行ってください。' }, undefined),
    /の前で一時停止しています。確定は手で行ってください。続ける場合は/,
  );
});

test('一時停止の処理中の説明に、実行中の手順を含める（#37）', () => {
  const run = { flowName: '領収書', status: 'pausing', stepIndex: 0, total: 8 };
  assert.match(runStatusText(run, { type: 'click', target }), /手順 1 \/ 8（クリック：注文履歴）/);
});

test('条件分岐と繰り返しの手順の説明（#6）', () => {
  assert.equal(
    describeStep({ type: 'if', condition: { target, exists: true }, then: [] }),
    '条件：「注文履歴」がある場合',
  );
  assert.equal(
    describeStep({ type: 'if', condition: { target, exists: false }, then: [] }),
    '条件：「注文履歴」がない場合',
  );
  assert.equal(
    describeStep({ type: 'forEach', items: target, steps: [] }),
    '繰り返し：「注文履歴」の各行（上限 100 件）',
  );
  assert.equal(stepKindLabel({ type: 'forEach', items: target, max: 5, steps: [] }), '繰り返し');
  assert.equal(
    stepKindLabel({ type: 'if', condition: { target, exists: true }, then: [] }),
    '条件',
  );
});

test('繰り返しの中では、手順の番号に何件目かを添える（#6）', () => {
  const run = { flowName: 'a', status: 'running', stepIndex: 4, total: 9, items: [3] };
  assert.equal(runStatusText(run, undefined), '「a」を実行中です。手順 5 / 9（3 件目）');
});
