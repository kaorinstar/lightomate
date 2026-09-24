// リリース用ワークフローが使う、タグとリリースノートの確認のテストです。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTag, extractReleaseNotes } from '../scripts/release-notes.js';

const changelog = `# 更新履歴

説明の文章です。

## Unreleased

- まだリリースしていない変更

## v0.2.0

- 2 つ目の変更
  （続きの行）

## v0.1.0

- 最初の変更
`;

test('タグと manifest.json の version が一致すれば問題はない', () => {
  assert.equal(checkTag('v0.1.0', '0.1.0'), null);
});

test('タグと manifest.json の version が一致しなければ失敗する', () => {
  assert.match(checkTag('v0.2.0', '0.1.0') ?? '', /一致しません/);
});

test('v を付けないタグや、先頭にゼロを付けたタグは受け付けない', () => {
  for (const tag of ['0.1.0', 'v0.01.0', 'v2026.9.24.1', '']) {
    assert.match(checkTag(tag, '0.1.0') ?? '', /形式ではありません/, tag);
  }
});

test('タグと同じ見出しの節の本文だけを取り出す', () => {
  assert.equal(extractReleaseNotes(changelog, 'v0.2.0'), '- 2 つ目の変更\n  （続きの行）');
  assert.equal(extractReleaseNotes(changelog, 'v0.1.0'), '- 最初の変更');
});

test('節がない場合は失敗する（Unreleased の見出しを変更し忘れた場合）', () => {
  assert.equal(extractReleaseNotes(changelog, 'v0.3.0'), null);
});

test('見出しの一部だけが一致する節は取り出さない', () => {
  assert.equal(extractReleaseNotes('## v0.1.0-beta\n\n- 変更\n', 'v0.1.0'), null);
});

test('本文が空の節は失敗する', () => {
  assert.equal(extractReleaseNotes('## v0.1.0\n\n## v0.0.1\n\n- 変更\n', 'v0.1.0'), null);
});

test('改行コードが CRLF でも取り出せる', () => {
  assert.equal(extractReleaseNotes('## v0.1.0\r\n\r\n- 変更\r\n', 'v0.1.0'), '- 変更');
});
