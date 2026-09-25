import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SUGGESTIONS,
  filterFlows,
  groupByHost,
  hostOf,
  matchesText,
  suggestions,
} from '../extension/shared/flow-search.js';

/**
 * @param {string} id
 * @param {string} name
 * @param {string} origin
 * @returns {import('../extension/common/flow-store.js').StoredFlow}
 */
function stored(id, name, origin) {
  return {
    id,
    flow: { schemaVersion: 1, name, origin, steps: [] },
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
}

const flows = [
  stored('1', '領収書 PDF', 'https://www.amazon.co.jp'),
  stored('2', 'Amazon 領収書の取得', 'https://www.amazon.co.jp'),
  stored('3', 'Amazon 領収書', 'https://www.amazon.co.jp'),
  stored('4', '請求書', 'https://billing.example.com'),
  stored('5', '再注文', 'http://amazon.co.jp'),
];

test('origin からホスト名を取り出す', () => {
  assert.equal(hostOf('https://www.amazon.co.jp'), 'www.amazon.co.jp');
  assert.equal(hostOf('http://localhost:8080'), 'localhost');
  assert.equal(hostOf('読み取れない'), '読み取れない');
});

test('部分一致・前方一致・後方一致で判定する', () => {
  assert.equal(matchesText('Amazon 領収書の取得', '領収書', 'contains'), true);
  assert.equal(matchesText('Amazon 領収書の取得', '領収書', 'prefix'), false);
  assert.equal(matchesText('領収書 PDF', '領収書', 'prefix'), true);
  assert.equal(matchesText('Amazon 領収書', '領収書', 'suffix'), true);
  assert.equal(matchesText('領収書 PDF', '領収書', 'suffix'), false);
});

test('大文字と小文字を区別せず、前後の空白を除いて比較する', () => {
  assert.equal(matchesText('Amazon 領収書', '  amazon ', 'prefix'), true);
  assert.equal(matchesText('amazon', 'AMAZON', 'suffix'), true);
});

test('全角と半角は区別する', () => {
  assert.equal(matchesText('ABC', 'ＡＢＣ', 'contains'), false);
});

test('検索語が空の場合は、すべて該当とする', () => {
  assert.equal(matchesText('何でも', '   ', 'prefix'), true);
  assert.equal(filterFlows(flows, '', 'contains').length, flows.length);
});

test('フロー名とホスト名のどちらかが条件に合うフローを返す', () => {
  const ids = (/** @type {typeof flows} */ list) => list.map((item) => item.id);
  assert.deepEqual(ids(filterFlows(flows, '領収書', 'contains')), ['1', '2', '3']);
  assert.deepEqual(ids(filterFlows(flows, '領収書', 'prefix')), ['1']);
  assert.deepEqual(ids(filterFlows(flows, '領収書', 'suffix')), ['3']);
  // ホスト名だけが一致するフローも含めます。
  assert.deepEqual(ids(filterFlows(flows, 'billing', 'prefix')), ['4']);
  assert.deepEqual(ids(filterFlows(flows, 'amazon.co.jp', 'suffix')), ['1', '2', '3', '5']);
});

test('ホスト名ごとにまとめ、ホスト名の順、まとまりの中はフロー名の順に並べる', () => {
  const groups = groupByHost(flows);
  assert.deepEqual(
    groups.map((group) => group.host),
    ['amazon.co.jp', 'billing.example.com', 'www.amazon.co.jp'],
  );
  assert.deepEqual(
    groups[2].flows.map((item) => item.flow.name),
    ['Amazon 領収書', 'Amazon 領収書の取得', '領収書 PDF'],
  );
});

test('該当するフローがないホスト名のまとまりは作らない', () => {
  assert.deepEqual(
    groupByHost(filterFlows(flows, '請求', 'contains')).map((group) => group.host),
    ['billing.example.com'],
  );
});

test('候補は、フロー名、ホスト名の順に、重複なく並べる', () => {
  assert.deepEqual(suggestions(flows, 'amazon', 'contains'), [
    { value: 'Amazon 領収書', kind: 'flow' },
    { value: 'Amazon 領収書の取得', kind: 'flow' },
    { value: 'amazon.co.jp', kind: 'site' },
    { value: 'www.amazon.co.jp', kind: 'site' },
  ]);
});

test('候補は、選んだ一致方法で条件に合うものだけにする', () => {
  assert.deepEqual(suggestions(flows, 'amazon', 'prefix'), [
    { value: 'Amazon 領収書', kind: 'flow' },
    { value: 'Amazon 領収書の取得', kind: 'flow' },
    { value: 'amazon.co.jp', kind: 'site' },
  ]);
});

test('検索語が空の場合は、候補を出さない', () => {
  assert.deepEqual(suggestions(flows, ' ', 'contains'), []);
});

test(`候補は最大 ${MAX_SUGGESTIONS} 件にする`, () => {
  const many = Array.from({ length: 15 }, (_, index) =>
    stored(String(index), `フロー ${String(index).padStart(2, '0')}`, 'https://www.example.com'),
  );
  const result = suggestions(many, 'フロー', 'prefix');
  assert.equal(result.length, MAX_SUGGESTIONS);
  assert.equal(result[0].value, 'フロー 00');
});
