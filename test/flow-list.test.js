import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RUN_KEY_PREFIX,
  conflictMessage,
  findConflictingRun,
  flowSites,
  flowsForOrigin,
  flowsToShow,
  isActiveRun,
  pageOrigin,
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

test('一時停止の処理中と一時停止中のフローも、重なる実行として返す（#37）', () => {
  const pausing = run('領収書', shop, 'pausing');
  const paused = run('納品書', shop, 'paused');
  assert.equal(findConflictingRun(shop, [pausing]), pausing);
  assert.equal(findConflictingRun(shop, [paused]), paused);
  // Service Worker の起動時に、実行中のまま残った状態を中断として記録する判定にも使います。
  assert.equal(isActiveRun(paused), true);
  assert.equal(isActiveRun(pausing), true);
  assert.equal(isActiveRun(run('A', shop, 'halted')), false);
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

test('Web ページを表示している場合は、そのサイトのフローだけを表示する', () => {
  const flows = [entry('1', '領収書', shop), entry('2', '納品書', www)];
  const shown = flowsToShow(flows, shop);
  assert.equal(shown.scope, 'site');
  assert.deepEqual(
    shown.flows.map((stored) => stored.id),
    ['1'],
  );
});

test('Web ページでもそのサイトのフローがない場合は、ほかのサイトのフローを表示しない', () => {
  const flows = [entry('1', '領収書', shop)];
  assert.deepEqual(flowsToShow(flows, 'https://other.example.com'), { scope: 'site', flows: [] });
});

test('Web ページ以外を表示している場合は、すべてのフローを表示する', () => {
  const flows = [entry('1', '領収書', shop), entry('2', '納品書', www)];
  for (const origin of [null, undefined, '']) {
    const shown = flowsToShow(flows, origin);
    assert.equal(shown.scope, 'all');
    assert.deepEqual(
      shown.flows.map((stored) => stored.id),
      ['1', '2'],
    );
  }
});

test('Web ページだけにオリジンを返し、それ以外のページでは null を返す', () => {
  assert.equal(pageOrigin('https://shop.example.com/orders?page=2'), shop);
  assert.equal(pageOrigin('http://localhost:8080/'), 'http://localhost:8080');
  for (const url of [
    'chrome://newtab/',
    'about:blank',
    'chrome://settings/',
    'file:///C:/Users/me/receipt.pdf',
    'chrome-extension://abcdefghijklmnop/viewer.html',
    '',
    undefined,
  ]) {
    assert.equal(pageOrigin(url), null, String(url));
  }
});

test('追加のサイトと、移動の手順の URL のサイトのページでも、フローを返す（#41）', () => {
  const item = 'https://item.rakuten.co.jp';
  const cart = 'https://cart.step.rakuten.co.jp';
  const login = 'https://login.account.rakuten.com';
  const flows = [
    {
      id: '1',
      flow: {
        name: '楽天',
        origin: item,
        extraOrigins: [cart],
        steps: [
          { type: 'navigate', url: `${item}/shop/1/` },
          { type: 'click' },
          { type: 'navigate', url: `${login}/sso/authorize?x=1` },
          { type: 'navigate', url: 'https://{{host}}/a' },
        ],
      },
    },
    entry('2', '別のサイト', 'https://other.example.com'),
  ];
  for (const origin of [item, cart, login]) {
    assert.deepEqual(
      flowsForOrigin(flows, origin).map((stored) => stored.id),
      ['1'],
      origin,
    );
  }
  assert.deepEqual(flowsForOrigin(flows, 'https://www.rakuten.co.jp'), []);
  assert.deepEqual([...flowSites(flows[0].flow)], [item, cart, login]);
});
