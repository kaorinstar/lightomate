// Shadow DOM の中の要素の指定（#20）を、記録（extension/content/selector.js）と実行（extension/content/finder.js）の
// 両方で確かめます。ページで動くスクリプトは通常のスクリプトのため、jsdom のページの中で読み込んで呼び出します。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const sources = ['selector.js', 'element-text.js', 'finder.js'].map((name) =>
  readFileSync(new URL(`../extension/content/${name}`, import.meta.url), 'utf8'),
);

/**
 * 外側の部品 x-card（開いた Shadow DOM）の中に、部品 x-pay（閉じた Shadow DOM）を置いたページを作ります。
 * 閉じた Shadow DOM は、ページのスクリプトからは見えず、拡張機能の chrome.dom.openOrClosedShadowRoot でだけ
 * 得られます。jsdom にはその関数がないため、attachShadow で作った Shadow DOM を控えて、同じ動作を補います。
 * @param {string} [body] 部品の外に置く HTML
 */
function page(body = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only',
  });
  const context = dom.getInternalVMContext();
  vm.runInContext(
    `
    window.CSS = { escape: (value) => value.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\\\" + c) };
    // jsdom は表示の大きさを計算しないため、すべての要素を表示されているものとして扱います。
    Element.prototype.getClientRects = () => [{}];
    const roots = new WeakMap();
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const root = attach.call(this, init);
      roots.set(this, root);
      return root;
    };
    window.chrome = { dom: { openOrClosedShadowRoot: (element) => roots.get(element) ?? null } };

    const card = document.createElement('x-card');
    document.body.append(card);
    const cardRoot = card.attachShadow({ mode: 'open' });
    cardRoot.innerHTML = '<input name="name"><div><span>a</span></div><div><span>b</span></div>';
    const pay = document.createElement('x-pay');
    pay.id = 'payment';
    cardRoot.append(pay);
    const payRoot = pay.attachShadow({ mode: 'closed' });
    payRoot.innerHTML = '<input name="note"><button>送信</button><button>取消</button>';
    window.cardRoot = cardRoot;
    window.payRoot = payRoot;
    `,
    context,
  );
  for (const source of sources) {
    vm.runInContext(source, context);
  }
  const window = /** @type {any} */ (dom.window);
  /** @type {ShadowRoot} */
  const cardRoot = window.cardRoot;
  /** @type {ShadowRoot} */
  const payRoot = window.payRoot;
  return { window, document: window.document, cardRoot, payRoot };
}

/**
 * ページの中で作った配列やオブジェクトを、テスト側の値に写します。
 * @param {unknown} value
 */
const plain = (value) => JSON.parse(JSON.stringify(value));

test('Shadow DOM の中の要素の指定には、外側の部品のセレクターを最も外側から順に並べる（#20）', () => {
  const { window, cardRoot, payRoot } = page();
  const name = cardRoot.querySelector('input');
  assert.deepEqual(plain(window.buildTarget(name)), {
    selectors: ['input[name="name"]', 'input'],
    tag: 'input',
    label: 'name',
    shadow: ['x-card'],
  });
  // 閉じた Shadow DOM の中の要素です。x-pay は id を持つため、タグ名より id を優先します。
  const note = payRoot.querySelector('input');
  assert.deepEqual(plain(window.buildTarget(note).shadow), ['x-card', '#payment']);
  // Shadow DOM の外の要素には、shadow を付けません。
  assert.equal(window.buildTarget(window.document.body).shadow, undefined);
});

test('同じ部品が複数ある場合は、何番目の部品かをたどるセレクターで指す（#20）', () => {
  const { window, cardRoot } = page('<x-card></x-card>');
  const name = cardRoot.querySelector('input');
  assert.deepEqual(plain(window.buildTarget(name).shadow), ['html > body > x-card:nth-of-type(2)']);
});

test('Shadow DOM の内側の何番目の要素かをたどるセレクターは、Shadow DOM の内側から始める（#20）', () => {
  const { window, cardRoot, payRoot } = page();
  const second = cardRoot.querySelectorAll('span')[1];
  const target = window.buildTarget(second);
  assert.deepEqual(plain(target.selectors), ['div:nth-of-type(2) > span']);
  assert.equal(window.findTarget(target), second);

  const cancel = payRoot.querySelectorAll('button')[1];
  const cancelTarget = window.buildTarget(cancel);
  assert.deepEqual(plain(cancelTarget.selectors), ['button:nth-of-type(2)']);
  assert.equal(window.findTarget(cancelTarget), cancel);
});

test('実行では、外側の部品をたどり、閉じた Shadow DOM の中の要素も見つける（#20）', () => {
  const { window, payRoot } = page();
  const note = payRoot.querySelector('input');
  assert.equal(window.findTarget(window.buildTarget(note)), note);
  const target = {
    selectors: ['button'],
    tag: 'button',
    label: '送信',
    shadow: ['x-card', 'x-pay'],
  };
  assert.equal(window.findTarget(target), payRoot.querySelector('button'));
  assert.equal(window.findAllTargets(target).length, 2);
  // shadow がない指定では、Shadow DOM の中は探しません。
  assert.equal(window.findTarget({ selectors: ['button'], tag: 'button', label: '送信' }), null);
});

test('部品が見つからない場合は、要素を見つけず、見つからない部品を返す（#20）', () => {
  const { window, document } = page();
  const target = {
    selectors: ['button'],
    tag: 'button',
    label: '送信',
    shadow: ['x-card', 'x-other'],
  };
  assert.equal(window.findTarget(target), null);
  assert.deepEqual(plain(window.findAllTargets(target)), []);
  assert.equal(window.missingShadowHost(target, document), 'x-other');
  // 部品はすべてあり、内側の要素がない場合と、shadow がない場合は undefined です。
  const inner = { ...target, selectors: ['textarea'], shadow: ['x-card', 'x-pay'] };
  assert.equal(window.findTarget(inner), null);
  assert.equal(window.missingShadowHost(inner, document), undefined);
  assert.equal(window.missingShadowHost({ selectors: ['a'] }, document), undefined);
});

test('止める要素の指定は、Shadow DOM の中の要素の外側の部品にも一致する（#20、#54）', () => {
  const { window, payRoot } = page();
  const button = payRoot.querySelector('button');
  assert.equal(window.matchStopSelector(button, ['#payment']), '#payment');
  assert.equal(window.matchStopSelector(button, ['x-card']), 'x-card');
  assert.equal(window.matchStopSelector(button, ['button']), 'button');
  assert.equal(window.matchStopSelector(button, ['#other']), undefined);
});

test('入力欄など、ブラウザーが内部の部品を持つ要素の内側はたどらない（#20）', () => {
  const { window, document, cardRoot } = page('<input id="date" type="date">');
  assert.equal(window.shadowRootOf(document.querySelector('#date')), null);
  assert.equal(window.shadowRootOf(cardRoot.host), cardRoot);
  assert.equal(window.shadowRootOf(document.body), null);
});
