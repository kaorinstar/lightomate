// 手順とパラメータの説明（extension/shared/describe.js）のテストです。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_STEP_MAX_LENGTH,
  describeStep,
  describeStepForPage,
  pageStepText,
  paramColumns,
  runDetailText,
  runStatusLabel,
  runStatusText,
  runStatusTone,
  stepKindLabel,
  targetName,
} from '../extension/shared/describe.js';

const target = { selectors: ['#a'], tag: 'button', label: '注文履歴', text: '注文履歴' };

test('手順の種類を短い名前にする', () => {
  assert.equal(stepKindLabel({ type: 'click', target }), 'クリック');
  assert.equal(stepKindLabel({ type: 'input', target, value: 'x' }), '入力');
  assert.equal(stepKindLabel({ type: 'pause' }), '一時停止');
});

test('年月の既定値の @previous-month と @current-month を、前月と今月と表示する', () => {
  assert.deepEqual(
    paramColumns({ name: 'month', label: '対象月', type: 'month', default: '@previous-month' }),
    { label: '対象月', reference: '{{month}}', type: '年月', defaultValue: '前月' },
  );
  assert.equal(
    paramColumns({ name: 't', label: '対象月', type: 'month', default: '@current-month' })
      .defaultValue,
    '今月',
  );
});

test('選択肢は種類に添え、既定値がない場合は「なし」と表示する', () => {
  assert.deepEqual(
    paramColumns({ name: 's', label: '店舗', type: 'select', options: ['本店', '支店'] }),
    { label: '店舗', reference: '{{s}}', type: '選択肢（本店、支店）', defaultValue: 'なし' },
  );
  assert.equal(
    paramColumns({ name: 'n', label: '数量', type: 'number', default: '3' }).defaultValue,
    '3',
  );
});

test('待機の手順は「3 秒待つ」の形で説明する（#15）', () => {
  assert.equal(describeStep({ type: 'wait', ms: 3000 }), '3 秒待つ');
  assert.equal(describeStep({ type: 'wait', ms: 1500 }), '1.5 秒待つ');
  assert.equal(stepKindLabel({ type: 'wait', ms: 3000 }), '待機');
});

test('一時停止中の状態の説明に、手順の番号と次の手順を含める（#37）', () => {
  const run = { flowName: '領収書', status: 'paused', stepIndex: 2, total: 8 };
  assert.equal(
    runStatusText(run, { type: 'click', target }),
    '「領収書」は 手順 3 / 8 の前で一時停止しています（次の手順：クリック：注文履歴）。' +
      '続ける場合は［再開］を押してください。',
  );
  assert.match(
    runStatusText({ ...run, note: '確定は手で行ってください。' }, undefined),
    /の前で一時停止しています。確定は手で行ってください。続ける場合は/,
  );
});

test('一時停止の処理中の説明に、実行中の手順を含める（#37）', () => {
  const run = { flowName: '領収書', status: 'pausing', stepIndex: 0, total: 8 };
  assert.match(runStatusText(run, { type: 'click', target }), /手順 1 \/ 8（クリック：注文履歴）/);
});

test('条件分岐と繰り返しの手順の説明（#6）', () => {
  assert.equal(
    describeStep({ type: 'if', condition: { target, exists: true }, then: [] }),
    '条件：「注文履歴」がある場合',
  );
  assert.equal(
    describeStep({ type: 'if', condition: { target, exists: false }, then: [] }),
    '条件：「注文履歴」がない場合',
  );
  assert.equal(
    describeStep({ type: 'forEach', items: target, steps: [] }),
    '繰り返し：「注文履歴」の各行（上限 100 件）',
  );
  assert.equal(
    describeStep({
      type: 'forEach',
      items: target,
      nextPage: { ...target, label: '次へ' },
      steps: [],
    }),
    '繰り返し：「注文履歴」の各行（上限 100 件、「次へ」で次のページへ、上限 10 ページ）',
  );
  assert.equal(stepKindLabel({ type: 'forEach', items: target, max: 5, steps: [] }), '繰り返し');
  assert.equal(
    stepKindLabel({ type: 'if', condition: { target, exists: true }, then: [] }),
    '条件',
  );
});

