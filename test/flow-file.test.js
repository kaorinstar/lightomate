// フローのファイルの書き出しと読み込み（extension/shared/flow-file.js、#27）のテストです。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION } from '../extension/shared/flow.js';
import {
  MAX_IMPORT_FLOWS,
  flowFileName,
  flowFileText,
  namesForImport,
  parseFlowFile,
} from '../extension/shared/flow-file.js';

/**
 * @param {string} name
 * @param {string} [origin]
 * @returns {import('../extension/shared/flow.js').Flow}
 */
function flow(name, origin = 'https://www.example.com') {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    origin,
    steps: [{ type: 'navigate', url: `${origin}/`, cause: 'user' }],
  };
}

/**
 * @param {import('../extension/shared/flow.js').Flow} value
 * @returns {import('../extension/common/flow-store.js').StoredFlow}
 */
function stored(value) {
  return { id: value.name, createdAt: '', updatedAt: '', flow: value };
}

test('フロー 1 件のファイルを読み込む', () => {
  assert.deepEqual(parseFlowFile(flow('a')), { ok: true, flows: [flow('a')], multiple: false });
});

test('フローの配列のファイルを読み込む', () => {
  assert.deepEqual(parseFlowFile([flow('a'), flow('b')]), {
    ok: true,
    flows: [flow('a'), flow('b')],
    multiple: true,
  });
});

test('空の配列と、上限を超える配列は読み込まない', () => {
  assert.equal(parseFlowFile([]).ok, false);
  const many = Array.from({ length: MAX_IMPORT_FLOWS + 1 }, (_, index) => flow(String(index)));
  const result = parseFlowFile(many);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.errors[0] : '', /100 件まで/);
  assert.equal(parseFlowFile(many.slice(0, MAX_IMPORT_FLOWS)).ok, true);
});

test('配列の中に誤りがある場合は、何件目かを示し、1 件も読み込まない', () => {
  const result = parseFlowFile([flow('a'), { ...flow('b'), origin: 'ftp://x' }, 1]);
  assert.equal(result.ok, false);
  const errors = !result.ok ? result.errors : [];
  assert.ok(errors.some((error) => error.startsWith('2 件目：')));
  assert.ok(errors.some((error) => error.startsWith('3 件目：')));
  assert.ok(!errors.some((error) => error.startsWith('1 件目：')));
});

test('配列でもオブジェクトでもない値は読み込まない', () => {
  for (const value of [null, 'flow', 1]) {
    assert.equal(parseFlowFile(value).ok, false, `値: ${JSON.stringify(value)}`);
  }
});

test('既存のフローと、ファイルの中どうしの同じ名前に番号を付ける', () => {
  const existing = [stored(flow('領収書')), stored(flow('領収書', 'https://other.example.com'))];
  assert.deepEqual(
    namesForImport([flow('領収書'), flow('領収書'), flow('注文'), flow('注文')], existing),
    ['領収書 (2)', '領収書 (3)', '注文', '注文 (2)'],
  );
});

test('別のサイトの同じ名前には、番号を付けない', () => {
  assert.deepEqual(
    namesForImport([flow('領収書', 'https://a.example.com')], [stored(flow('領収書'))]),
    ['領収書'],
  );
});

test('ファイルの名前に、フロー名または件数と、日付を入れる', () => {
  const now = new Date(2026, 8, 6, 10, 0, 0);
  assert.equal(
    flowFileName([flow('月次/領収書: 3*')], now),
    'lightomate-月次_領収書_ 3_-2026-09-06.json',
  );
  assert.equal(
    flowFileName([flow('a'), flow('b'), flow('c')], now),
    'lightomate-flows-3件-2026-09-06.json',
  );
});

test('1 件はオブジェクト、複数件は配列として書き出し、読み込むと元に戻る', () => {
  const one = JSON.parse(flowFileText([flow('a')]));
  assert.equal(Array.isArray(one), false);
  assert.deepEqual(one, flow('a'));
  assert.deepEqual(Object.keys(one), ['schemaVersion', 'name', 'origin', 'steps']);

  const text = flowFileText([flow('a'), flow('b')]);
  assert.deepEqual(parseFlowFile(JSON.parse(text)), {
    ok: true,
    flows: [flow('a'), flow('b')],
    multiple: true,
  });
});
