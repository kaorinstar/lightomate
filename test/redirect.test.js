import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MISSING_REDIRECT_MS,
  isRedirectAfterLoad,
  observeRedirect,
  skippedRedirectNote,
} from '../extension/shared/redirect.js';
import { isReadOnlyRequest } from '../extension/shared/run-guard.js';

const redirect = { type: 'navigate', cause: 'page', url: 'https://www.example.com/ap/signin' };
const target = { selectors: ['#a'], tag: 'a', label: '注文履歴' };

test('直前に実行した手順も移動の場合だけ、転送が起きなかったかを判定する対象にする（#90）', () => {
  assert.equal(
    isRedirectAfterLoad(/** @type {any} */ (redirect), {
      type: 'navigate',
      cause: 'user',
      url: 'https://www.example.com/orders',
    }),
    true,
  );
  assert.equal(
    isRedirectAfterLoad(/** @type {any} */ (redirect), /** @type {any} */ (redirect)),
    true,
  );
  // クリックの後の移動は、操作が効かなかった可能性があるため対象にしません。
  assert.equal(
    isRedirectAfterLoad(/** @type {any} */ (redirect), { type: 'click', target }),
    false,
  );
  assert.equal(
    isRedirectAfterLoad(/** @type {any} */ (redirect), { type: 'wait', ms: 1000 }),
    false,
  );
  // 条件分岐や繰り返しの判定を挟んだ場合も対象にしません。
  assert.equal(isRedirectAfterLoad(/** @type {any} */ (redirect), undefined), false);
  // 利用者の操作による移動は、転送を待つ手順ではありません。
  assert.equal(
    isRedirectAfterLoad(
      { type: 'navigate', cause: 'user', url: 'https://www.example.com/' },
      /** @type {any} */ (redirect),
    ),
    false,
  );
});

test('移動が始まらない状態が 5 秒続いた場合だけ、転送が起きなかったと判定する（#90）', () => {
  const still = { documentId: 'A', status: 'complete', pendingUrl: undefined };
  assert.equal(MISSING_REDIRECT_MS, 5000);
  assert.equal(observeRedirect('A', still, 1000, 1000), 'waiting');
  assert.equal(observeRedirect('A', still, 1000, 5999), 'waiting');
  assert.equal(observeRedirect('A', still, 1000, 6000), 'missing');
  assert.equal(observeRedirect('A', { ...still, pendingUrl: '' }, 1000, 6000), 'missing');
});

test('途中で移動が始まったら、転送を待つ処理に移る（#90）', () => {
  const still = { documentId: 'A', status: 'complete', pendingUrl: undefined };
  // ページが変わった場合、読み込み中の場合、移動が始まっている場合です。
  assert.equal(observeRedirect('A', { ...still, documentId: 'B' }, 1000, 6000), 'navigating');
  assert.equal(observeRedirect('A', { ...still, documentId: undefined }, 1000, 2000), 'navigating');
  assert.equal(observeRedirect('A', { ...still, status: 'loading' }, 1000, 2000), 'navigating');
  assert.equal(
    observeRedirect('A', { ...still, pendingUrl: 'https://www.example.com/ap/signin' }, 1000, 2000),
    'navigating',
  );
});

test('失敗したときの説明に、? 以降と # 以降を除いた転送先を加える（#90）', () => {
  assert.equal(
    skippedRedirectNote('https://www.example.com/ap/signin?openid.return_to=abc#top'),
    'この実行では、記録時にあった転送（https://www.example.com/ap/signin）が起きなかったため、転送を待つ手順を飛ばしました。',
  );
});

test('調べるだけの依頼だけを、通信が途切れたときにやり直す対象にする（#90）', () => {
  for (const kind of [
    'runner/inspect',
    'runner/exists',
    'runner/read',
    'runner/count',
    'runner/authSignals',
  ]) {
    assert.equal(isReadOnlyRequest({ kind }), true, kind);
  }
  // クリック・入力・選択は、操作の途中で途切れた可能性があるため、やり直しません。
  assert.equal(isReadOnlyRequest({ kind: 'runner/step' }), false);
  assert.equal(isReadOnlyRequest({}), false);
  assert.equal(isReadOnlyRequest(null), false);
});