test('繰り返しの中では、手順の番号に何件目かを添える（#6）', () => {
  const run = { flowName: 'a', status: 'running', stepIndex: 4, total: 9, items: [3] };
  assert.equal(runStatusText(run, undefined), '「a」を実行中です。手順 5 / 9（3 件目）');
});

test('ページ送りの繰り返しの中では、何ページ目かも添える（#95）', () => {
  const run = { flowName: 'a', status: 'running', stepIndex: 4, total: 9, items: [3], page: 2 };
  assert.equal(
    runStatusText(run, undefined),
    '「a」を実行中です。手順 5 / 9（2 ページ目の 3 件目）',
  );
});

test('while と、文字・日付の条件の手順の説明（#103）', () => {
  const more = { selectors: ['.more'], tag: 'button', label: 'もっと見る' };
  assert.equal(
    describeStep({ type: 'while', condition: { target: more, exists: true }, steps: [] }),
    '繰り返し：「もっと見る」がある場合の間（上限 100 回）',
  );
  assert.equal(
    describeStep({ type: 'while', condition: { target: more, exists: true }, max: 5, steps: [] }),
    '繰り返し：「もっと見る」がある場合の間（上限 5 回）',
  );
  assert.equal(
    describeStep({ type: 'if', condition: { target, month: '{{month}}' }, then: [] }),
    '条件：「注文履歴」が {{month}} の日付の場合',
  );
  assert.equal(
    stepKindLabel({ type: 'while', condition: { target: more, exists: true }, steps: [] }),
    '繰り返し',
  );
});

test('while の中では、手順の番号に何回目かを添える（#103）', () => {
  const run = {
    flowName: 'a',
    status: 'running',
    stepIndex: 4,
    total: 9,
    items: [3],
    loops: /** @type {('item' | 'round')[]} */ (['round']),
  };
  assert.equal(runStatusText(run, undefined), '「a」を実行中です。手順 5 / 9（3 回目）');
});

test('実行のカードの状態の印と、フロー名を含まない進み具合の文（#7）', () => {
  const base = { flowName: '注文', stepIndex: 1, total: 3 };
  assert.equal(runStatusLabel('running'), '実行中');
  assert.equal(runStatusLabel('paused'), '一時停止中');
  assert.equal(runStatusLabel('halted'), '確定の手前で停止');
  assert.equal(runStatusLabel('failed'), '失敗');
  assert.equal(runStatusTone('running'), 'primary');
  assert.equal(runStatusTone('paused'), 'warning');
  assert.equal(runStatusTone('done'), 'success');
  assert.equal(runStatusTone('failed'), 'danger');
  assert.equal(runStatusTone('stopped'), 'muted');

  assert.equal(
    runDetailText({ ...base, status: 'running' }, { type: 'click', target }),
    '手順 2 / 3：クリック：注文履歴',
  );
  assert.equal(runDetailText({ ...base, status: 'done' }, undefined), '');
  assert.equal(
    runDetailText({ ...base, status: 'failed', error: '要素が見つかりません。' }, undefined),
    '手順 2 / 3 で止まりました。要素が見つかりません。',
  );
  // フロー名は含めません。カードの 1 行目に出すためです。
  for (const status of ['running', 'paused', 'stopped', 'halted', 'failed']) {
    assert.doesNotMatch(runDetailText({ ...base, status }, undefined), /注文/);
  }
});

test('新しいタブで開くクリックと、タブを閉じる手順の説明（#20）', () => {
  const target = { selectors: ['a.receipt'], tag: 'a', label: '領収書' };
  assert.equal(
    describeStep({ type: 'click', target, newTab: true }),
    'クリック：領収書（新しいタブで開き、以降はそのタブで実行）',
  );
  assert.equal(describeStep({ type: 'click', target }), 'クリック：領収書');
  assert.equal(describeStep({ type: 'closeTab' }), 'タブを閉じて、元のタブに戻る');
  assert.equal(stepKindLabel({ type: 'closeTab' }), 'タブを閉じる');
});

