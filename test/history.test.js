import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HISTORY_LIMIT,
  REDACTED,
  appendHistory,
  historyEntryFromRun,
  historyEntryText,
  historyToCsv,
  pageUrlForHistory,
  reportDateTime,
  redactValues,
  stepText,
  withoutHistoryEntries,
} from '../extension/shared/history.js';

/**
 * @param {string} runId
 * @returns {import('../extension/shared/history.js').HistoryEntry}
 */
function entry(runId) {
  return {
    runId,
    flowId: 'f1',
    flowName: '領収書',
    origin: 'https://www.example.com',
    startedAt: '2026-09-25T00:00:00.000Z',
    endedAt: '2026-09-25T00:01:00.000Z',
    status: 'done',
    total: 3,
    files: [],
  };
}

const run = {
  runId: 'r1',
  flowId: 'f1',
  flowName: '領収書',
  origin: 'https://www.example.com',
  startedAt: '2026-09-25T00:00:00.000Z',
  stepIndex: 1,
  total: 3,
};

test('新しい履歴を先頭に加える', () => {
  const history = appendHistory([entry('a')], entry('b'));
  assert.deepEqual(
    history.map((item) => item.runId),
    ['b', 'a'],
  );
});

test(`件数の上限（${HISTORY_LIMIT} 件）を超えた分は、古い順に削除する`, () => {
  const full = Array.from({ length: HISTORY_LIMIT }, (_, index) => entry(String(index)));
  const history = appendHistory(full, entry('new'));
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0].runId, 'new');
  // 最も古い履歴（末尾）が削除されます。
  assert.equal(history.at(-1)?.runId, String(HISTORY_LIMIT - 2));
});

test('上限を指定した場合は、その件数に収める', () => {
  const history = appendHistory([entry('a'), entry('b')], entry('c'), 2);
  assert.deepEqual(
    history.map((item) => item.runId),
    ['c', 'a'],
  );
});

test('同じ実行の履歴は、2 件目を作らずに置き換える', () => {
  const history = appendHistory([entry('a'), entry('b')], { ...entry('a'), status: 'failed' });
  assert.deepEqual(
    history.map((item) => [item.runId, item.status]),
    [
      ['a', 'failed'],
      ['b', 'done'],
    ],
  );
});

test('元の一覧は変更しない', () => {
  const original = [entry('a')];
  appendHistory(original, entry('b'));
  assert.equal(original.length, 1);
});

test('指定した実行の履歴だけを除き、元の一覧は変更しない（#75）', () => {
  const original = [entry('a'), entry('b'), entry('c')];
  const history = withoutHistoryEntries(original, ['b']);
  assert.deepEqual(
    history.map((item) => item.runId),
    ['a', 'c'],
  );
  assert.equal(original.length, 3);
});

test('一覧にない実行を指定した場合は、一覧を変えない（#75）', () => {
  const history = withoutHistoryEntries([entry('a'), entry('b')], ['x']);
  assert.deepEqual(
    history.map((item) => item.runId),
    ['a', 'b'],
  );
});

test('複数の実行を指定した場合は、すべて除く（#75）', () => {
  const history = withoutHistoryEntries([entry('a'), entry('b'), entry('c')], ['a', 'c']);
  assert.deepEqual(
    history.map((item) => item.runId),
    ['b'],
  );
});

test('入力した値と、URL にエンコードした形を伏せる', () => {
  const text =
    '想定したページ（https://www.example.com/search?q=%E3%81%AD%E3%81%98）に移動しませんでした。ねじ';
  assert.equal(
    redactValues(text, ['ねじ']),
    `想定したページ（https://www.example.com/search?q=${REDACTED}）に移動しませんでした。${REDACTED}`,
  );
});

test('長い値から先に伏せ、1 文字の値は伏せない', () => {
  assert.equal(redactValues('2026-08 の 8 月', ['2026-08', '2026', '8']), `${REDACTED} の 8 月`);
});

test('成功した実行は、止まった手順と理由を持たない', () => {
  const result = historyEntryFromRun(
    { ...run, status: 'done', stepIndex: 2 },
    '2026-09-25T00:01:00.000Z',
    [],
  );
  assert.ok(result);
  assert.equal(result.status, 'done');
  assert.equal(result.stepNumber, undefined);
  assert.equal(result.reason, undefined);
  assert.deepEqual(result.files, []);
});

