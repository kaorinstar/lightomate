// 画面の共通部品（extension/shared/ui.js）のテストです。
// Node.js には DOM がないため、使う属性とメソッドだけを持つ要素の代わりを使います。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  followColorScheme,
  noticeStyle,
  showFieldError,
  showNotice,
  showToast,
  TOAST_DURATION,
} from '../extension/shared/ui.js';

/** 要素の代わりです。 */
function fakeElement(id = '') {
  /** @type {Map<string, string>} */
  const attributes = new Map();
  /** @type {Set<string>} */
  const classes = new Set();
  return {
    id,
    hidden: false,
    className: '',
    textContent: '',
    attributes,
    classList: {
      /** @param {string} name @param {boolean} force */
      toggle(name, force) {
        if (force) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
      },
      /** @param {string} name */
      contains: (name) => classes.has(name),
    },
    /** @param {string} name @param {string} value */
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    /** @param {string} name */
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
}

test('エラーは割り込んで読み上げる alert、成功と案内は status にする', () => {
  assert.equal(noticeStyle('error').role, 'alert');
  assert.match(noticeStyle('error').className, /alert-danger/);
  assert.equal(noticeStyle('success').role, 'status');
  assert.match(noticeStyle('success').className, /alert-success/);
  assert.equal(noticeStyle('info').role, 'status');
});

test('知らせを表示し、空の文字列で隠す', () => {
  const element = fakeElement();
  showNotice(/** @type {any} */ (element), '保存できませんでした。', 'error');
  assert.equal(element.hidden, false);
  assert.equal(element.textContent, '保存できませんでした。');
  assert.equal(element.attributes.get('role'), 'alert');
  assert.match(element.className, /alert-danger/);

  showNotice(/** @type {any} */ (element), '保存しました。', 'success');
  assert.equal(element.attributes.get('role'), 'status');
  assert.match(element.className, /alert-success/);

  showNotice(/** @type {any} */ (element), '');
  assert.equal(element.hidden, true);
});

test('入力欄の誤りを入力欄に結び付け、空の文字列で解除する', () => {
  const control = fakeElement();
  const feedback = fakeElement('name-feedback');
  showFieldError(
    /** @type {any} */ (control),
    /** @type {any} */ (feedback),
    'フロー名を入力してください。',
  );
  assert.equal(control.classList.contains('is-invalid'), true);
  assert.equal(control.attributes.get('aria-invalid'), 'true');
  assert.equal(control.attributes.get('aria-describedby'), 'name-feedback');
  assert.equal(feedback.textContent, 'フロー名を入力してください。');

  showFieldError(/** @type {any} */ (control), /** @type {any} */ (feedback), '');
  assert.equal(control.classList.contains('is-invalid'), false);
  assert.equal(control.attributes.has('aria-invalid'), false);
  assert.equal(control.attributes.has('aria-describedby'), false);
  assert.equal(feedback.textContent, '');
});

test('OS の設定に合わせて data-bs-theme を切り替える', () => {
  const root = fakeElement();
  /** @type {() => void} */
  let onChange = () => {};
  const query = {
    matches: false,
    /** @param {string} _type @param {() => void} listener */
    addEventListener(_type, listener) {
      onChange = listener;
    },
  };
  followColorScheme(/** @type {any} */ (root), /** @type {any} */ (query));
  assert.equal(root.attributes.get('data-bs-theme'), 'light');
  query.matches = true;
  onChange();
  assert.equal(root.attributes.get('data-bs-theme'), 'dark');
});

/**
 * トーストのテストに使う、子要素とイベントを持つ要素の代わりです。
 * @param {string} tagName
 */
function fakeNode(tagName) {
  /** @type {Map<string, Array<() => void>>} */
  const listeners = new Map();
  /** @type {Map<string, string>} */
  const attributes = new Map();
  const node = {
    tagName,
    type: '',
    className: '',
    textContent: '',
    hidden: false,
    /** @type {any} */
    parent: null,
    /** @type {any[]} */
    children: [],
    attributes,
    ownerDocument: {
      /** @param {string} name */
      createElement: (name) => fakeNode(name),
    },
    /** @param {string} name @param {string} value */
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    /** @param {string} type @param {() => void} listener */
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    /** @param {string} type */
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
    /** @param {...any} nodes */
    append(...nodes) {
      for (const child of nodes) {
        child.parent = node;
        node.children.push(child);
      }
    },
    /** @param {...any} nodes */
    replaceChildren(...nodes) {
      node.children = [];
      node.append(...nodes);
    },
    remove() {
      if (node.parent) {
        node.parent.children = node.parent.children.filter((/** @type {any} */ c) => c !== node);
        node.parent = null;
      }
    },
  };
  return node;
}

/** 時間の処理の代わりです。tick で時間を進めます。 */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  /** @type {Map<number, { at: number, callback: () => void }>} */
  const pending = new Map();
  return {
    pending,
    /** @param {() => void} callback @param {number} ms */
    setTimeout(callback, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, callback });
      return id;
    },
    /** @param {number} id */
    clearTimeout(id) {
      pending.delete(id);
    },
    /** @param {number} ms */
    tick(ms) {
      now += ms;
      for (const [id, entry] of [...pending]) {
        if (entry.at <= now) {
          pending.delete(id);
          entry.callback();
        }
      }
    },
  };
}

