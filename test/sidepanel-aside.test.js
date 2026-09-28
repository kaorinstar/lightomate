// サイドパネルの「フローの管理」への案内（#108）が、各タブの区画の枠の外にあることを確かめます。
// 規則は docs/design-guidelines.md の「2. 画面の構成」と「3. 部品の使い方」に記載しています。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sidepanel = readFileSync(
  new URL('../extension/sidepanel/sidepanel.html', import.meta.url),
  'utf8',
);

/** タブの内容（#panel-flows）の HTML です。 */
const panel = sidepanel.slice(
  sidepanel.indexOf('<div id="panel-flows"'),
  sidepanel.indexOf('id="panel-batches"'),
);

test('案内は、フローの一覧の区画の後ろ（枠の外）で、タブの内容の中にある', () => {
  const cardEnd = panel.indexOf('</section>');
  const aside = panel.indexOf('<p class="lm-sub lm-aside">');
  assert.ok(cardEnd > 0, '区画が見つかりません');
  assert.ok(aside > cardEnd, '案内が区画の中にあります');
  assert.equal(panel.includes('card-footer'), false);
});

test('案内の記号は読み上げの対象から外し、「フローの管理」は管理画面へのリンクにする', () => {
  const aside = panel.slice(panel.indexOf('<p class="lm-sub lm-aside">'));
  assert.match(aside, /<span class="lm-aside-mark" aria-hidden="true">ⓘ<\/span>/);
  assert.match(
    aside,
    /<a href="\.\.\/options\/options\.html" target="_blank"\s*>\s*フローの管理<\/a/,
  );
  assert.match(aside, /<span id="flows-aside-scope">ほかのサイトのフローの確認、<\/span>/);
});

test('まとめフローの案内も、区画の後ろ（枠の外）で、タブの内容の中にある', () => {
  const batches = sidepanel.slice(
    sidepanel.indexOf('<div id="panel-batches"'),
    sidepanel.indexOf('</main>'),
  );
  const cardEnd = batches.indexOf('</section>');
  const aside = batches.indexOf('<p class="lm-sub lm-aside">');
  assert.ok(cardEnd > 0, '区画が見つかりません');
  assert.ok(aside > cardEnd, '案内が区画の中にあります');
  assert.equal(batches.includes('card-footer'), false);
  assert.match(batches.slice(aside), /<span class="lm-aside-mark" aria-hidden="true">ⓘ<\/span>/);
  assert.match(
    batches.slice(aside),
    /<a href="\.\.\/options\/options\.html" target="_blank"\s*>\s*フローの管理<\/a/,
  );
});