test('失敗した実行は、止まった手順（1 から数える）と、値を伏せた理由を持つ', () => {
  const result = historyEntryFromRun(
    {
      ...run,
      status: 'failed',
      error: '移動先（https://www.example.com/?m=2026-08）に移動しません',
    },
    '2026-09-25T00:01:00.000Z',
    ['2026-08'],
  );
  assert.ok(result);
  assert.equal(result.stepNumber, 2);
  assert.equal(result.reason, `移動先（https://www.example.com/?m=${REDACTED}）に移動しません`);
});

test('停止した実行は、完了した手順の次の手順で止まったとする', () => {
  const result = historyEntryFromRun({ ...run, status: 'stopped', stepIndex: 1 }, '', []);
  assert.equal(result?.stepNumber, 2);
});

test('実行中の状態からは、履歴を作らない', () => {
  assert.equal(historyEntryFromRun({ ...run, status: 'running' }, '', []), null);
  assert.equal(historyEntryFromRun({ ...run, status: 'stopping' }, '', []), null);
  assert.equal(historyEntryFromRun({ ...run, status: 'pausing' }, '', []), null);
  assert.equal(historyEntryFromRun({ ...run, status: 'paused' }, '', []), null);
});

test('CSV は見出しと各行を CRLF で区切り、先頭に BOM を付ける', () => {
  const csv = historyToCsv([entry('a')]);
  assert.ok(
    csv.startsWith(
      '﻿開始,終了,フロー,サイト,結果,止まった手順,止まった手順の内容,ページ,やり直し,理由,保存したファイル\r\n',
    ),
  );
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.split('\r\n').length, 3);
});

test('CSV の値に区切りの文字、引用符、改行を含む場合は引用符で囲む', () => {
  const csv = historyToCsv([
    {
      ...entry('a'),
      flowName: '領収書, "8 月"',
      status: 'failed',
      stepNumber: 2,
      reason: '1 行目\n2 行目',
    },
  ]);
  assert.ok(csv.includes('"領収書, ""8 月"""'));
  assert.ok(csv.includes(',失敗,2 / 3,,,,"1 行目\n2 行目",'));
});

