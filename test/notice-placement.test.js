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
    notices: ['import-confirm'],
  },
  {
    page: '管理画面',
    html: options,
    button: 'stop-delete',
    notices: ['stop-confirm', 'stop-notice'],
  },
  {
    page: '管理画面',
    html: options,
    button: 'history-clear',
    notices: ['history-confirm', 'history-notice'],
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

/**
 * 入力欄と、その直後に置く誤りの表示欄（invalid-feedback）の組み合わせです。
 * 特定の入力欄に対する誤りは、その欄の直下に赤字で出す規則です。
 * 一覧の行の中と、実行する値の入力の欄は、画面の処理で作るため、ここでは確かめません。
 * feedback を省略した場合、表示欄の id は「入力欄の id-feedback」です。
 * @type {Array<{ page: string, html: string, control: string, feedback?: string }>}
 */
const fields = [
  { page: 'サイドパネル', html: sidepanel, control: 'flow-name' },
  { page: '管理画面', html: options, control: 'rename-input', feedback: 'rename-feedback' },
  { page: '管理画面', html: options, control: 'json' },
  { page: '管理画面', html: options, control: 'import-json' },
  { page: '管理画面', html: options, control: 'stop-origin' },
  { page: '管理画面', html: options, control: 'stop-selectors' },
  { page: '管理画面', html: options, control: 'stop-paths' },
];

for (const { page, html, control, feedback = `${control}-feedback` } of fields) {
  test(`${page}：#${control} の誤りは、入力欄の直後の #${feedback} に出す`, () => {
    const at = html.indexOf(`id="${control}"`);
    assert.notEqual(at, -1, `#${control} がありません`);
    const end = /<textarea\b[^>]*$/.test(html.slice(html.lastIndexOf('<', at), at))
      ? html.indexOf('</textarea>', at) + '</textarea>'.length
      : html.indexOf('>', at) + 1;
    const next = html.slice(end).trimStart();
    assert.ok(
      next.startsWith(`<div class="invalid-feedback" id="${feedback}">`),
      `#${control} の直後に #${feedback} がありません`,
    );
  });
}

test('実行する値の入力では、Chrome 標準の吹き出しを使わない', () => {
  assert.match(sidepanel, /<form id="run-form"[^>]* novalidate[ >]/);
  assert.match(options, /<form id="run-form"[^>]* novalidate[ >]/);
});
