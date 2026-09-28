// ボタンの並びが、規則（docs/design-guidelines.md の「ボタンの並び」、#112）に従っていることを確かめます。
// 対象は HTML に書いたボタンの並び（lm-buttons）です。画面の処理で作る並び（一覧の行など）は、Chrome 上で確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = {
  サイドパネル: readFileSync(
    new URL('../extension/sidepanel/sidepanel.html', import.meta.url),
    'utf8',
  ),
  管理画面: readFileSync(new URL('../extension/options/options.html', import.meta.url), 'utf8'),
};

/**
 * ボタンの役割の順位です。並びの中では、この順位が左から右へ下がらないようにします。
 * 主な操作 → そのほかの操作 → 元に戻せない操作 → キャンセル・閉じる
 * @param {string} className
 * @param {string} label
 * @returns {number}
 */
function rank(className, label) {
  if (label === 'キャンセル' || label === '閉じる') {
    return 3;
  }
  if (/\bbtn-(ghost-)?danger\b/.test(className)) {
    return 2;
  }
  return /\bbtn-primary\b/.test(className) ? 0 : 1;
}

/**
 * HTML の中のボタンの並び（lm-buttons）と、その中のボタンの class と文言を取り出します。
 * @param {string} html
 * @returns {{ id: string, buttons: { className: string, label: string }[] }[]}
 */
function buttonGroups(html) {
  const groups = [];
  const opening = /<div class="lm-buttons[^"]*"(?: id="([^"]+)")?>/g;
  for (const match of html.matchAll(opening)) {
    const start = (match.index ?? 0) + match[0].length;
    const body = html.slice(start, html.indexOf('</div>', start));
    const buttons = [
      ...body.matchAll(/<button\b[^>]*class="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g),
    ].map(([, className, inner]) => ({
      className,
      label: inner.replace(/<[^>]+>/g, '').trim(),
    }));
    groups.push({ id: match[1] ?? buttons.map(({ label }) => label).join('・'), buttons });
  }
  return groups;
}

for (const [page, html] of Object.entries(pages)) {
  const groups = buttonGroups(html);

  test(`${page}：ボタンの並びを取り出せる`, () => {
    assert.ok(groups.length > 0);
  });

  for (const { id, buttons } of groups) {
    test(`${page}：［${id}］の並びは、主な操作・そのほか・元に戻せない操作・キャンセルの順`, () => {
      const ranks = buttons.map(({ className, label }) => rank(className, label));
      assert.deepEqual(
        ranks,
        [...ranks].sort((a, b) => a - b),
        `並び：${buttons.map(({ label }) => label).join('、')}`,
      );
      // 主な操作（btn-primary）は 1 つまでです。
      assert.ok(ranks.filter((value) => value === 0).length <= 1);
    });
  }
}
