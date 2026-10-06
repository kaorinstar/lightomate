import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRANSLATED_MIN_SCHEMA_VERSION,
  dependsOnTranslation,
  recordedTranslation,
  translationHint,
  translationNote,
} from '../extension/shared/translation.js';

const target = { selectors: ['#buy'], tag: 'button', label: '購入' };

test('版 8 以降のフローでは、手順の translated から記録時の翻訳の有無を返す（#99）', () => {
  assert.equal(TRANSLATED_MIN_SCHEMA_VERSION, 8);
  const flow = { schemaVersion: 8 };
  assert.equal(recordedTranslation(flow, { type: 'click', target, translated: true }), true);
  assert.equal(recordedTranslation(flow, { type: 'click', target }), false);
});

test('版 7 以前のフローでは、記録時の翻訳の有無を不明（undefined）とする（#99）', () => {
  for (const schemaVersion of [1, 6, 7]) {
    assert.equal(recordedTranslation({ schemaVersion }, { type: 'click', target }), undefined);
  }
});

test('記録時と実行時で翻訳の有無が同じ場合は、説明を加えない（#99）', () => {
  assert.equal(translationNote(false, false), undefined);
  assert.equal(translationNote(true, true), undefined);
});

test('記録時に翻訳せず、実行時に翻訳している場合は、異なる旨と原文に戻す案内を返す（#99）', () => {
  const note = translationNote(false, true);
  assert.match(note ?? '', /記録時と実行時で、ページの翻訳の有無が異なります。/);
  assert.match(note ?? '', /記録時は翻訳していませんでした/);
  assert.match(note ?? '', /原文の表示に戻して/);
});

test('記録時に翻訳し、実行時に翻訳していない場合は、異なる旨と翻訳する案内を返す（#99）', () => {
  const note = translationNote(true, false);
  assert.match(note ?? '', /記録時と実行時で、ページの翻訳の有無が異なります。/);
  assert.match(note ?? '', /実行時は翻訳していません/);
  assert.match(note ?? '', /ページを翻訳してから/);
});

test('記録時の翻訳の有無が不明な場合は、実行時に翻訳しているときだけ、原因の可能性を返す（#99）', () => {
  const note = translationNote(undefined, true);
  assert.match(note ?? '', /翻訳が原因で見つからない場合があります/);
  // 記録時も翻訳していた可能性があるため、異なるとは断定しません。
  assert.doesNotMatch(note ?? '', /異なります/);
  assert.equal(translationNote(undefined, false), undefined);
});

test('実行時の翻訳の有無がページから届かない場合は、説明を加えない（#99）', () => {
  for (const current of [undefined, null, 'true', 1]) {
    assert.equal(translationNote(false, current), undefined);
    assert.equal(translationNote(true, current), undefined);
    assert.equal(translationNote(undefined, current), undefined);
  }
});

test('id だけで指定した要素は、翻訳で見つかり方が変わらないため、翻訳の説明を加えない（#206）', () => {
  const step = /** @type {import('../extension/shared/flow.js').Step} */ ({
    type: 'click',
    target: { selectors: ['#lightomate-missing'], tag: 'button', label: '存在しないボタン' },
  });
  assert.equal(dependsOnTranslation(step), false);
  const hint = translationHint({ schemaVersion: 18 }, step);
  assert.equal(hint, null);
  assert.equal(translationNote(hint, true), undefined);
  assert.equal(translationNote(hint, false), undefined);
  // 版 7 以前のフロー（記録時の翻訳の有無が不明）でも同じです。
  assert.equal(translationNote(translationHint({ schemaVersion: 7 }, step), true), undefined);
});

test('表示の文字（text）がある指定では、従来どおり翻訳の説明を加える（#206）', () => {
  const step = /** @type {import('../extension/shared/flow.js').Step} */ ({
    type: 'click',
    target: { selectors: ['#buy'], tag: 'button', label: '購入', text: '購入する' },
  });
  assert.equal(dependsOnTranslation(step), true);
  assert.match(
    translationNote(translationHint({ schemaVersion: 18 }, step), true) ?? '',
    /原文の表示に戻して/,
  );
  assert.match(
    translationNote(translationHint({ schemaVersion: 7 }, step), true) ?? '',
    /翻訳が原因で見つからない場合があります/,
  );
});

test('翻訳で変わる属性を参照するセレクターでは、従来どおり翻訳の説明を加える（#206）', () => {
  for (const selector of [
    'button[aria-label="閉じる"]',
    'input[placeholder="検索"]',
    'img[alt="ロゴ"]',
    'a[title~="詳細"]',
    'input[value="送信"]',
    "[ARIA-LABEL='x']",
  ]) {
    const step = /** @type {import('../extension/shared/flow.js').Step} */ ({
      type: 'click',
      target: { selectors: ['#other', selector], tag: 'button', label: 'x' },
    });
    assert.equal(dependsOnTranslation(step), true, selector);
  }
  // 部品（Shadow DOM）の指定も含めます。
  assert.equal(
    dependsOnTranslation({
      type: 'click',
      target: { selectors: ['#b'], tag: 'button', label: 'x', shadow: ['[aria-label="カード"]'] },
    }),
    true,
  );
  // name や data-* などの属性は翻訳で変わりません。
  for (const selector of ['input[name="email"]', '[data-testid="buy"]', 'input[type="submit"]']) {
    assert.equal(
      dependsOnTranslation({
        type: 'click',
        target: { selectors: [selector], tag: 'input', label: 'x' },
      }),
      false,
      selector,
    );
  }
});

test('選択肢の選択（select）では、表示文字列でも探すため、従来どおり翻訳の説明を加える（#206）', () => {
  const step = /** @type {import('../extension/shared/flow.js').Step} */ ({
    type: 'select',
    target: { selectors: ['#plan'], tag: 'select', label: 'プラン' },
    values: ['b'],
    labels: ['B プラン'],
  });
  assert.equal(dependsOnTranslation(step), true);
  assert.equal(translationHint({ schemaVersion: 18 }, step), false);
});

test('要素の指定がない手順では、翻訳の説明を加えない（#206）', () => {
  assert.equal(dependsOnTranslation({ type: 'wait', ms: 100 }), false);
});
