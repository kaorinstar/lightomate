import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SAVE_PATH,
  buildSavePath,
  builtinValues,
  validateSaveTemplate,
} from '../extension/shared/save-path.js';

const now = new Date(2026, 8, 5, 7, 8, 9);
const builtins = builtinValues('Amazon 領収書', 'https://www.amazon.co.jp', now);

test('組み込みの値を作る', () => {
  assert.deepEqual(builtins, {
    'flow.name': 'Amazon 領収書',
    'site.host': 'www.amazon.co.jp',
    'run.yyyy': '2026',
    'run.mm': '09',
    'run.dd': '05',
    'run.hhmmss': '070809',
  });
});

test('既定の保存先に値を埋め込む', () => {
  assert.deepEqual(buildSavePath(DEFAULT_SAVE_PATH, builtins), {
    ok: true,
    path: 'Lightomate/Amazon 領収書/20260905_070809.pdf',
  });
});

test('組み込みの値、パラメータ、読み取った値を埋め込む', () => {
  const values = { ...builtins, month: '2026-08', 'month.mm': '08', orderNumber: '503-1234567' };
  assert.deepEqual(
    buildSavePath('Lightomate/{{site.host}}/{{month}}/{{orderNumber}}.pdf', values),
    { ok: true, path: 'Lightomate/www.amazon.co.jp/2026-08/503-1234567.pdf' },
  );
});

test('末尾が .pdf でない場合は .pdf を付ける', () => {
  assert.deepEqual(buildSavePath('Lightomate/{{flow.name}}', builtins), {
    ok: true,
    path: 'Lightomate/Amazon 領収書.pdf',
  });
});

test('値の中の / と \\ はフォルダーの区切りにせず、使えない文字を _ に置き換える', () => {
  const values = { a: '2026/08\\01', b: 'x:*?"<>|y' };
  assert.deepEqual(buildSavePath('Lightomate/{{a}}_{{b}}.pdf', values), {
    ok: true,
    path: 'Lightomate/2026_08_01_x_______y.pdf',
  });
});

test('値が .. や空でも、ダウンロード先フォルダーの中の名前になる', () => {
  for (const value of ['..', '.', '', '   ', '../../etc']) {
    const result = buildSavePath('Lightomate/{{a}}/{{a}}.pdf', { a: value });
    assert.ok(result.ok, value);
    const segments = result.path.split('/');
    assert.equal(segments[0], 'Lightomate');
    assert.ok(
      segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
      result.path,
    );
    assert.equal(segments.length, 3, result.path);
  }
});

test('制御文字、末尾のドットと空白、Windows の予約名を安全な名前にする', () => {
  const result = buildSavePath('{{a}}/{{b}}/{{c}}.pdf', {
    a: 'x\u0000y\n',
    b: 'end. ',
    c: 'CON',
  });
  assert.ok(result.ok);
  assert.equal(result.path, 'x_y_/end/_CON.pdf');
});

test('ひな形の絶対パス、空のフォルダー名、. と .. は誤りとする', () => {
  for (const template of [
    '/etc/a.pdf',
    'C:\\\\a.pdf',
    'a//b.pdf',
    'a/',
    '../a.pdf',
    'a/./b.pdf',
    '',
  ]) {
    assert.ok(validateSaveTemplate(template).length > 0, template);
    assert.equal(buildSavePath(template, {}).ok, false, template);
  }
});

test('埋め込む値がない参照は誤りとする', () => {
  const result = buildSavePath('Lightomate/{{orderNumber}}.pdf', builtins);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /orderNumber/);
});
