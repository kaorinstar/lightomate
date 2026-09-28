// フローの管理画面の［設定］タブの免責事項（#109）を確かめます。
// 詳しい内容は README.md を正とし、画面は要約とリンクに限ります。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const options = readFileSync(new URL('../extension/options/options.html', import.meta.url), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** ［設定］のタブの HTML です。 */
const settings = options.slice(
  options.indexOf('<section id="panel-settings"'),
  options.indexOf('</section>', options.indexOf('<section id="panel-settings"')),
);

test('［設定］のタブに「免責事項」のカードがあり、LICENSE と README.md へのリンクを含む', () => {
  assert.match(settings, /<h2 class="card-title">免責事項<\/h2>/);
  const card = settings.slice(settings.indexOf('免責事項'));
  assert.match(card, /href="https:\/\/github\.com\/kaorinstar\/lightomate\/blob\/main\/LICENSE"/);
  assert.match(
    card,
    /href="https:\/\/github\.com\/kaorinstar\/lightomate\/blob\/main\/README\.md#[^"]+"/,
  );
});

test('リンクは新しいタブで開き、開いたページから元の画面を操作させない', () => {
  const card = settings.slice(settings.indexOf('免責事項'));
  const links = [...card.matchAll(/<a\s[^>]*>/g)].map((match) => match[0]);
  assert.equal(links.length, 2);
  for (const link of links) {
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener"/);
  }
});

test('README.md へのリンクの見出しが、README.md にある', () => {
  const href = /README\.md#([^"]+)"/.exec(settings)?.[1] ?? '';
  const heading = decodeURIComponent(href);
  assert.equal(heading, '利用上の注意');
  assert.match(readme, new RegExp(`^## ${heading}$`, 'm'));
});
