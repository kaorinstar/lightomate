// 要素が見つからずに止まったときのページの構造（#203）を確かめます。ページで集める処理
// （extension/content/diagnose.js）は jsdom のページの中で読み込んで呼び出し、伏せる処理とコピーの表示
// （extension/shared/history-report.js）はそのまま呼び出します。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

import { REDACTED } from '../extension/shared/history.js';
import {
  STRUCTURE_MAX_CLASSES,
  STRUCTURE_MAX_ELEMENTS,
  STRUCTURE_MAX_FRAMES,
  STRUCTURE_MAX_LENGTH,
  historyReportText,
  redactPageStructure,
  structureLines,
} from '../extension/shared/history-report.js';

const source = readFileSync(new URL('../extension/content/diagnose.js', import.meta.url), 'utf8');

/**
 * diagnose.js を読み込んだページを作り、式を評価した結果を返します。
 * @param {string} body
 * @param {string} expression
 * @returns {any}
 */
function evaluate(body, expression) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: 'https://shop.example.com/orders/',
    runScripts: 'outside-only',
  });
  const context = dom.getInternalVMContext();
  // jsdom は表示の大きさを計算しないため、hidden の class を持つ要素だけを非表示として扱います。
  vm.runInContext(
    `Element.prototype.getClientRects = function () { return this.classList.contains('hidden') ? [] : [{}]; };`,
    context,
  );
  vm.runInContext(source, context);
  return JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
}

const USER = 'tanaka@example.com';

test('セレクターごとの要素の数と、同じタグの要素の骨組みを集め、表示の文字は集めない（#203）', () => {
  const structure = evaluate(
    `
    <button id="submit-button" class="btn primary" type="submit" aria-label="送信する">送信</button>
    <button name="cancel" class="btn hidden" value="やめる">取り消す</button>
    <a href="/orders/1?session=abc#top">注文</a>
    `,
    `pageStructure({ selectors: ['#submit-btn', 'button.btn', 'a[', 'button'], tag: 'button' }, document)`,
  );
  assert.deepEqual(structure.counts, [
    { selector: '#submit-btn', count: 0 },
    { selector: 'button.btn', count: 2 },
    { selector: 'a[', count: -1 },
    { selector: 'button', count: 2 },
  ]);
  assert.equal(structure.tag, 'button');
  assert.equal(structure.total, 2);
  assert.deepEqual(structure.elements, [
    { tag: 'button', id: 'submit-button', type: 'submit', class: 'btn primary' },
    { tag: 'button', name: 'cancel', class: 'btn hidden', hidden: true },
  ]);
  const text = JSON.stringify(structure);
  for (const word of ['送信', '取り消す', 'やめる']) {
    assert.ok(!text.includes(word), word);
  }
});

test('href と src は、クエリとフラグメントを除いた絶対 URL にする（#203）', () => {
  const structure = evaluate(
    `<a id="a" href="/orders/1?session=abc#top">1</a><a id="b" href="javascript:void(0)">2</a>`,
    `pageStructure({ selectors: ['a'], tag: 'a' }, document)`,
  );
  assert.equal(structure.elements[0].href, 'https://shop.example.com/orders/1');
  assert.equal(structure.elements[1].href, 'javascript:');
});

test(`骨組みは先頭の ${STRUCTURE_MAX_ELEMENTS} 件までにし、全体の数を残す（#203）`, () => {
  const structure = evaluate(
    '<li></li>'.repeat(STRUCTURE_MAX_ELEMENTS + 5),
    `pageStructure({ selectors: ['li.x'], tag: 'li' }, document)`,
  );
  assert.equal(structure.total, STRUCTURE_MAX_ELEMENTS + 5);
  assert.equal(structure.elements.length, STRUCTURE_MAX_ELEMENTS);
});

test('タグの名前として正しくない tag では、骨組みを集めない（#203）', () => {
  const structure = evaluate(
    '<div></div>',
    `pageStructure({ selectors: ['div'], tag: 'div, p' }, document)`,
  );
  assert.equal(structure.tag, '');
  assert.deepEqual(structure.elements, []);
});

test('iframe の一覧に、src（クエリを除く）、name、id、title と、表示されているかを集める（#203）', () => {
  const frames = evaluate(
    `
    <iframe src="https://js.stripe.com/v3/inner.html?key=pk_test#x" name="__frame1" title="カード番号"></iframe>
    <iframe class="hidden" src="https://js.stripe.com/v3/inner.html" id="f2"></iframe>
    `,
    'frameList()',
  );
  assert.deepEqual(frames, {
    total: 2,
    frames: [
      { src: 'https://js.stripe.com/v3/inner.html', name: '__frame1', title: 'カード番号' },
      { src: 'https://js.stripe.com/v3/inner.html', id: 'f2', hidden: true },
    ],
  });
});

