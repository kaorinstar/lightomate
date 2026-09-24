// ESLint の設定です。拡張機能の各部分は動く場所が異なるため、使える機能をそれぞれ指定します。

import js from '@eslint/js';
import globals from 'globals';

/** すべてのコードで禁止します。文字列をコードとして実行すると、フローの内容を通じて任意の処理を実行されるためです（#14）。 */
const noDynamicCode = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
};

/**
 * content script で禁止する、外部へ送信する機能です（#14）。
 * content script には拡張機能の CSP が適用されないため、ここで禁止します。
 * 送信が必要な処理は Service Worker に依頼し、Service Worker は CSP で外部への通信を禁止しています。
 */
const networkGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((name) => ({
  name,
  message: 'content script から外部へ送信しません（SECURITY.md）。',
}));
const networkProperties = [
  ...['window', 'globalThis', 'self'].flatMap((object) =>
    ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].map((property) => ({
      object,
      property,
    })),
  ),
  { object: 'navigator', property: 'sendBeacon' },
].map((entry) => ({ ...entry, message: 'content script から外部へ送信しません（SECURITY.md）。' }));

export default [
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  {
    rules: noDynamicCode,
  },
  {
    // サイドパネルと設定・編集画面
    files: ['extension/sidepanel/**/*.js', 'extension/options/**/*.js'],
    languageOptions: { globals: { ...globals.browser, chrome: 'readonly' } },
  },
  {
    // Service Worker には画面（document、window）がありません。
    files: ['extension/background/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker, chrome: 'readonly' } },
  },
  {
    // 共通モジュールは、Service Worker、拡張機能の画面、Node.js のテストから読み込みます。
    // どこでも使える機能だけを使い、chrome.* も使いません。
    files: ['extension/shared/**/*.js'],
    languageOptions: { globals: globals['shared-node-browser'] },
  },
  {
    // content script は ES モジュールとして読み込めないため、通常のスクリプトとして扱います。
    files: ['extension/content/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, chrome: 'readonly' },
    },
    rules: {
      'no-restricted-globals': ['error', ...networkGlobals],
      'no-restricted-properties': ['error', ...networkProperties],
    },
  },
  {
    // テスト、開発用のスクリプト、設定ファイルは Node.js で動きます。
    files: ['test/**/*.js', 'scripts/**/*.js', '*.js'],
    languageOptions: { globals: globals.node },
  },
];
