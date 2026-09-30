// ブロックの編集画面（#9）の、手順とブロックの変換を確かめます。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BLOCK_COLOURS,
  blockDefinitions,
  conditionUsesValues,
  stepsToWorkspace,
  toolbox,
  workspaceToSteps,
} from '../extension/shared/blocks.js';
import { validateFlow } from '../extension/shared/flow.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */

const receipt = JSON.parse(
  readFileSync(new URL('../docs/examples/receipt-flow.json', import.meta.url), 'utf8'),
);

/** @param {string} label */
const target = (label) => ({ selectors: [`#${label}`], tag: 'button', label });

/** すべての手順の種類と、if・forEach・while の入れ子を含む手順です。 */
/** @type {Step[]} */
const allKinds = [
  { type: 'navigate', cause: 'user', url: 'https://shop.example.com/' },
  { type: 'click', target: target('ログイン'), newTab: true, download: { path: 'a/{{name}}' } },
  { type: 'input', target: target('メール'), value: '{{mail}}' },
  { type: 'input', target: target('パスワード'), secret: true },
  { type: 'select', target: target('サイズ'), values: ['m'], labels: ['M'] },
  { type: 'extract', target: target('番号'), name: 'no' },
  { type: 'savePdf', path: 'x/{{no}}.pdf', onConflict: 'overwrite', mode: 'screen' },
  { type: 'savePdf' },
  { type: 'wait', ms: 1500 },
  { type: 'pause', note: '確認してください' },
  { type: 'pause' },
  { type: 'closeTab' },
  {
    type: 'if',
    condition: { target: target('在庫'), exists: false },
    then: [{ type: 'wait', ms: 1 }],
    else: [],
  },
  {
    type: 'if',
    condition: { target: target('日付'), from: '2026-09-01' },
    then: [],
  },
  {
    type: 'while',
    condition: { target: target('次'), contains: '次へ' },
    max: 20,
    steps: [{ type: 'click', target: target('次') }],
  },
  {
    type: 'forEach',
    items: target('行'),
    steps: [
      {
        type: 'if',
        condition: { target: { ...target('状態'), scope: 'item' }, equals: '発送済み' },
        then: [{ type: 'click', target: { ...target('領収書'), scope: 'item' } }],
        else: [{ type: 'pause' }],
      },
    ],
  },
];

/**
 * 配置の保存形式の、最初のブロックから next をたどった i 番目のブロックです。
 * @param {import('../extension/shared/blocks.js').WorkspaceState} state
 * @param {number} index
 */
function nth(state, index) {
  let block = state.blocks?.blocks?.[0];
  for (let i = 0; i < index; i += 1) {
    block = block?.next?.block;
  }
  assert.ok(block);
  return block;
}

test('手順をブロックにしてから戻すと、元の手順と一致する（すべての種類と入れ子）', () => {
  assert.deepEqual(workspaceToSteps(stepsToWorkspace(allKinds)), { steps: allKinds });
});

test('領収書のフローの例（docs/examples/receipt-flow.json）も、往復で変わらない', () => {
  assert.deepEqual(workspaceToSteps(stepsToWorkspace(receipt.steps)), { steps: receipt.steps });
});

test('手順が空のフローは、ブロックのない配置になり、戻すと空の手順になる', () => {
  const state = stepsToWorkspace([]);
  assert.deepEqual(state.blocks?.blocks, []);
  assert.deepEqual(workspaceToSteps(state), { steps: [] });
});

test('欄の値を変えると、その項目だけが変わり、要素の指定などは残る', () => {
  const state = stepsToWorkspace(allKinds);
  Object.assign(nth(state, 0).fields ?? {}, { URL: 'https://shop.example.com/orders' });
  Object.assign(nth(state, 1).fields ?? {}, { NEW_TAB: false, DOWNLOAD: '' });
  Object.assign(nth(state, 2).fields ?? {}, { VALUE: 'taro@example.com' });
  Object.assign(nth(state, 6).fields ?? {}, { PATH: '' });
  Object.assign(nth(state, 8).fields ?? {}, { SECONDS: 2.5 });
  Object.assign(nth(state, 9).fields ?? {}, { NOTE: '' });
  Object.assign(nth(state, 12).fields ?? {}, { COND: 'contains', VALUE: '在庫あり' });
  Object.assign(nth(state, 14).fields ?? {}, { MAX: 5 });
  const { steps } = workspaceToSteps(state);
  assert.deepEqual(steps[0], {
    type: 'navigate',
    cause: 'user',
    url: 'https://shop.example.com/orders',
  });
  assert.deepEqual(steps[1], { type: 'click', target: target('ログイン') });
  assert.deepEqual(steps[2], {
    type: 'input',
    target: target('メール'),
    value: 'taro@example.com',
  });
  assert.deepEqual(steps[6], { type: 'savePdf', onConflict: 'overwrite', mode: 'screen' });
  assert.deepEqual(steps[8], { type: 'wait', ms: 2500 });
  assert.deepEqual(steps[9], { type: 'pause' });
  assert.deepEqual(steps[12], {
    type: 'if',
    condition: { target: target('在庫'), contains: '在庫あり' },
    then: [{ type: 'wait', ms: 1 }],
    else: [],
  });
  assert.equal(/** @type {any} */ (steps[14]).max, 5);
});