test("CSV の値が数式として実行されないよう、= などで始まる値の先頭に ' を付ける", () => {
  const csv = historyToCsv([{ ...entry('a'), flowName: '=HYPERLINK("http://x")' }]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`));
});

test('保存したファイルのパスを記録する（#16）', () => {
  const files = ['/home/me/Downloads/Lightomate/領収書/a.pdf'];
  const result = historyEntryFromRun({ ...run, status: 'done', stepIndex: 2 }, '', [], { files });
  assert.deepEqual(result?.files, files);
  // 元の配列を後から変更しても、履歴は変わりません。
  files.push('b.pdf');
  assert.equal(result?.files.length, 1);
});

test('繰り返しの中で止まった実行は、何件目の行かを持ち、止まった手順に添えて表示する（#6）', () => {
  const result = historyEntryFromRun({ ...run, status: 'failed', items: [2, 3] }, '', []);
  assert.ok(result);
  assert.deepEqual(result.items, [2, 3]);
  assert.equal(stepText(result), `2 / ${run.total}（2 件目の 3 件目）`);
  const done = historyEntryFromRun({ ...run, status: 'done', items: [2] }, '', []);
  assert.equal(done?.items, undefined);
});

// ---- 失敗の詳細とコピー（#93） ----

/** @type {import('../extension/shared/flow.js').Step} */
const clickStep = {
  type: 'click',
  target: { label: '注文履歴', tag: 'a', selectors: ['#orders'] },
};

const failed = {
  ...run,
  status: 'failed',
  error: '「注文履歴」が見つかりませんでした。',
  schemaVersion: 6,
};

const extra = {
  step: clickStep,
  pageUrl: 'https://www.example.com/gp/orders?ref=nav#top',
  retries: 3,
  extensionVersion: '0.2.0',
};

test('失敗した実行は、止まった手順の内容、ページ、やり直した回数、版を持つ', () => {
  const result = historyEntryFromRun(failed, '', [], extra);
  assert.ok(result);
  assert.equal(result.step, 'クリック：注文履歴');
  assert.equal(result.pageUrl, 'https://www.example.com/gp/orders');
  assert.equal(result.retries, 3);
  assert.equal(result.extensionVersion, '0.2.0');
  assert.equal(result.schemaVersion, 6);
});

test('中止と一時停止の実行も、止まった手順の内容とページを持つ', () => {
  for (const status of ['stopped', 'halted']) {
    const result = historyEntryFromRun({ ...failed, status }, '', [], extra);
    assert.equal(result?.step, 'クリック：注文履歴');
    assert.equal(result?.pageUrl, 'https://www.example.com/gp/orders');
  }
});

test('成功した実行は、止まった手順の内容、ページ、やり直した回数、版を持たない', () => {
  const result = historyEntryFromRun({ ...failed, status: 'done', stepIndex: 2 }, '', [], extra);
  assert.ok(result);
  assert.equal(result.step, undefined);
  assert.equal(result.pageUrl, undefined);
  assert.equal(result.retries, undefined);
  assert.equal(result.extensionVersion, undefined);
  assert.equal(result.schemaVersion, undefined);
});

test('やり直していない場合は、やり直した回数を持たない', () => {
  const result = historyEntryFromRun(failed, '', [], { ...extra, retries: 0 });
  assert.equal(result?.retries, undefined);
});

test('止まった手順の内容とページの URL の中の、入力した値を伏せる', () => {
  /** @type {import('../extension/shared/flow.js').Step} */
  const input = {
    type: 'input',
    target: { label: '検索', tag: 'input', selectors: ['#q'] },
    value: 'ねじ 8mm',
  };
  const result = historyEntryFromRun(failed, '', ['ねじ 8mm', 'yamada'], {
    step: input,
    pageUrl: 'https://www.example.com/users/yamada/search/%E3%81%AD%E3%81%98%208mm?q=secret',
  });
  assert.equal(result?.step, `入力：検索 ← ${REDACTED}`);
  assert.equal(result?.pageUrl, `https://www.example.com/users/${REDACTED}/search/${REDACTED}`);
});

test('ページの URL は、クエリとフラグメントを除き、Web 以外の URL は記録しない', () => {
  assert.equal(
    pageUrlForHistory('https://www.example.com/a/b?x=1#y', []),
    'https://www.example.com/a/b',
  );
  assert.equal(pageUrlForHistory('http://localhost:8080/', []), 'http://localhost:8080/');
  assert.equal(pageUrlForHistory('chrome://extensions/', []), undefined);
  assert.equal(pageUrlForHistory('読めない', []), undefined);
});

test('履歴 1 件を、貼り付けて報告できるテキストにする', () => {
  const result = historyEntryFromRun(
    { ...failed, startedAt: '2026-09-26T01:00:00.000Z' },
    '2026-09-26T01:00:42.000Z',
    [],
    { ...extra, files: ['/home/me/a.pdf'] },
  );
  assert.ok(result);
  assert.equal(
    historyEntryText(result),
    [
      'Lightomate 0.2.0 の実行履歴',
      'フロー：領収書（形式の版 6）',
      'サイト：https://www.example.com',
      `開始：${reportDateTime('2026-09-26T01:00:00.000Z')}`,
      `終了：${reportDateTime('2026-09-26T01:00:42.000Z')}`,
      '結果：失敗',
      '止まった手順：2 / 3（クリック：注文履歴）',
      'ページ：https://www.example.com/gp/orders',
      'やり直し：3 回',
      '理由：「注文履歴」が見つかりませんでした。',
      '保存したファイル：/home/me/a.pdf',
      '',
    ].join('\n'),
  );
});

test('#93 より前に記録した履歴も、ない項目の行を省いてテキストにする', () => {
  const text = historyEntryText({ ...entry('a'), status: 'failed', stepNumber: 2 });
  assert.ok(text.startsWith('Lightomate の実行履歴\nフロー：領収書\n'));
  assert.ok(text.includes('止まった手順：2 / 3\n'));
  assert.ok(!text.includes('ページ：'));
  assert.ok(!text.includes('やり直し：'));
  assert.ok(!text.includes('理由：'));
  assert.ok(!text.includes('保存したファイル：'));
});

test('CSV に、止まった手順の内容、ページ、やり直した回数の列を出力する', () => {
  const result = historyEntryFromRun(failed, '', [], extra);
  assert.ok(result);
  assert.ok(
    historyToCsv([result]).includes(
      ',失敗,2 / 3,クリック：注文履歴,https://www.example.com/gp/orders,3 回,',
    ),
  );
});

test('報告用の日時は秒まで示す', () => {
  assert.match(reportDateTime('2026-09-26T01:00:42.000Z'), /:42$/);
});
