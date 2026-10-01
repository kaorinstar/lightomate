// 説明文を拾い読みできる形（#150）になっていることを確かめます。
// 規則は docs/design-guidelines.md の「配置と余白」にあります。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const options = readFileSync(new URL('../extension/options/options.html', import.meta.url), 'utf8');
const sidepanel = readFileSync(
  new URL('../extension/sidepanel/sidepanel.html', import.meta.url),
  'utf8',
);

/**
 * 説明文（lm-hint、lm-panel-note、lm-disclaimer）の中の箇条書きの項目の文を、タグを除いて取り出します。
 * @param {string} html
 * @returns {{ html: string, text: string }[]}
 */
function hintItems(html) {
  const items = [];
  const opening = /<(div|ul) class="(?:lm-hint|lm-panel-note|lm-disclaimer)[^"]*"[^>]*>/g;
  for (const match of html.matchAll(opening)) {
    const start = match.index ?? 0;
    const end = html.indexOf(`</${match[1]}>`, html.indexOf('</ul>', start));
    const body = html.slice(start, end);
    for (const li of body.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const itemHtml = li[1].trim();
      items.push({ html: itemHtml, text: itemHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ') });
    }
  }
  return items;
}

/**
 * 文の数を数えます。「。」で区切ります。
 * @param {string} text
 */
function sentenceCount(text) {
  return text.split('。').filter((part) => part.trim() !== '').length;
}

for (const [name, html] of Object.entries({ 管理画面: options, サイドパネル: sidepanel })) {
  test(`${name}：説明の箇条書きの見出しの語は、太字で項目の先頭に置く`, () => {
    for (const item of hintItems(html)) {
      if (!/^[^。、]{1,20}：/.test(item.text)) {
        continue;
      }
      // Prettier は </strong> の途中で改行するため、タグの中の空白を許します。
      assert.match(item.html, /^<strong>[^<]+<\/strong\s*>：/, item.text);
    }
  });

  test(`${name}：説明の箇条書きの 1 項目は 2 文までにする`, () => {
    for (const item of hintItems(html)) {
      assert.ok(sentenceCount(item.text) <= 2, item.text);
    }
  });
}

test('管理画面：見出しの語を付けた項目がある（取り出しの確認）', () => {
  const labeled = hintItems(options).filter((item) => item.html.startsWith('<strong>'));
  assert.ok(labeled.length >= 20, `${labeled.length} 件`);
});

test('［手順］の説明：保存の注意は［手順を保存］の横に置き、キーボード操作は畳む', () => {
  const steps = options.slice(
    options.indexOf('aria-labelledby="steps-heading"'),
    options.indexOf('id="blocks-notice"'),
  );
  const hint = steps.slice(
    steps.indexOf('class="lm-hint"'),
    steps.indexOf('id="blocks-pick-notice"'),
  );
  assert.equal(hint.includes('［手順を保存］'), false);
  assert.match(hint, /<details class="lm-more">\s*<summary>キーボードで操作する<\/summary>/);
  const buttons = steps.slice(steps.indexOf('id="blocks-buttons"'));
  assert.match(buttons, /id="blocks-unsaved" hidden\s*>保存していない変更があります</);
});
