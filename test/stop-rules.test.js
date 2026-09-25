import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_STOP_ENTRIES,
  MAX_STOP_ENTRY_LENGTH,
  applyStopRuleToRecordedStep,
  findStopPath,
  matchesPath,
  parseLines,
  ruleForOrigin,
  validateStopRule,
} from '../extension/shared/stop-rules.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */

const shop = 'https://www.example.com';

test('パスは * を任意の文字列として比べ、それ以外は完全に一致させる', () => {
  assert.ok(matchesPath('/checkout/*', `${shop}/checkout/p/123/spc`));
  assert.ok(matchesPath('/checkout/*', `${shop}/checkout/`));
  assert.ok(matchesPath('/gp/buy/*/handlers', `${shop}/gp/buy/spc/handlers`));
  assert.ok(matchesPath('/cart', `${shop}/cart`));
  assert.ok(!matchesPath('/cart', `${shop}/cart/view`));
  assert.ok(!matchesPath('/checkout/*', `${shop}/checkout`));
  assert.ok(!matchesPath('/checkout/*', `${shop}/my/checkout/1`));
});

test('パスの比較では、クエリ文字列とページ内の位置を比べない', () => {
  assert.ok(matchesPath('/checkout/spc', `${shop}/checkout/spc?ref=1&x=2#top`));
});

test('パスの指定の中の正規表現の記号は、文字として比べる', () => {
  assert.ok(matchesPath('/a.b(1)/*', `${shop}/a.b(1)/c`));
  assert.ok(!matchesPath('/a.b/*', `${shop}/axb/c`));
});

test('URL として読めない値は、一致しないものとして扱う', () => {
  assert.ok(!matchesPath('/*', 'not a url'));
});

test('止める画面の指定のうち、一致したものを返す', () => {
  const rule = { selectors: [], paths: ['/cart', '/checkout/*'] };
  assert.equal(findStopPath(rule, `${shop}/checkout/p/1`), '/checkout/*');
  assert.equal(findStopPath(rule, `${shop}/product/1`), undefined);
});

test('1 行 1 件の入力を、空の行を除いた一覧にする', () => {
  assert.deepEqual(parseLines('  #a \r\n\n#b\n   \n'), ['#a', '#b']);
});

test('形式を満たす指定には誤りを報告しない', () => {
  assert.deepEqual(validateStopRule({ selectors: ['#placeOrder'], paths: ['/checkout/*'] }), []);
  assert.deepEqual(validateStopRule({ selectors: [], paths: [] }), []);
});

test('指定の誤りを報告する（形、空、長さ、件数、パスの先頭）', () => {
  assert.equal(validateStopRule(null).length, 1);
  assert.equal(validateStopRule({ selectors: '#a', paths: [] }).length, 1);
  assert.equal(validateStopRule({ selectors: [' '], paths: [] }).length, 1);
  assert.equal(
    validateStopRule({ selectors: ['#'.repeat(MAX_STOP_ENTRY_LENGTH + 1)], paths: [] }).length,
    1,
  );
  assert.equal(
    validateStopRule({ selectors: Array(MAX_STOP_ENTRIES + 1).fill('#a'), paths: [] }).length,
    1,
  );
  assert.equal(validateStopRule({ selectors: [], paths: ['checkout/*'] }).length, 1);
});

test('オリジンに対応する指定を取り出し、ない場合と壊れている場合は空の指定を返す', () => {
  const rule = { selectors: ['#a'], paths: ['/b'] };
  const all = { [shop]: rule, 'https://broken.example.com': { selectors: 1 } };
  assert.deepEqual(ruleForOrigin(all, shop), rule);
  assert.deepEqual(ruleForOrigin(all, 'https://other.example.com'), { selectors: [], paths: [] });
  assert.deepEqual(ruleForOrigin(all, 'https://broken.example.com'), {
    selectors: [],
    paths: [],
  });
  assert.deepEqual(ruleForOrigin(undefined, shop), { selectors: [], paths: [] });
});

const target = { selectors: ['#go'], tag: 'button', label: '次へ' };
/** @type {Step} */
const click = { type: 'click', target };
const rule = { selectors: ['#placeOrder'], paths: ['/checkout/*'] };

test('記録時、止める要素に一致したクリックを一時停止に置き換える', () => {
  const result = applyStopRuleToRecordedStep(click, undefined, rule, `${shop}/cart`, '#placeOrder');
  assert.equal(result.step?.type, 'pause');
  assert.match(result.note ?? '', /止める要素：#placeOrder/);
});

test('記録時、止める画面でのクリックを一時停止に置き換える', () => {
  const result = applyStopRuleToRecordedStep(
    click,
    undefined,
    rule,
    `${shop}/checkout/p/1`,
    undefined,
  );
  assert.equal(result.step?.type, 'pause');
  assert.match(result.note ?? '', /止める画面：\/checkout\/\*/);
});

test('記録時、直前が一時停止の場合は、一時停止を重ねて記録しない', () => {
  /** @type {Step} */
  const pause = { type: 'pause', note: '前の一時停止' };
  const result = applyStopRuleToRecordedStep(click, pause, rule, `${shop}/checkout/p/1`, undefined);
  assert.equal(result.step, null);
  assert.ok(result.note);
});

test('記録時、指定に一致しないクリックと、クリック以外の手順は変えない', () => {
  assert.deepEqual(applyStopRuleToRecordedStep(click, undefined, rule, `${shop}/cart`, undefined), {
    step: click,
  });
  /** @type {Step} */
  const input = { type: 'input', target: { ...target, tag: 'input' }, value: 'a' };
  assert.deepEqual(
    applyStopRuleToRecordedStep(input, undefined, rule, `${shop}/checkout/1`, undefined),
    {
      step: input,
    },
  );
});

test('記録時、ページから届いた指定が一覧にない場合は、一致として扱わない', () => {
  const result = applyStopRuleToRecordedStep(click, undefined, rule, `${shop}/cart`, '#other');
  assert.deepEqual(result, { step: click });
});