test('既定値のまま省略していた上限は、欄が既定値のままなら省略したままにする', () => {
  const [step] = workspaceToSteps(
    stepsToWorkspace([{ type: 'forEach', items: target('行'), steps: [] }]),
  ).steps;
  assert.equal('max' in step, false);
});

test('ブロックの並べ替えと、繰り返しの中からの出し入れが、手順の並びに反映される', () => {
  /** @type {Step[]} */
  const steps = [
    { type: 'wait', ms: 1000 },
    { type: 'forEach', items: target('行'), steps: [{ type: 'savePdf' }, { type: 'pause' }] },
  ];
  const state = stepsToWorkspace(steps);
  const first = nth(state, 0);
  const loop = nth(state, 1);
  // 繰り返しの中の最初のブロック（savePdf）を取り出し、繰り返しの前に置き、待機を最後に回します。
  const inner = loop.inputs?.STEPS?.block;
  assert.ok(inner && loop.inputs);
  loop.inputs.STEPS = { block: inner.next?.block };
  delete inner.next;
  delete first.next;
  delete loop.next;
  inner.next = { block: loop };
  loop.next = { block: first };
  const reordered = { blocks: { languageVersion: 0, blocks: [inner] } };
  assert.deepEqual(workspaceToSteps(reordered).steps, [
    { type: 'savePdf' },
    { type: 'forEach', items: target('行'), steps: [{ type: 'pause' }] },
    { type: 'wait', ms: 1000 },
  ]);
});

test('つながっていないブロックがある場合は、手順を作らずに誤りを返す', () => {
  const state = stepsToWorkspace([{ type: 'wait', ms: 1000 }]);
  state.blocks?.blocks?.push({ type: 'lm_pause', extraState: { step: { type: 'pause' } } });
  const result = workspaceToSteps(state);
  assert.deepEqual(result.steps, []);
  assert.match(result.error ?? '', /つながっていないブロック/);
});

test('ブロックの一覧から出した直後のブロック（元の手順がない）からも手順を作れる', () => {
  const { steps } = workspaceToSteps({
    blocks: {
      blocks: [
        { type: 'lm_wait', fields: { SECONDS: 3 }, next: { block: { type: 'lm_closeTab' } } },
      ],
    },
  });
  assert.deepEqual(steps, [{ type: 'wait', ms: 3000 }, { type: 'closeTab' }]);
});

test('ブロックの一覧には、要素を必要としない手順だけを出し、どれも形式の検証を通る', () => {
  const contents = toolbox().contents;
  const steps = contents.map(
    (entry) => workspaceToSteps({ blocks: { blocks: [/** @type {any} */ (entry)] } }).steps[0],
  );
  assert.deepEqual(
    steps.map((step) => step.type),
    ['navigate', 'wait', 'pause', 'savePdf', 'closeTab'],
  );
  const flow = {
    schemaVersion: 12,
    name: 'テスト',
    origin: 'https://shop.example.com',
    steps: steps.map((step) =>
      step.type === 'navigate' ? { ...step, url: 'https://shop.example.com/' } : step,
    ),
  };
  assert.deepEqual(validateFlow(flow), []);
});

test('ブロックの定義は、手順の種類ごとに 1 つ以上あり、名前が重ならない', () => {
  const types = blockDefinitions().map((definition) => /** @type {any} */ (definition).type);
  assert.equal(new Set(types).size, types.length);
  for (const step of allKinds) {
    assert.ok(types.includes(`lm_${step.type}`), step.type);
  }
});

test('条件の種類ごとに、値の欄を使うかが決まる', () => {
  assert.deepEqual(conditionUsesValues('exists'), { value: false, value2: false });
  assert.deepEqual(conditionUsesValues('contains'), { value: true, value2: false });
  assert.deepEqual(conditionUsesValues('range'), { value: true, value2: true });
});

test('ブロックの色は、どれも白い文字に対して 4.5:1 以上の濃さである', () => {
  /** @param {string} hex */
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((index) => {
      const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (const [name, colour] of Object.entries(BLOCK_COLOURS)) {
    const ratio = 1.05 / (luminance(colour) + 0.05);
    assert.ok(ratio >= 4.5, `${name}（${colour}）の比は ${ratio.toFixed(2)} です。`);
  }
});

test('「秒待つ」と実行速度の関係の説明は、［実行速度］タブだけに置く（#142）', () => {
  const html = readFileSync(new URL('../extension/options/options.html', import.meta.url), 'utf8');
  const steps = html.slice(
    html.indexOf('id="detail-panel-steps"'),
    html.indexOf('id="detail-panel-speed"'),
  );
  const speed = html.slice(
    html.indexOf('id="detail-panel-speed"'),
    html.indexOf('id="detail-panel-schedule"'),
  );
  assert.match(speed, /「秒待つ」ブロックを使います。その場所では、この間隔に加えて待ちます。/);
  assert.doesNotMatch(steps, /加えて待ちます/);
  const wait = blockDefinitions().find(
    (definition) => /** @type {any} */ (definition).type === 'lm_wait',
  );
  assert.equal(/** @type {any} */ (wait).tooltip, undefined);
});
