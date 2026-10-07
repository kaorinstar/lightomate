// 要素の選択モード（#139）の、一覧の行と行の内側の要素の指定（extension/content/picker-rows.js）を確かめます。
// ページで動くスクリプトは通常のスクリプトのため、jsdom のページの中で読み込んで呼び出します。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const sources = ['selector.js', 'picker-rows.js'].map((name) =>
  readFileSync(new URL(`../extension/content/${name}`, import.meta.url), 'utf8'),
);

/**
 * HTML を読み込んだページを作り、ページで動くスクリプトの関数を返します。
 * @param {string} body
 */
function page(body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only',
  });
  const context = dom.getInternalVMContext();
  // jsdom には CSS.escape がないため、テストに必要な範囲で補います。
  vm.runInContext(
    'window.CSS = { escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\\\" + c) };',
    context,
  );
  for (const source of sources) {
    vm.runInContext(source, context);
  }
  const { window } = dom;
  const document = window.document;
  /** @param {string} selector */
  const $ = (selector) => {
    const element = document.querySelector(selector);
    assert.ok(element, selector);
    return element;
  };
  return { window: /** @type {any} */ (window), document, $ };
}

/**
 * ページの中で作った配列やオブジェクトを、テスト側の値に写します。ページとテストでは Array などが別物のため、
 * そのままでは deepEqual で一致しません。
 * @param {unknown} value
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

const table = `
  <table id="orders">
    <thead><tr><th>注文日</th><th>領収書</th></tr></thead>
    <tbody>
      <tr class="order-row"><td class="date">2026/09/01</td><td><a class="receipt" href="/r/1">領収書</a></td></tr>
      <tr class="order-row"><td class="date">2026/09/02</td><td><a class="receipt" href="/r/2">領収書</a></td></tr>
      <tr class="order-row"><td class="date">2026/09/03</td><td><a class="receipt" href="/r/3">領収書</a></td></tr>
    </tbody>
  </table>
  <button id="next">次へ</button>`;

const cards = `
  <main>
    <section class="summary card">合計</section>
    <div class="list">
      <div class="card invoice"><span class="no">A-1</span><a href="/a/1">PDF</a></div>
      <div class="invoice card"><span class="no">A-2</span><a href="/a/2">PDF</a></div>
    </div>
  </main>`;

test('表の行の中を押すと、同じ形の行すべてに一致する指定を返し、見出しの行は含めない', () => {
  const { window, document, $ } = page(table);
  const result = window.buildRowsTarget($('tbody tr:nth-child(2) .date'), document);
  assert.ok(result);
  assert.deepEqual(plain(result.items.selectors), [
    'tr.order-row',
    '#orders > tbody > tr.order-row',
  ]);
  assert.equal(result.items.tag, 'tr');
  assert.equal(result.items.scope, undefined);
  assert.equal(result.rows.length, 3);
  for (const selector of result.items.selectors) {
    assert.equal(document.querySelectorAll(selector).length, 3, selector);
  }
});

test('カードの一覧では、class の順序が違っても同じ形とみなし、形の同じ別の要素は含めない', () => {
  const { window, document, $ } = page(cards);
  const result = window.buildRowsTarget($('.list .no'), document);
  assert.ok(result);
  assert.equal(result.rows.length, 2);
  // 「div.card.invoice」だけではページ全体で 2 件に一致しますが、section.summary は形が違うため含まれません。
  assert.equal(result.items.selectors[0], 'div.card.invoice');
  const matched = Array.from(document.querySelectorAll(result.items.selectors[0]));
  assert.ok(matched.length === 2 && matched.every((row, index) => row === result.rows[index]));
});

test('class のない行でも、親を一意に指すセレクターで行だけに一致させる', () => {
  const { window, document, $ } = page(`
    <ul id="menu"><li>ホーム</li></ul>
    <ul id="list"><li><a href="/1">1</a></li><li><a href="/2">2</a></li></ul>`);
  const result = window.buildRowsTarget($('#list li:nth-child(2) a'), document);
  assert.ok(result);
  assert.deepEqual(plain(result.items.selectors), ['#list > li']);
  assert.equal(result.rows.length, 2);
});

test('同じ形の兄弟がない要素だけを押した場合は、行が見つからない', () => {
  const { window, document, $ } = page('<div><p id="only">1 つだけ</p></div>');
  assert.equal(window.buildRowsTarget($('#only'), document), null);
});

test('行の内側の要素は、行を起点にした scope: item の指定になり、どの行でも同じ位置の要素を指す', () => {
  const { window, $ } = page(table);
  const row = $('tbody tr:nth-child(2)');
  const target = window.buildInnerTarget($('tbody tr:nth-child(2) a'), row);
  assert.equal(target.scope, 'item');
  assert.equal(target.tag, 'a');
  assert.deepEqual(plain(target.selectors), ['a.receipt', ':scope > td:nth-of-type(2) > a']);
  for (const other of Array.from(row.parentElement?.children ?? [])) {
    for (const selector of target.selectors) {
      const found = other.querySelector(selector);
      assert.ok(found, selector);
      assert.equal(found.getAttribute('class'), 'receipt');
    }
  }
});

test('繰り返しの行の指定から行を探し、押した要素を含む行を返す。行の外側なら null', () => {
  const { window, $ } = page(table);
  const levels = window.resolveRows([{ selectors: ['tr.order-row'] }]);
  assert.equal(levels[0].length, 3);
  assert.equal(
    window.containingRow($('tbody tr:nth-child(3) a'), levels),
    $('tbody tr:nth-child(3)'),
  );
  assert.equal(window.containingRow($('#next'), levels), null);
});

test('繰り返しの中の繰り返しでは、外側の行の内側で行を探し、scope: item を付ける', () => {
  const { window, $ } = page(`
    <div class="group"><ul><li class="line">a</li><li class="line">b</li></ul></div>
    <div class="group"><ul><li class="line">c</li><li class="line">d</li><li class="line">e</li></ul></div>`);
  const outer = $('.group:nth-child(2)');
  const result = window.buildRowsTarget($('.group:nth-child(2) .line'), outer);
  assert.ok(result);
  assert.equal(result.items.scope, 'item');
  assert.equal(result.rows.length, 3);
  const levels = window.resolveRows([{ selectors: ['div.group'] }, result.items]);
  assert.equal(levels[1].length, 5);
});

test('ページ全体を基準にした指定では、class を使う候補を、何番目かをたどる指定より前に置く（ページ送りの［次へ］）', () => {
  const { window, $ } = page(`
    <nav><ul class="pager"><li class="next"><a href="/page/2/">Next</a></li></ul></nav>`);
  const target = window.buildPageTarget($('li.next > a'));
  assert.deepEqual(plain(target.selectors), ['li.next > a', 'html > body > nav > ul > li > a']);
  // 2 ページ目では［Previous］が前に加わります。class を使う候補は、引き続き［Next］だけを指します。
  const second = page(`
    <nav><ul class="pager"><li class="previous"><a href="/page/1/">Previous</a></li><li class="next"><a href="/page/3/">Next</a></li></ul></nav>`);
  const found = second.document.querySelector(target.selectors[0]);
  assert.equal(found?.getAttribute('href'), '/page/3/');
});

test('Chrome の翻訳が差し込んだ font 要素を押した場合は、外側の本来の要素の指定にする（翻訳を無効にしても見つかる）', () => {
  // quotes.toscrape.com を日本語に翻訳した状態と同じ形です。翻訳は文字を font の入れ子で包みます。
  const translated = page(`
    <div class="quote"><span class="text">a</span><span>by <small class="author"><font style="vertical-align: inherit;"><font style="vertical-align: inherit;">アルバート・アインシュタイン</font></font></small></span></div>
    <div class="quote"><span class="text">b</span><span>by <small class="author"><font style="vertical-align: inherit;"><font style="vertical-align: inherit;">J・K・ローリング</font></font></small></span></div>`);
  const row = translated.$('.quote');
  const pressed = /** @type {Element} */ (row.querySelector('font font'));
  const target = translated.window.buildInnerTarget(
    translated.window.originalElement(pressed),
    row,
  );
  assert.equal(target.tag, 'small');
  assert.equal(target.selectors[0], 'small.author');
  assert.ok(
    plain(target.selectors).every((/** @type {string} */ selector) => !selector.includes('font')),
  );

  // 翻訳していないページでも、同じ指定で著者名を指します。
  const original = page(`
    <div class="quote"><span class="text">a</span><span>by <small class="author">Albert Einstein</small></span></div>`);
  for (const selector of target.selectors) {
    assert.equal(
      original.$('.quote').querySelector(selector)?.textContent,
      'Albert Einstein',
      selector,
    );
  }
});

