import { test } from 'node:test';
import assert from 'node:assert/strict';

import { REDACTED, historyEntryFromRun, historyEntryText } from '../extension/shared/history.js';
import {
  VARIABLE_MAX_LENGTH,
  flowFingerprint,
  historyReportText,
  historyVariables,
  inputReferenceNames,
  redactFlowForReport,
} from '../extension/shared/history-report.js';

/** @typedef {import('../extension/shared/flow.js').Flow} Flow */

const USER = 'tanaka@example.com';
const LITERAL_USER = 'suzuki.ichiro';
const PASSWORD = 'p@ssw0rd-secret';

/**
 * ログインと注文の一覧を含むフローです。ログインの ID は、パラメータ（loginId）で入力する手順と、
 * 記録した値（LITERAL_USER）をそのまま入力する手順の両方を含みます。
 * @returns {Flow}
 */
function flow() {
  return /** @type {Flow} */ ({
    schemaVersion: 18,
    name: '領収書',
    origin: 'https://www.example.com',
    params: [
      { name: 'loginId', label: 'ログイン ID', type: 'text', default: USER },
      { name: 'target', label: '対象月', type: 'month', default: '@previous-month' },
    ],
    steps: [
      {
        type: 'navigate',
        url: 'https://www.example.com/login?return=%2Forders#top',
        cause: 'user',
      },
      {
        type: 'input',
        target: { selectors: ['#login'], tag: 'input', label: 'ログイン ID' },
        value: '{{loginId}}',
      },
      {
        type: 'input',
        target: { selectors: ['#sub'], tag: 'input', label: '別の ID' },
        value: LITERAL_USER,
      },
      {
        type: 'input',
        target: { selectors: ['#password'], tag: 'input', label: 'パスワード' },
        secret: true,
      },
      {
        type: 'navigate',
        url: 'https://www.example.com/orders?month={{target}}',
        cause: 'user',
      },
      {
        type: 'forEach',
        items: { selectors: ['.order'], tag: 'div', label: '注文' },
        steps: [
          {
            type: 'extract',
            target: { selectors: ['.number'], tag: 'span', label: '注文番号', scope: 'item' },
            name: 'orderNumber',
          },
          {
            type: 'click',
            target: { selectors: ['.receipt'], tag: 'a', label: `${LITERAL_USER} 様の領収書` },
          },
        ],
      },
    ],
  });
}

/** 止まった時点の値です。 */
const values = {
  'flow.name': '領収書',
  loginId: USER,
  target: '2026-08',
  'target.year': '2026',
  orderNumber: '503-1234567',
};

/**
 * 失敗した実行の履歴の 1 件です。
 * @param {Flow} source
 * @returns {Promise<import('../extension/shared/history.js').HistoryEntry>}
 */
async function failedEntry(source) {
  const entry = historyEntryFromRun(
    {
      runId: 'r1',
      flowId: 'f1',
      flowName: '領収書',
      origin: 'https://www.example.com',
      startedAt: '2026-09-25T00:00:00.000Z',
      status: 'failed',
      stepIndex: 5,
      total: 8,
      error: `「${USER}」でログインできませんでした。`,
    },
    '2026-09-25T00:01:00.000Z',
    [USER, PASSWORD, '2026-08', '503-1234567'],
    {
      variables: historyVariables(source, values, [PASSWORD]),
      flowHash: await flowFingerprint(source),
    },
  );
  assert.ok(entry);
  return entry;
}

/**
 * 履歴の［コピー］と同じテキストです。
 * @param {Flow} source 実行したフロー
 * @param {Flow | undefined} current コピーした時点のフロー
 * @returns {Promise<string>}
 */
async function copiedText(source, current = source) {
  const entry = await failedEntry(source);
  const fingerprint = current ? await flowFingerprint(current) : undefined;
  return `${historyEntryText(entry)}${historyReportText(entry, current, fingerprint)}`;
}

