// 文字と日付による条件（extension/shared/condition.js、#103）のテストです。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  conditionKind,
  describeCondition,
  evaluateCondition,
  isDateValue,
  parseDate,
} from '../extension/shared/condition.js';

const target = { selectors: ['.date'], tag: 'span', label: '注文日' };

test('年・月・日の並びが一意に決まる表記の日付を読み取る（#103）', () => {
  for (const [text, date] of [
    ['注文日：2026年9月1日', '2026-09-01'],
    ['2026 年 12 月 31 日', '2026-12-31'],
    ['2026/9/1', '2026-09-01'],
    ['2026/09/01 10:05', '2026-09-01'],
    ['2026-09-01', '2026-09-01'],
    ['2026.9.1', '2026-09-01'],
    ['Order placed September 1, 2026', '2026-09-01'],
    ['Sep 1, 2026', '2026-09-01'],
    ['Sept. 1 2026', '2026-09-01'],
    ['1 September 2026', '2026-09-01'],
    ['1 Sep 2026', '2026-09-01'],
  ]) {
    assert.deepEqual(parseDate(text), { ok: true, date }, text);
  }
});

test('同じ日付が複数の表記で書かれている場合は、1 つとして扱う（#103）', () => {
  assert.deepEqual(parseDate('2026年9月1日（2026/09/01）'), { ok: true, date: '2026-09-01' });
});

test('日付がない、2 つ以上ある、存在しない、月と日の順序が決まらない場合は読み取らない（#103）', () => {
  assert.deepEqual(parseDate('注文番号 123-4567'), { ok: false, error: '日付が見つかりません。' });
  const two = parseDate('2026年9月1日〜2026年9月30日');
  assert.equal(two.ok, false);
  assert.match(two.ok ? '' : two.error, /日付が 2 つあり（2026-09-01、2026-09-30）/);
  const invalid = parseDate('2026年2月30日');
  assert.match(invalid.ok ? '' : invalid.error, /存在しない日付/);
  for (const text of ['9/1/2026', '01.09.2026', '1-9-2026']) {
    const ambiguous = parseDate(text);
    assert.match(ambiguous.ok ? '' : ambiguous.error, /月と日の順序が決まらない/, text);
  }
  // 区切りの文字が揃っていない表記と、前後に数字が続く表記は読みません。
  assert.equal(parseDate('2026/09-01').ok, false);
  assert.equal(parseDate('12026/9/1').ok, false);
});

test('月の条件は、読み取った日付がその月に含まれるかを判定する（#103）', () => {
  const condition = { target, month: '2026-09' };
  assert.deepEqual(evaluateCondition(condition, '2026年9月1日', false), { ok: true, met: true });
  assert.deepEqual(evaluateCondition(condition, '2026年9月30日', false), { ok: true, met: true });
  assert.deepEqual(evaluateCondition(condition, '2026年8月31日', false), { ok: true, met: false });
  assert.deepEqual(evaluateCondition(condition, '2026年10月1日', false), { ok: true, met: false });
  assert.deepEqual(evaluateCondition(condition, '2025年9月1日', false), { ok: true, met: false });
});

test('期間の条件は、両端を含めて判定し、片方だけの指定もできる（#103）', () => {
  const both = { target, from: '2026-09-10', to: '2026-09-20' };
  assert.deepEqual(evaluateCondition(both, '2026/9/10', false), { ok: true, met: true });
  assert.deepEqual(evaluateCondition(both, '2026/9/20', false), { ok: true, met: true });
  assert.deepEqual(evaluateCondition(both, '2026/9/9', false), { ok: true, met: false });
  assert.deepEqual(evaluateCondition(both, '2026/9/21', false), { ok: true, met: false });
  assert.deepEqual(evaluateCondition({ target, from: '2026-09-10' }, '2027/1/1', false), {
    ok: true,
    met: true,
  });
  assert.deepEqual(evaluateCondition({ target, to: '2026-09-10' }, '2026/9/11', false), {
    ok: true,
    met: false,
  });
});