// ---- 記録した手順に添える行の候補（#167） ----

test('記録した要素の行の候補を、内側から順に返し、要素そのものは候補にしない', () => {
  const { window, $ } = page(`
    <div id="orders">
      <div class="order">
        <div class="head"><span class="date">2026年9月1日</span><span class="total">100 円</span></div>
        <a class="receipt" href="/r/1">領収書</a>
      </div>
      <div class="order">
        <div class="head"><span class="date">2026年9月2日</span><span class="total">200 円</span></div>
        <a class="receipt" href="/r/2">領収書</a>
      </div>
      <div class="order">
        <div class="head"><span class="date">2026年9月3日</span><span class="total">300 円</span></div>
        <a class="receipt" href="/r/3">領収書</a>
      </div>
    </div>`);
  const candidates = plain(window.rowCandidates($('.order:nth-child(2) .receipt')));
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].items.selectors, ['div.order', '#orders > div.order']);
  assert.equal(candidates[0].count, 3);
  assert.equal(candidates[0].inner.scope, 'item');
  assert.equal(candidates[0].inner.selectors[0], 'a.receipt');
});

test('同じ形の兄弟がない要素では、行の候補は空になる', () => {
  const { window, $ } = page('<div><p><a id="only" href="/">1 つだけ</a></p></div>');
  assert.deepEqual(plain(window.rowCandidates($('#only'))), []);
});

