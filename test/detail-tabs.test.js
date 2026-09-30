// フローの管理画面の、フローの詳細のタブ（#132）の構造を確かめます。
// タブは WAI-ARIA の Tabs パターンに従い、タブと区画（tabpanel）を id で対応させます。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const options = readFileSync(new URL('../extension/options/options.html', import.meta.url), 'utf8');

/**
 * 開始タグの属性を取り出します。
 * @param {string} tag
 * @returns {Record<string, string>}
 */
function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
}

const detailTabs = [
  ...options.matchAll(/<button[^>]*data-detail-tab="[^"]*"[^>]*>\s*([^<]+?)\s*</g),
].map(
  (match) => /** @type {Record<string, string>} */ ({ ...attributes(match[0]), label: match[1] }),
);

test('フローの詳細のタブは［手順］［実行速度］［定期実行］［JSON］の 4 つである', () => {
  assert.deepEqual(
    detailTabs.map((tab) => tab.label),
    ['手順', '実行速度', '定期実行', 'JSON'],
  );
  for (const tab of detailTabs) {
    assert.equal(tab.role, 'tab');
  }
});

test('各タブの aria-controls が、そのタブを見出しとする tabpanel を指している', () => {
  for (const tab of detailTabs) {
    const panel = options.match(new RegExp(`<div\\s+id="${tab['aria-controls']}"[^>]*>`));
    assert.ok(panel, `${tab['aria-controls']} がありません。`);
    const panelAttributes = attributes(panel[0]);
    assert.equal(panelAttributes.role, 'tabpanel');
    assert.equal(panelAttributes['aria-labelledby'], tab.id);
  }
});

test('区画はそれぞれのタブの中にある', () => {
  /** @type {Record<string, string[]>} */
  const expected = {
    'detail-panel-steps': ['params-section', 'steps'],
    'detail-panel-speed': ['speed-form'],
    'detail-panel-schedule': ['schedule-form'],
    'detail-panel-json': ['json', 'save'],
  };
  const panelIds = Object.keys(expected);
  for (const [index, id] of panelIds.entries()) {
    const start = options.search(new RegExp(`<div\\s+id="${id}"`));
    const end =
      index + 1 < panelIds.length
        ? options.search(new RegExp(`<div\\s+id="${panelIds[index + 1]}"`))
        : undefined;
    const panel = options.slice(start, end);
    for (const inner of expected[id]) {
      assert.match(panel, new RegExp(`id="${inner}"`), `${inner} が ${id} の中にありません。`);
    }
  }
});

test('画面の上部のタブは、フローの詳細のタブと別の並び（#main-tabs）にある', () => {
  const main = options.slice(
    options.indexOf('id="main-tabs"'),
    options.indexOf('</div>', options.indexOf('id="main-tabs"')),
  );
  assert.equal([...main.matchAll(/role="tab"/g)].length, 5);
  assert.doesNotMatch(main, /data-detail-tab/);
});
