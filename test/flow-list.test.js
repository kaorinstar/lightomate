import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RUN_KEY_PREFIX,
  conflictMessage,
  findConflictingRun,
  flowsForOrigin,
  runStatesFrom,
  uniqueName,
} from '../extension/shared/flow-list.js';

const shop = 'https://shop.example.com';
const www = 'https://www.example.com';

/**
 * @param {string} id
 * @param {string} name
 * @param {string} origin
 */
function entry(id, name, origin) {
  return { id, flow: { name, origin } };
}

/**
 * @param {string} flowName
 * @param {string} origin
 * @param {string} status
 */
function run(flowName, origin, status) {
  return { flowName, origin, status, startedAt: '2026-09-25T00:00:00.000Z' };
}

test('表示中のサイトと同じオリジンのフローだけを、順序を保って返す', () => {
  const flows = [
    entry('1', '領収書', shop),
    entry('2', '納品書', www),
    entry('3', '再注文', shop),
    entry('4', 'ポート違い', 'https://shop.example.com:8443'),
  ];
  assert.deepEqual(
    flowsForOrigin(flows, shop).map((stored) => stored.id),
    ['1', '3'],
  );
  assert.deepEqual(flowsForOrigin(flows, 'https://other.example.com'), []);
});

test('オリジンが分からないページでは、フローを返さない', () => {
  const flows = [entry('1', '領収書', shop)];
  assert.deepEqual(flowsForOrigin(flows, null), []);
  assert.deepEqual(flowsForOrigin(flows, ''), []);
});

test('同じサイトに同じ名前がなければ、名前を変えない', () => {
  const flows = [entry('1', '領収書', www), entry('2', '納品書', shop)];
  assert.equal(uniqueName('領収書', shop, flows), '領収書');
});

test('同じサイトに同じ名前があれば、番号を付ける', () => {
  const flows = [entry('1', '領収書', shop)];
  assert.equal(uniqueName('領収書', shop, flows), '領収書 (2)');
});

test('番号が使われている場合は、空いている番号を付ける', () => {
  const flows = [
    entry('1', '領収書', shop),
    entry('2', '領収書 (2)', shop),
    entry('3', '領収書 (4)', shop),
  ];
  assert.equal(uniqueName('領収書', shop, flows), '領収書 (3)');
});

test('番号付きの名前が重なる場合は、番号を除いた名前から数え直す', () => {
  const flows = [entry('1', '領収書', shop), entry('2', '領収書 (2)', shop)];
  assert.equal(uniqueName('領収書 (2)', shop, flows), '領収書 (3)');
});

test('名前を変えるフロー自身とは比べない', () => {
  const flows = [entry('1', '領収書', shop)];
  assert.equal(uniqueName('領収書', shop, flows, '1'), '領収書');
});

test('同じサイトで実行中、または停止の処理中のフローを、重なる実行として返す', () => {
  const running = run('領収書', shop, 'running');
  const stopping = run('納品書', shop, 'stopping');
  assert.equal(findConflictingRun(shop, [run('A', www, 'running'), running]), running);
  assert.equal(findConflictingRun(shop, [stopping]), stopping);
});

test('別のサイトの実行と、終わった実行は、重ならないものとして扱う', () => {
  const runs = [
    run('A', www, 'running'),
    run('B', shop, 'done'),
    run('C', shop, 'failed'),
    run('D', shop, 'stopped'),
  ];
  assert.equal(findConflictingRun(shop, runs), undefined);
  assert.equal(findConflictingRun(shop, []), undefined);
});

test('重なる実行の説明に、サイトと実行中のフロー名を含める', () => {
  assert.match(conflictMessage(shop, '領収書'), /shop\.example\.com では「領収書」を実行中/);
  assert.match(conflictMessage(shop, ''), /別のフローを実行中/);
});

test('保存した内容から、実行の状態だけを始めた日時の順に取り出す', () => {
  const later = { ...run('B', shop, 'running'), startedAt: '2026-09-25T01:00:00.000Z' };
  const earlier = run('A', www, 'done');
  const states = runStatesFrom({
    recording: { origin: shop },
    lastFlow: {},
    [`${RUN_KEY_PREFIX}b`]: later,
    [`${RUN_KEY_PREFIX}a`]: earlier,
  });
  assert.deepEqual(states, [earlier, later]);
});