test('ダウンロードの保存先を指定したクリックの説明（#20）', () => {
  const target = { selectors: ['a.invoice'], tag: 'a', label: 'PDF' };
  assert.equal(
    describeStep({ type: 'click', target, download: { path: 'L/{{n}}', onConflict: 'overwrite' } }),
    'クリック：PDF（ダウンロードを L/{{n}} に保存、同じ名前は上書き）',
  );
  assert.equal(
    describeStep({ type: 'click', target, download: { path: 'L/{{n}}' } }),
    'クリック：PDF（ダウンロードを L/{{n}} に保存）',
  );
});

test('リンク先のファイルを保存する指定のクリックは、クリックとは別の名前で説明する（#172）', () => {
  const target = { selectors: ['a.invoice'], tag: 'a', label: '明細書' };
  /** @type {import('../extension/shared/flow.js').Step} */
  const step = { type: 'click', target, download: { path: 'L/{{n}}', from: 'link' } };
  assert.equal(describeStep(step), 'リンク先のファイルを保存：明細書（L/{{n}} に保存）');
  assert.equal(describeStepForPage(step), 'リンク先のファイルを保存：明細書');
});

test('一致するリンクをすべて保存する指定は、その旨を添えて説明する（#185）', () => {
  const target = { selectors: ['a[href*="/invoice.pdf"]'], tag: 'a', label: '明細書' };
  /** @type {import('../extension/shared/flow.js').Step} */
  const step = {
    type: 'click',
    target,
    download: { path: 'L/{{n}}', onConflict: 'overwrite', from: 'link', all: true },
  };
  assert.equal(
    describeStep(step),
    'リンク先のファイルを保存：明細書（L/{{n}} に保存、同じ名前は上書き、一致するリンクをすべて）',
  );
});

// ---- 実行中のページの枠に表示する手順（#156） ----

test('ページに出す手順の文には、入力する値、選ぶ値、URL、保存先、条件の値を含めない', () => {
  /** @type {[import('../extension/shared/flow.js').Step, string, string[]][]} */
  const cases = [
    [
      { type: 'input', target: { ...target, label: 'メール' }, value: 'a@example.com' },
      '入力：メール',
      ['a@example.com'],
    ],
    [
      { type: 'select', target: { ...target, label: '個数' }, values: ['2'], labels: ['2 個'] },
      '選択：個数',
      ['2 個'],
    ],
    [
      { type: 'navigate', cause: 'user', url: 'https://example.com/secret?q=1' },
      'ページを開く',
      ['example.com'],
    ],
    [
      { type: 'navigate', cause: 'page', url: 'https://example.com/next' },
      'ページの移動を待つ',
      ['example.com'],
    ],
    [{ type: 'savePdf', path: 'Lightomate/{{orderNo}}.pdf' }, 'PDF を保存', ['orderNo']],
    [
      { type: 'click', target, download: { path: 'Lightomate/{{orderNo}}' } },
      'クリック：注文履歴',
      ['orderNo'],
    ],
    [{ type: 'extract', target, name: 'orderNo' }, '読み取り：注文履歴', ['orderNo']],
    [
      { type: 'if', condition: { target, contains: '株式会社' }, then: [] },
      '条件：「注文履歴」を確かめる',
      ['株式会社'],
    ],
    [
      { type: 'while', condition: { target, equals: '次へ' }, steps: [] },
      '繰り返し：「注文履歴」を確かめる',
      ['次へ'],
    ],
    [{ type: 'pause', note: '暗証番号を入力' }, '一時停止', ['暗証番号']],
    [{ type: 'wait', ms: 150000 }, '150 秒待つ', []],
  ];
  for (const [step, expected, hidden] of cases) {
    const text = describeStepForPage(step);
    assert.equal(text, expected);
    for (const value of hidden) {
      assert.ok(!text.includes(value), `${expected} に ${value} が含まれています`);
    }
  }
});

