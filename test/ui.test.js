// 画面の共通部品（extension/shared/ui.js）のテストです。
// Node.js には DOM がないため、使う属性とメソッドだけを持つ要素の代わりを使います。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  followColorScheme,
  noticeStyle,
  showFieldError,
  showNotice,
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
