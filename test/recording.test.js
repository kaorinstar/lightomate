import { test } from 'node:test';
import assert from 'node:assert/strict';

import { navigationCause } from '../extension/background/recording.js';

test('リンクとフォームの送信による移動は、ページの操作による移動とする', () => {
  assert.equal(navigationCause({ transitionType: 'link', transitionQualifiers: [] }), 'page');
  assert.equal(
    navigationCause({ transitionType: 'form_submit', transitionQualifiers: [] }),
    'page',
  );
});

test('転送（リダイレクト）は、元の移動の種類にかかわらずページの操作による移動とする', () => {
  assert.equal(
    navigationCause({ transitionType: 'typed', transitionQualifiers: ['server_redirect'] }),
    'page',
  );
  assert.equal(
    navigationCause({ transitionType: 'link', transitionQualifiers: ['client_redirect'] }),
    'page',
  );
});

test('URL の入力、再読み込み、戻る・進むは、利用者の操作による移動とする', () => {
  assert.equal(navigationCause({ transitionType: 'typed', transitionQualifiers: [] }), 'user');
  assert.equal(navigationCause({ transitionType: 'reload', transitionQualifiers: [] }), 'user');
  assert.equal(
    navigationCause({ transitionType: 'link', transitionQualifiers: ['forward_back'] }),
    'user',
  );
  assert.equal(
    navigationCause({ transitionType: 'generated', transitionQualifiers: ['from_address_bar'] }),
    'user',
  );
});