test('記録する前に、入力欄に入れた値を伏せ、決まった属性だけを残す（#203）', () => {
  const structure = redactPageStructure(
    {
      counts: [{ selector: `#user-${USER}`, count: 0 }],
      tag: 'a',
      total: 1,
      elements: [
        {
          tag: 'a',
          id: `account-${USER}`,
          href: `https://shop.example.com/users/${encodeURIComponent(USER)}`,
          value: USER,
          'aria-label': '秘密',
          onclick: 'x()',
        },
      ],
    },
    { total: 1, frames: [{ src: 'https://pay.example.com/', title: `${USER} の支払い` }] },
    [USER],
  );
  assert.deepEqual(structure, {
    counts: [{ selector: `#user-${REDACTED}`, count: 0 }],
    tag: 'a',
    total: 1,
    elements: [
      { tag: 'a', id: `account-${REDACTED}`, href: `https://shop.example.com/users/${REDACTED}` },
    ],
    frameTotal: 1,
    frames: [{ src: 'https://pay.example.com/', title: `${REDACTED} の支払い` }],
  });
  assert.ok(!JSON.stringify(structure).includes(USER));
});

test('記録する前に、件数・値の長さ・class の数・iframe の件数を上限で切る（#203）', () => {
  const structure = redactPageStructure(
    {
      counts: [],
      tag: 'div',
      total: 100,
      elements: Array.from({ length: 100 }, () => ({
        tag: 'div',
        id: 'x'.repeat(STRUCTURE_MAX_LENGTH + 10),
        class: Array.from({ length: 20 }, (_, index) => `c${index}`).join(' '),
      })),
    },
    { total: 50, frames: Array.from({ length: 50 }, () => ({ name: 'f' })) },
    [],
  );
  assert.ok(structure);
  assert.equal(structure.elements?.length, STRUCTURE_MAX_ELEMENTS);
  assert.equal(structure.elements?.[0].id, `${'x'.repeat(STRUCTURE_MAX_LENGTH)}…`);
  assert.equal(String(structure.elements?.[0].class).split(' ').length, STRUCTURE_MAX_CLASSES);
  assert.equal(structure.frames?.length, STRUCTURE_MAX_FRAMES);
  assert.equal(structure.frameTotal, 50);
});

test('ページから届いた値の形が正しくない場合は、記録しない（#203）', () => {
  assert.equal(redactPageStructure(undefined, undefined, []), undefined);
  assert.equal(redactPageStructure('x', 1, []), undefined);
  assert.deepEqual(redactPageStructure({ counts: [{ selector: 1, count: 'a' }] }, null, []), {
    counts: [{ selector: '', count: 0 }],
  });
});

test('コピーのテキストに、要素の数、骨組み、iframe の一覧を含める（#203）', () => {
  /** @type {import('../extension/shared/history-report.js').PageStructure} */
  const structure = {
    counts: [
      { selector: '#submit-btn', count: 0 },
      { selector: 'a[', count: -1 },
    ],
    tag: 'button',
    total: 40,
    elements: [
      { tag: 'button', id: 'submit-button', class: 'btn primary', type: 'submit' },
      { tag: 'button', name: 'say "hi"', hidden: true },
    ],
    frameTotal: 2,
    frames: [
      { src: 'https://js.stripe.com/v3/inner.html', name: '__frame1' },
      { src: 'https://js.stripe.com/v3/inner.html', name: '__frame2', hidden: true },
    ],
  };
  assert.deepEqual(structureLines(structure), [
    '  セレクターごとの要素の数：',
    '    #submit-btn：0 件',
    '    a[：セレクターとして読めません',
    '  button の要素（全 40 件、先頭の 2 件を表示）：',
    '    1. <button id="submit-button" class="btn primary" type="submit">',
    '    2. <button name="say \\"hi\\"">（非表示）',
    '  ページの iframe（全 2 件）：',
    '    1. <iframe src="https://js.stripe.com/v3/inner.html" name="__frame1">',
    '    2. <iframe src="https://js.stripe.com/v3/inner.html" name="__frame2">（非表示）',
  ]);
  const text = historyReportText({ structure }, undefined, undefined);
  assert.match(
    text,
    /\nページの構造（表示の文字は含めず、入力欄に入れた値は伏せています）：\n {2}セレクターごとの要素の数：\n/,
  );
});

test('ページの構造のない履歴では、コピーのテキストに節を設けない（#203）', () => {
  assert.ok(!historyReportText({}, undefined, undefined).includes('ページの構造'));
});
