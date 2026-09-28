// 領収書のフローの手引き（docs/receipt-flow.md、#8）に載せた例の JSON を確かめます。
// 手引きを読んだ利用者が貼り付けたときに、形式の誤りにならないようにするためです。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { validateFlow } from '../extension/shared/flow.js';

const example = JSON.parse(
  readFileSync(new URL('../docs/examples/receipt-flow.json', import.meta.url), 'utf8'),
);
const guide = readFileSync(new URL('../docs/receipt-flow.md', import.meta.url), 'utf8');

test('手引きの例の JSON は、フロー定義の検証を通る', () => {
  assert.deepEqual(validateFlow(example), []);
});

test('例の対象月は前月が既定で、同じ名前の PDF は上書きする', () => {
  assert.deepEqual(example.params, [
    { name: 'month', label: '対象月', type: 'month', default: '@previous-month' },
  ]);
  const text = JSON.stringify(example);
  assert.match(
    text,
    /"type":"savePdf","path":"Lightomate\/領収書\/[^"]+","onConflict":"overwrite"/,
  );
});

test('手引きに書いた要素の指定の例は、例の JSON と一致する', () => {
  const text = JSON.stringify(example);
  for (const selector of [
    'tr.order-row',
    'a.next:not(.disabled)',
    '.order-date',
    '.order-number',
    'a.receipt',
  ]) {
    assert.ok(guide.includes(`\`${selector}\``), `手引きに ${selector} がありません`);
    assert.ok(text.includes(JSON.stringify(selector)), `例の JSON に ${selector} がありません`);
  }
});