test('行の候補は、外側の行も含めて 5 件までにする', () => {
  // 同じ形の兄弟を持つ階層を 7 段重ねます。
  let html = '<a id="target" href="/">押す</a>';
  for (let level = 0; level < 7; level += 1) {
    html = `<div class="l${level}">${html}</div><div class="l${level}"></div>`;
  }
  const { window, $ } = page(`<main>${html}</main>`);
  const candidates = plain(window.rowCandidates($('#target')));
  assert.equal(candidates.length, 5);
  assert.deepEqual(
    candidates.map((/** @type {any} */ candidate) => candidate.items.tag),
    ['div', 'div', 'div', 'div', 'div'],
  );
  assert.equal(candidates[0].items.selectors[0], 'div.l0');
});

test('記録で押した「次へ」は、ページ番号の数で位置が変わらない指定だけをページ送りに使う（#182）', () => {
  // Amazon の購入履歴と同じ形です。ページ番号の数で、「次へ」が何番目の li かが変わります。
  const first = page(`
    <div id="pager"><ul class="a-pagination"><li class="a-disabled">前へ</li><li class="a-selected"><a href="#">1</a></li><li class="a-normal"><a href="?p=2">2</a></li><li class="a-last"><a href="?p=2">次へ</a></li></ul></div>`);
  const selectors = plain(first.window.pagerSelectors(first.$('li.a-last > a')));
  assert.deepEqual(selectors, ['li.a-last > a', 'html > body > div > ul > li:last-of-type > a']);
  // 何番目の li かをたどる指定（buildTarget の最後の指定）は含めません。
  assert.ok(selectors.every((/** @type {string} */ selector) => !selector.includes('nth-of-type')));

  const second = page(`
    <div id="pager"><ul class="a-pagination"><li class="a-normal"><a href="?p=1">前へ</a></li><li class="a-normal"><a href="?p=1">1</a></li><li class="a-selected"><a href="#">2</a></li><li class="a-normal"><a href="?p=3">3</a></li><li class="a-last"><a href="?p=3">次へ</a></li></ul></div>`);
  for (const selector of selectors) {
    assert.equal(second.document.querySelector(selector)?.getAttribute('href'), '?p=3', selector);
  }
  // 最後のページでは「次へ」がリンクではなくなります。どの指定でも見つからず、最後のページと判定されます。
  const last = page(`
    <div id="pager"><ul class="a-pagination"><li class="a-normal"><a href="?p=2">前へ</a></li><li class="a-normal"><a href="?p=1">1</a></li><li class="a-normal"><a href="?p=2">2</a></li><li class="a-selected"><a href="#">3</a></li><li class="a-disabled a-last">次へ</li></ul></div>`);
  for (const selector of selectors) {
    assert.equal(last.document.querySelector(selector), null, selector);
  }
});

