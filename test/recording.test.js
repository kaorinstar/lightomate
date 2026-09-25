import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  navigationCause,
  removeRecordedStep,
  resetRecording,
  stopRecording,
  withoutStep,
} from '../extension/background/recording.js';

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

// ---- 記録した手順の削除と破棄（#45） ----

/** @type {import('../extension/shared/flow.js').Step[]} */
const recordedSteps = [
  { type: 'navigate', url: 'https://www.example.com/', cause: 'user' },
  { type: 'click', target: { selectors: ['#a'], tag: 'a', label: '注文履歴' } },
  { type: 'click', target: { selectors: ['#b'], tag: 'button', label: '領収書' } },
];

test('指定した番号の手順だけを除き、元の配列は変更しない', () => {
  const result = withoutStep(recordedSteps, 1, 3);
  assert.deepEqual(result, [recordedSteps[0], recordedSteps[2]]);
  assert.equal(recordedSteps.length, 3);
});

test('件数が一致しない削除の指示は断る', () => {
  assert.equal(withoutStep(recordedSteps, 1, 4), null);
  assert.equal(withoutStep(recordedSteps, 1, 2), null);
});

test('範囲外の番号や、整数でない番号の削除の指示は断る', () => {
  assert.equal(withoutStep(recordedSteps, 3, 3), null);
  assert.equal(withoutStep(recordedSteps, -1, 3), null);
  assert.equal(withoutStep(recordedSteps, 1.5, 3), null);
  assert.equal(withoutStep(recordedSteps, '1', 3), null);
});

/**
 * chrome.storage.session などの代わりです。記録の状態の読み書きだけを確かめるため、
 * ほかの API は何もしません。
 * @param {Record<string, unknown>} initial
 */
function fakeChrome(initial) {
  /** @type {Record<string, unknown>} */
  const session = structuredClone(initial);
  /** @type {Record<string, unknown>} */
  const local = { flows: 'saved' };
  const area = (/** @type {Record<string, unknown>} */ data) => ({
    get: async (/** @type {string | null} */ key) =>
      key === null ? { ...data } : key in data ? { [key]: structuredClone(data[key]) } : {},
    set: async (/** @type {Record<string, unknown>} */ items) => {
      Object.assign(data, structuredClone(items));
    },
    remove: async (/** @type {string | string[]} */ keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },
  });
  /** @type {Record<string, unknown>} */ (globalThis).chrome = {
    storage: { session: area(session), local: area(local) },
    action: { setBadgeText: async () => {} },
    tabs: { sendMessage: async () => {} },
  };
  return { session, local };
}

const recording = {
  tabId: 1,
  origin: 'https://www.example.com',
  startedAt: '2026-09-25T00:00:00.000Z',
  steps: recordedSteps,
};
const lastFlow = {
  schemaVersion: 1,
  name: '記録',
  origin: 'https://www.example.com',
  steps: recordedSteps,
};

test('記録中に手順を削除すると、記録中の手順から消える', async () => {
  const { session } = fakeChrome({ recording });
  assert.deepEqual(await removeRecordedStep(1, 3), { ok: true });
  assert.deepEqual(/** @type {typeof recording} */ (session.recording).steps, [
    recordedSteps[0],
    recordedSteps[2],
  ]);
});

test('記録の停止後に手順を削除すると、保存前のフローから消える', async () => {
  const { session, local } = fakeChrome({ lastFlow });
  assert.deepEqual(await removeRecordedStep(0, 3), { ok: true });
  assert.deepEqual(/** @type {typeof lastFlow} */ (session.lastFlow).steps, [
    recordedSteps[1],
    recordedSteps[2],
  ]);
  assert.deepEqual(local, { flows: 'saved' });
});

test('件数が一致しない削除の指示では、手順を変更しない', async () => {
  const { session } = fakeChrome({ lastFlow });
  const result = await removeRecordedStep(1, 2);
  assert.equal(result.ok, false);
  assert.deepEqual(/** @type {typeof lastFlow} */ (session.lastFlow).steps, recordedSteps);
});

test('記録の停止後にすべての手順を削除すると、記録を破棄した状態になる', async () => {
  const { session } = fakeChrome({ lastFlow: { ...lastFlow, steps: [recordedSteps[0]] } });
  assert.deepEqual(await removeRecordedStep(0, 1), { ok: true });
  assert.equal('lastFlow' in session, false);
});

test('記録中にすべての手順を削除して停止すると、フローを作らずに破棄する', async () => {
  const { session } = fakeChrome({ recording: { ...recording, steps: [recordedSteps[0]] } });
  await removeRecordedStep(0, 1);
  assert.deepEqual(await stopRecording(), { ok: true, flow: null, errors: [] });
  assert.deepEqual(session, {});
});

test('記録の停止後に破棄すると、保存前のフローを消し、保存済みのフローは残す', async () => {
  const { session, local } = fakeChrome({ lastFlow });
  assert.deepEqual(await resetRecording(), { ok: true });
  assert.deepEqual(session, {});
  assert.deepEqual(local, { flows: 'saved' });
});

test('記録中に破棄すると、記録を停止して手順を捨てる', async () => {
  const { session } = fakeChrome({ recording });
  assert.deepEqual(await resetRecording(), { ok: true });
  assert.deepEqual(session, {});
});

test('破棄する記録がない場合は断る', async () => {
  fakeChrome({});
  const result = await resetRecording();
  assert.equal(result.ok, false);
});