test('ページに出す文は、手順の番号と繰り返しの何件目かを付け、長い文は末尾を「…」にする', () => {
  assert.equal(
    pageStepText({ stepIndex: 1, total: 2 }, { type: 'wait', ms: 150000 }),
    '手順 2 / 2：150 秒待つ',
  );
  assert.equal(
    pageStepText({ stepIndex: 4, total: 8, items: [2] }, { type: 'click', target }),
    '手順 5 / 8（2 件目）：クリック：注文履歴',
  );
  const long = pageStepText(
    { stepIndex: 0, total: 1 },
    { type: 'click', target: { ...target, label: 'あ'.repeat(100) } },
  );
  assert.equal(long.length, PAGE_STEP_MAX_LENGTH);
  assert.ok(long.endsWith('…'));
});

test('すべての手順を終えた後と、「待つ」の途中の一時停止の文（#160）', () => {
  const run = { flowName: '月次', status: 'paused', stepIndex: 2, total: 2 };
  assert.equal(
    runStatusText(run, undefined),
    '「月次」は、すべての手順を終えた後で一時停止しています。［再開］を押すと完了します。',
  );
  assert.equal(
    runDetailText(run, undefined),
    'すべての手順を終えた後で一時停止しています。［再開］を押すと完了します。',
  );
  // 「待つ」の途中の一時停止は、再開すると残りの時間を待つことを示します。
  assert.equal(
    runDetailText({ ...run, stepIndex: 1, midStep: true }, { type: 'wait', ms: 150000 }),
    '手順 2 / 2（150 秒待つ）の途中で一時停止しています。［再開］を押すと、残りの時間を待ってから続けます。',
  );
  // 途中の手順の前の一時停止は、これまでどおりです。
  assert.match(
    runDetailText({ ...run, stepIndex: 1 }, { type: 'wait', ms: 1000 }),
    /^手順 2 \/ 2 の前で一時停止しています/,
  );
});

test('年月の既定値の @month-before-last を、前々月と表示する（#163）', () => {
  assert.equal(
    paramColumns({ name: 'm', label: '対象月', type: 'month', default: '@month-before-last' })
      .defaultValue,
    '前々月',
  );
});

test('Shadow DOM の中の要素の手順は、説明に部品の内側であることを添える（#20）', () => {
  const inner = { ...target, label: '送信', shadow: ['checkout-form'] };
  assert.equal(targetName(inner), '送信（部品の内側）');
  assert.equal(targetName(target), '注文履歴');
  assert.equal(describeStep({ type: 'click', target: inner }), 'クリック：送信（部品の内側）');
  assert.equal(
    describeStep({ type: 'input', target: { ...inner, label: '名前' }, value: '山田' }),
    '入力：名前（部品の内側） ← 山田',
  );
  assert.equal(
    describeStep({ type: 'extract', target: { ...inner, label: '注文番号' }, name: 'orderNumber' }),
    '読み取り：注文番号（部品の内側） → {{orderNumber}}',
  );
});

test('iframe の中の要素の手順は、説明に枠のサイトを添える（#20）', () => {
  const inFrame = {
    ...target,
    label: 'カード番号',
    frame: { url: 'https://pay.example.net/card' },
  };
  assert.equal(targetName(inFrame), 'カード番号（https://pay.example.net の枠の中）');
  assert.equal(
    targetName({ ...inFrame, shadow: ['card-field'] }),
    'カード番号（https://pay.example.net の枠の中、部品の内側）',
  );
  assert.equal(
    describeStep({ type: 'input', target: inFrame, secret: true }),
    '入力：カード番号（https://pay.example.net の枠の中）（値は記録していません）',
  );
});