test('日付を読み取れない場合と、当てはめた値の形式が誤っている場合は、停止する理由を返す（#103）', () => {
  const unreadable = evaluateCondition({ target, month: '2026-09' }, '昨日', false);
  assert.equal(unreadable.ok, false);
  assert.match(
    unreadable.ok ? '' : unreadable.error,
    /「注文日」から日付を読み取れないため、停止しました。/,
  );
  const month = evaluateCondition({ target, month: '2026-9' }, '2026/9/1', false);
  assert.match(month.ok ? '' : month.error, /2026-09 の形式ではありません/);
  const from = evaluateCondition({ target, from: '2026-02-30' }, '2026/9/1', false);
  assert.match(from.ok ? '' : from.error, /正しい日付ではありません/);
});

test('日付の条件は、翻訳されたページでも、日付として読めれば判定する（#103）', () => {
  // 翻訳で表記が変わっても、同じ日付として読めれば結果は変わりません。
  const condition = { target, month: '2026-09' };
  assert.deepEqual(evaluateCondition(condition, '2026年9月1日', true), { ok: true, met: true });
  assert.deepEqual(evaluateCondition(condition, 'September 1, 2026', true), {
    ok: true,
    met: true,
  });
});

test('文字の条件は、含むか・一致するかを、空白の違いを除いて判定する（#103）', () => {
  assert.deepEqual(
    evaluateCondition({ target, contains: '発送済み' }, ' 状態： 発送済み ', false),
    {
      ok: true,
      met: true,
    },
  );
  assert.deepEqual(evaluateCondition({ target, contains: '発送済み' }, '未発送', false), {
    ok: true,
    met: false,
  });
  assert.deepEqual(evaluateCondition({ target, equals: '発送 済み' }, '発送\n  済み', false), {
    ok: true,
    met: true,
  });
  assert.deepEqual(evaluateCondition({ target, equals: '発送済み' }, '発送済み（一部）', false), {
    ok: true,
    met: false,
  });
});

test('文字の条件は、ページが翻訳されている場合は判定せずに停止する理由を返す（#103）', () => {
  for (const condition of [
    { target, contains: '発送済み' },
    { target, equals: '発送済み' },
  ]) {
    const result = evaluateCondition(condition, '発送済み', true);
    assert.equal(result.ok, false);
    assert.match(
      result.ok ? '' : result.error,
      /「注文日」の文字の条件は、ページが Chrome の翻訳で表示されているため判定できません。/,
    );
  }
});

test('条件の種類と説明（#103）', () => {
  assert.equal(conditionKind({ target, exists: true }), 'exists');
  assert.equal(conditionKind({ target, contains: 'a' }), 'text');
  assert.equal(conditionKind({ target, equals: 'a' }), 'text');
  assert.equal(conditionKind({ target, month: '2026-09' }), 'date');
  assert.equal(conditionKind({ target, to: '2026-09-01' }), 'date');
  assert.equal(describeCondition({ target, exists: false }), '「注文日」がない場合');
  assert.equal(describeCondition({ target, contains: '済' }), '「注文日」が「済」を含む場合');
  assert.equal(describeCondition({ target, equals: '済' }), '「注文日」が「済」の場合');
  assert.equal(
    describeCondition({ target, month: '{{month}}' }),
    '「注文日」が {{month}} の日付の場合',
  );
  assert.equal(
    describeCondition({ target, from: '2026-09-01' }),
    '「注文日」が 2026-09-01〜 の日付の場合',
  );
});

test('isDateValue は、YYYY-MM-DD の形式の存在する日付だけを受け付ける（#103）', () => {
  assert.equal(isDateValue('2026-09-01'), true);
  assert.equal(isDateValue('2028-02-29'), true);
  assert.equal(isDateValue('2026-02-29'), false);
  assert.equal(isDateValue('2026-9-1'), false);
});