test('ページ送りの指定には、翻訳で変わる aria-label を使わず、リンクとボタン以外では作らない（#182）', () => {
  const { window, $ } = page(`
    <nav><a href="?p=1">1</a><a href="?p=2">2</a><a aria-label="次のページ" href="?p=2">→</a></nav><span class="text">文字</span>`);
  const selectors = plain(window.pagerSelectors($('a[aria-label]')));
  assert.deepEqual(selectors, ['html > body > nav > a:last-of-type']);
  assert.deepEqual(plain(window.pagerSelectors($('span.text'))), []);
});

test('rel="next" のリンクは、その属性の指定を先に使う（#182）', () => {
  const { window, $ } = page(`
    <div><a href="?p=1">1</a><a rel="next" href="?p=2">次へ</a><a href="?p=9">最後</a></div>`);
  assert.deepEqual(plain(window.pagerSelectors($('a[rel]'))), ['a[rel~="next"]']);
});

// 楽天市場の購入履歴と同じ形です（#236）。1 件目の注文の枠だけ、余白の class（m-none）が 2 件目以降（m-top）と異なり、
// 最後にページ送りの枠が同じ親に並びます。
const firstDiffers = `
  <div id="list">
    <div class="spacer col white m-none"><div class="head"><span class="date">2023/12/25(月)</span></div><a class="detail" href="/d/1">注文詳細</a></div>
    <div class="spacer col white m-top"><div class="head"><span class="date">2023/12/24(日)</span></div><a class="detail" href="/d/2">注文詳細</a></div>
    <div class="spacer col white m-top"><div class="head"><span class="date">2023/12/23(土)</span></div><a class="detail" href="/d/3">注文詳細</a></div>
    <div class="spacer row-center pager"><button class="nav-next">次へ</button></div>
  </div>`;

test('1 件目の行だけ class が 1 つ異なる一覧でも、共通する class で全行に一致させ、ページ送りの枠は含めない（#236）', () => {
  const { window, document, $ } = page(firstDiffers);
  const candidates = plain(window.rowCandidates($('#list > div:nth-child(1) .date')));
  const rows = candidates.find((/** @type {any} */ candidate) => candidate.count === 3);
  assert.ok(rows, JSON.stringify(candidates));
  assert.equal(rows.items.selectors[0], 'div.col.spacer.white');
  assert.equal(document.querySelectorAll(rows.items.selectors[0]).length, 3);
  assert.equal(rows.inner.scope, 'item');
  // 2 件目を押した場合も、1 件目を含めた 3 件にします。
  const fromSecond = window.buildRowsTarget($('#list > div:nth-child(2) .detail'), document);
  assert.ok(fromSecond);
  assert.equal(fromSecond.rows.length, 3);
});

test('class の違いが 3 つ以上ある兄弟と、共通する class が 1 つしかない兄弟は、同じ行とみなさない（#236）', () => {
  for (const html of [
    '<div class="x y p q"><span id="t">1</span></div><div class="x y r s"><span>2</span></div>',
    '<div class="x p"><span id="t">1</span></div><div class="x q"><span>2</span></div>',
  ]) {
    const { window, $ } = page(`<main>${html}</main>`);
    assert.deepEqual(plain(window.rowCandidates($('#t'))), [], html);
  }
});
