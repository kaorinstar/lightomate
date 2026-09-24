// manifest.json の内容が、SECURITY.md と CLAUDE.md に記載した方針から外れていないかを確認します。
// 権限や CSP を変更する場合は、このテストと SECURITY.md の「拡張機能が行うこと」を同時に変更します。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const extensionDir = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', extensionDir), 'utf8'));

test('Manifest V3 である', () => {
  assert.equal(manifest.manifest_version, 3);
});

test('version が MAJOR.MINOR.PATCH の形式で、先頭にゼロを付けていない', () => {
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
});

test('拡張機能の ID が固定されている（#17）', () => {
  // ID は key（公開鍵）の SHA-256 の先頭 32 桁を、0〜f から a〜p に置き換えたものです。
  // key を変えると ID が変わり、保存済みのフローが見えなくなります。
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex');
  const id = [...digest.slice(0, 32)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join('');
  assert.equal(id, 'jlpfeijpfkllnmcfcfoepaokkeejbgil');
});

test('操作できるサイトは、初めから許可されていない（サイトごとに許可を求める）', () => {
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test('ページや他の拡張機能からの接続を受け付けず、ページから拡張機能を検出されない', () => {
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});

test('要求する権限は、SECURITY.md に記載したものだけである', () => {
  assert.deepEqual(manifest.permissions, ['sidePanel', 'storage', 'scripting', 'webNavigation']);
  assert.equal(manifest.optional_permissions, undefined);
});

test('拡張機能の画面は、外部への通信と外部のコードの読み込みができない', () => {
  const directives = new Map(
    manifest.content_security_policy.extension_pages
      .split(';')
      .map((/** @type {string} */ d) => d.trim().split(/\s+/))
      .filter((/** @type {string[]} */ parts) => parts[0])
      .map((/** @type {string[]} */ parts) => [parts[0], parts.slice(1)]),
  );
  assert.deepEqual(directives.get('default-src'), ["'self'"]);
  assert.deepEqual(directives.get('script-src'), ["'self'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  // default-src より緩い指定を個別に加えていないことを確認します。
  for (const name of ['connect-src', 'img-src', 'font-src', 'style-src', 'frame-src']) {
    assert.equal(directives.get(name), undefined, name);
  }
});

test('manifest.json が参照するファイルが存在する', () => {
  const paths = [
    manifest.background.service_worker,
    manifest.side_panel.default_path,
    manifest.options_ui.page,
  ];
  paths.push(...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon));
  // content script は manifest.json ではなく、Service Worker が読み込みます
  // （background/recording.js と background/runner.js）。
  paths.push(
    'content/selector.js',
    'content/overlay.js',
    'content/recorder.js',
    'content/finder.js',
    'content/runner.js',
  );
  for (const path of paths) {
    assert.ok(existsSync(new URL(path, extensionDir)), path);
  }
});

test('アイコンが 16・32・48・128px の PNG で指定されている（#26）', () => {
  // Chrome に読み込むのは extension/ だけのため、アイコンもその中に置きます。
  const expected = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  };
  assert.deepEqual(manifest.icons, expected);
  assert.deepEqual(manifest.action.default_icon, expected);
});