/** @param {ReturnType<typeof fakeNode>} region */
function toastIn(region) {
  return region.children[0];
}

test('トーストは文言と閉じるボタンを表示し、5 秒後に消える', () => {
  const region = fakeNode('div');
  const timers = fakeTimers();
  showToast(/** @type {any} */ (region), '保存しました。', { timers });
  const toast = toastIn(region);
  assert.match(toast.className, /lm-toast/);
  assert.match(toast.className, /alert-success/);
  assert.equal(toast.children[0].textContent, '保存しました。');
  assert.equal(toast.children[1].attributes.get('aria-label'), '閉じる');

  timers.tick(TOAST_DURATION - 1);
  assert.equal(region.children.length, 1);
  timers.tick(1);
  assert.equal(region.children.length, 0);
});

test('トーストの［✕］を押すと即時に消え、時間の処理も取り消す', () => {
  const region = fakeNode('div');
  const timers = fakeTimers();
  showToast(/** @type {any} */ (region), '保存しました。', { timers });
  toastIn(region).children[1].dispatch('click');
  assert.equal(region.children.length, 0);
  assert.equal(timers.pending.size, 0);
});

test('マウスを重ねている間とフォーカスがある間は消えず、離れてから 5 秒後に消える', () => {
  const region = fakeNode('div');
  const timers = fakeTimers();
  showToast(/** @type {any} */ (region), '保存しました。', { timers });
  const toast = toastIn(region);

  timers.tick(4000);
  toast.dispatch('mouseenter');
  timers.tick(TOAST_DURATION * 2);
  assert.equal(region.children.length, 1);

  toast.dispatch('focusin');
  toast.dispatch('mouseleave');
  timers.tick(TOAST_DURATION * 2);
  assert.equal(region.children.length, 1, 'フォーカスが残っている間は消えない');

  toast.dispatch('focusout');
  timers.tick(TOAST_DURATION - 1);
  assert.equal(region.children.length, 1);
  timers.tick(1);
  assert.equal(region.children.length, 0);
});

test('続けて表示すると前のトーストを置き換え、前の時間の処理を取り消す', () => {
  const region = fakeNode('div');
  const timers = fakeTimers();
  showToast(/** @type {any} */ (region), '1 件目', { timers });
  timers.tick(4000);
  showToast(/** @type {any} */ (region), '2 件目', { kind: 'info', timers });
  assert.equal(region.children.length, 1);
  assert.equal(toastIn(region).children[0].textContent, '2 件目');
  assert.match(toastIn(region).className, /alert-info/);
  assert.equal(timers.pending.size, 1);

  timers.tick(TOAST_DURATION - 1);
  assert.equal(region.children.length, 1, '1 件目の時間で 2 件目が消えない');
  timers.tick(1);
  assert.equal(region.children.length, 0);
});
