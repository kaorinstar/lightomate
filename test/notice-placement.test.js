// 知らせと確認の表示欄が、対象のボタンの直後にあることを確かめます。
// 規則は docs/design-guidelines.md の「5. 知らせと誤りの表示場所」に記載しています。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sidepanel = readFileSync(
  new URL('../extension/sidepanel/sidepanel.html', import.meta.url),
  'utf8',
);
const options = readFileSync(new URL('../extension/options/options.html', import.meta.url), 'utf8');

/**
 * 対象のボタンと、その直後に置く表示欄の組み合わせです。
 * 見出しの帯にあるボタンは、帯の直下（本文の先頭）の表示欄に出します。
 * @type {Array<{ page: string, html: string, button: string, notices: string[] }>}
 */
const cases = [
  { page: 'サイドパネル', html: sidepanel, button: 'start', notices: ['flows-notice'] },
  { page: 'サイドパネル', html: sidepanel, button: 'stop', notices: ['recording-notice'] },
  {
    page: 'サイドパネル',
    html: sidepanel,
    button: 'recording-discard',
    notices: ['recording-confirm', 'recording-discard-notice'],
  },
  { page: 'サイドパネル', html: sidepanel, button: 'form-cancel', notices: ['form-notice'] },
  {
    page: 'サイドパネル',
    html: sidepanel,
    button: 'discard',
    notices: ['result-confirm', 'save-notice'],
  },
  { page: 'サイドパネル', html: sidepanel, button: 'save', notices: ['json-notice'] },
  {
    page: '管理画面',
    html: options,
    button: 'delete',
    notices: ['editor-confirm', 'editor-notice'],
  },
  { page: '管理画面', html: options, button: 'save', notices: ['json-notice'] },
  {
    page: '管理画面',
    html: options,
    button: 'import',
    notices: ['import-confirm', 'import-notice'],
  },
  {
    page: '管理画面',
    html: options,
    button: 'stop-delete',
    notices: ['stop-confirm', 'stop-notice'],
  },
];

/** ボタンと表示欄の間にあってはならない、内容を持つ要素です。 */
const content = /<(button|textarea|input|select|ol|ul|dl|details|section|h[1-6]|label)\b/;

for (const { page, html, button, notices } of cases) {
  test(`${page}：#${button} の知らせと確認は、ボタンの直後に置く`, () => {
    const buttonAt = html.indexOf(`id="${button}"`);
    assert.notEqual(buttonAt, -1, `#${button} がありません`);
    const buttonEnd = html.indexOf('</button>', buttonAt);
    let from = buttonEnd + '</button>'.length;
    for (const notice of notices) {
      const noticeAt = html.indexOf(`id="${notice}"`);
      assert.notEqual(noticeAt, -1, `#${notice} がありません`);
      assert.ok(noticeAt > from, `#${notice} が #${button} より前にあります`);
      const between = html.slice(from, html.lastIndexOf('<', noticeAt));
      assert.doesNotMatch(between, content, `#${button} と #${notice} の間にほかの内容があります`);
      from = html.indexOf('>', noticeAt);
    }
  });
}

test('両画面に、トーストの表示欄を role="status" で置く', () => {
  for (const html of [sidepanel, options]) {
    assert.match(html, /<div id="toast" class="lm-toast-region" role="status" aria-live="polite">/);
  }
});
