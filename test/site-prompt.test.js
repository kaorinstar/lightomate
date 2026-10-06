import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SITE_PROMPT_TOP_OFFSET,
  SITE_PROMPT_WIDTH,
  shouldOpenSitePrompt,
  sitePromptPosition,
} from '../extension/shared/site-prompt.js';

// ---- 許可を求める窓を開くかの判定（#209） ----

const base = {
  origin: 'https://pay.example.net',
  allowed: false,
  recordingOrigin: 'https://www.example.com',
  extraOrigins: [],
  prompted: [],
  maxExtraOrigins: 10,
};

test('許可がないサイトでは、窓を開く', () => {
  assert.equal(shouldOpenSitePrompt(base), true);
});

test('許可があるサイトと、記録を始めたサイトでは、窓を開かない', () => {
  assert.equal(shouldOpenSitePrompt({ ...base, allowed: true }), false);
  assert.equal(shouldOpenSitePrompt({ ...base, origin: base.recordingOrigin }), false);
});

test('同じ記録の間に一度窓を開いたサイトでは、開き直さない', () => {
  assert.equal(shouldOpenSitePrompt({ ...base, prompted: [base.origin] }), false);
  assert.equal(shouldOpenSitePrompt({ ...base, prompted: ['https://other.example.org'] }), true);
});

test('記録できるサイトの上限に達している場合は、窓を開かない', () => {
  const full = ['https://a.example', 'https://b.example'];
  assert.equal(shouldOpenSitePrompt({ ...base, extraOrigins: full, maxExtraOrigins: 2 }), false);
  // すでに手順を記録したサイトは、上限の件数に含まれているため、開きます。
  assert.equal(
    shouldOpenSitePrompt({
      ...base,
      extraOrigins: [...full, base.origin],
      maxExtraOrigins: 3,
    }),
    true,
  );
});

// ---- 許可を求める窓の位置（#209） ----

test('窓は、ブラウザの窓の上部中央に置く', () => {
  const position = sitePromptPosition({ left: 100, top: 50, width: 1460 });
  assert.deepEqual(position, {
    left: 100 + (1460 - SITE_PROMPT_WIDTH) / 2,
    top: 50 + SITE_PROMPT_TOP_OFFSET,
  });
});

test('ブラウザの窓が狭い場合は、左端をそろえ、画面の外に出さない', () => {
  assert.deepEqual(sitePromptPosition({ left: 20, top: 0, width: 300 }), {
    left: 20,
    top: SITE_PROMPT_TOP_OFFSET,
  });
});

test('ブラウザの窓の位置がわからない場合は、画面の左上を基準にする', () => {
  assert.deepEqual(sitePromptPosition({}), { left: 0, top: SITE_PROMPT_TOP_OFFSET });
});