test('コピーのテキストに、履歴の内容、変数の値、フロー定義の JSON が含まれる', async () => {
  const text = await copiedText(flow());
  assert.match(text, /^Lightomate の実行履歴\n/);
  assert.match(text, /結果：失敗/);
  assert.match(text, /\n変数（入力欄に入れた値は伏せています）：\n {2}loginId：/);
  assert.match(
    text,
    /\nフローの定義（入力した値と、ユーザー名・パスワードは伏せています）：\n\{\n/,
  );
  const json = text.slice(text.indexOf('\n{\n') + 1);
  const parsed = JSON.parse(json);
  assert.equal(parsed.name, '領収書');
  assert.equal(parsed.steps.length, 6);
});

test('入力欄に入れた値（ユーザー名）とパスワードは、変数・フロー定義・理由のどこにも含まれない', async () => {
  const text = await copiedText(flow());
  assert.ok(!text.includes(USER), text);
  assert.ok(!text.includes(LITERAL_USER), text);
  assert.ok(!text.includes(PASSWORD), text);
  assert.ok(!text.includes(encodeURIComponent(USER)), text);
});

test('入力欄に入れた変数は伏せて文字数を添え、それ以外の変数の値は含める', async () => {
  const text = await copiedText(flow());
  assert.match(text, new RegExp(`\n {2}loginId：${REDACTED}（${USER.length} 文字）\n`));
  assert.match(text, /\n {2}target：2026-08\n/);
  assert.match(text, /\n {2}orderNumber：503-1234567\n/);
});

test('変数の一覧は、パラメータ、読み取った値の順で、組み込みの値と年月の部分は含めない', () => {
  assert.deepEqual(historyVariables(flow(), values, []), [
    { name: 'loginId', length: USER.length },
    { name: 'target', value: '2026-08' },
    { name: 'orderNumber', value: '503-1234567' },
  ]);
});

test('まだ値のない変数（止まった手順より後の読み取り）は含めない', () => {
  /** @type {Record<string, string>} */
  const before = { ...values };
  delete before.orderNumber;
  assert.deepEqual(
    historyVariables(flow(), before, []).map((variable) => variable.name),
    ['loginId', 'target'],
  );
});

test('ほかの変数の値の中の、入力欄に入れた文字とパスワードは伏せる', () => {
  const source = flow();
  source.steps.push({
    type: 'extract',
    target: { selectors: ['.greeting'], tag: 'p', label: 'あいさつ' },
    name: 'greeting',
  });
  const variables = historyVariables(
    source,
    { ...values, greeting: `${USER} さん、${LITERAL_USER}、${PASSWORD}` },
    [PASSWORD],
  );
  assert.deepEqual(variables.at(-1), {
    name: 'greeting',
    value: `${REDACTED} さん、${REDACTED}、${REDACTED}`,
  });
});

test(`変数の値は ${VARIABLE_MAX_LENGTH} 文字で切る`, () => {
  const long = 'あ'.repeat(VARIABLE_MAX_LENGTH + 5);
  const [, target] = historyVariables(flow(), { ...values, target: long }, []);
  assert.equal(target.value, `${'あ'.repeat(VARIABLE_MAX_LENGTH)}…`);
});

test('入れ子の内側の入力の手順の参照も、入力欄に入れた変数として扱う', () => {
  const source = flow();
  source.steps.push({
    type: 'if',
    condition: { target: { selectors: ['#x'], tag: 'div', label: 'x' }, exists: true },
    then: [
      {
        type: 'input',
        target: { selectors: ['#q'], tag: 'input', label: '検索' },
        value: '{{orderNumber}} {{ target.year }}',
      },
    ],
  });
  assert.deepEqual([...inputReferenceNames(source.steps)].sort(), [
    'loginId',
    'orderNumber',
    'target',
  ]);
});

test('値を記録していない入力欄（secret）は、フロー定義の写しでも value を持たない', () => {
  const step = redactFlowForReport(flow()).steps[3];
  assert.equal(step.type, 'input');
  assert.equal('value' in step, false);
  assert.equal(/** @type {any} */ (step).secret, true);
});

test('入力欄に入れるパラメータの既定値と、移動の URL のクエリとフラグメントを伏せる', () => {
  const copy = redactFlowForReport(flow());
  assert.equal(copy.params?.[0].default, REDACTED);
  // 入力欄に入れないパラメータの既定値は残します。
  assert.equal(copy.params?.[1].default, '@previous-month');
  assert.equal(
    /** @type {any} */ (copy.steps[0]).url,
    `https://www.example.com/login?${REDACTED}#${REDACTED}`,
  );
  assert.equal(
    /** @type {any} */ (copy.steps[4]).url,
    `https://www.example.com/orders?${REDACTED}`,
  );
});

test('入力の手順の value はすべて伏せ、ほかの文字の中の入力した値も伏せる', () => {
  const copy = /** @type {any} */ (redactFlowForReport(flow()));
  assert.equal(copy.steps[1].value, REDACTED);
  assert.equal(copy.steps[2].value, REDACTED);
  assert.equal(copy.steps[5].steps[1].target.label, `${REDACTED} 様の領収書`);
});

test('伏せた後も、要素の指定と手順の順番・種類は元のフローと同じ', () => {
  const source = flow();
  const copy = /** @type {any} */ (redactFlowForReport(source));
  const original = /** @type {any} */ (source);
  assert.deepEqual(
    copy.steps.map((/** @type {any} */ step) => step.type),
    original.steps.map((/** @type {any} */ step) => step.type),
  );
  assert.deepEqual(copy.steps[1].target, original.steps[1].target);
  assert.deepEqual(copy.steps[5].items, original.steps[5].items);
  assert.deepEqual(copy.steps[5].steps[0], original.steps[5].steps[0]);
});

test('元のフローのオブジェクトは変更しない', () => {
  const source = flow();
  const before = structuredClone(source);
  redactFlowForReport(source);
  assert.deepEqual(source, before);
});

test('フローが削除されている場合は、JSON を付けずにその旨を記す', async () => {
  const entry = await failedEntry(flow());
  const text = `${historyEntryText(entry)}${historyReportText(entry, undefined, undefined)}`;
  assert.match(text, /\nフローの定義：このフローは削除されているため、含めていません。\n$/);
  assert.ok(!text.includes('{'));
});

test('実行の後にフローを変更した場合だけ、その旨を記す', async () => {
  const changedNote = 'このフローは実行の後に変更されています。';
  assert.ok(!(await copiedText(flow())).includes(changedNote));
  const edited = flow();
  edited.name = '領収書（新）';
  assert.ok((await copiedText(flow(), edited)).includes(changedNote));
});

test('指紋は、項目の順序が異なるだけのフローでは同じになる', async () => {
  const { schemaVersion, name, origin, params, steps } = flow();
  const reordered = /** @type {Flow} */ ({ steps, params, origin, name, schemaVersion });
  assert.equal(await flowFingerprint(reordered), await flowFingerprint(flow()));
  assert.match(await flowFingerprint(flow()), /^[0-9a-f]{16}$/);
});

test('指紋のない古い履歴では、変更の有無がわからない旨を記す', () => {
  const text = historyReportText({}, flow(), 'abc');
  assert.match(text, /実行した時点のフローの記録がないため/);
  assert.ok(!text.includes('変数（'));
});

test('成功した実行の履歴には、変数の値と指紋を記録しない', async () => {
  const entry = historyEntryFromRun(
    {
      runId: 'r2',
      flowId: 'f1',
      flowName: '領収書',
      origin: 'https://www.example.com',
      startedAt: '2026-09-25T00:00:00.000Z',
      status: 'done',
      stepIndex: 8,
      total: 8,
    },
    '2026-09-25T00:01:00.000Z',
    [],
    {
      variables: historyVariables(flow(), values, []),
      flowHash: await flowFingerprint(flow()),
    },
  );
  assert.ok(entry);
  assert.equal('variables' in entry, false);
  assert.equal('flowHash' in entry, false);
});
