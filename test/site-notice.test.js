import { test } from 'node:test';
import assert from 'node:assert/strict';

import { siteNotice, siteNoticeText } from '../extension/shared/site-notice.js';

// ---- 記録中に許可がないサイトへ移動したときの知らせ（#209） ----

const base = {
  recordingOrigin: 'https://www.example.com',
  page: { origin: 'https://www.amazon.co.jp', allowed: false },
  extraOrigins: [],
  declined: [],
  maxExtraOrigins: 10,
};

test('許可がないサイトでは、説明とボタンの知らせを出し、サイト名は https:// を除いたホスト名にする', () => {
  assert.deepEqual(siteNotice(base), {
    origin: 'https://www.amazon.co.jp',
    host: 'www.amazon.co.jp',
    mode: 'full',
    limitReached: false,
  });
});

test('許可があるサイト、記録を始めたサイト、Web ページ以外では、知らせを出さない', () => {
  assert.equal(siteNotice({ ...base, page: { ...base.page, allowed: true } }), null);
  assert.equal(
    siteNotice({ ...base, page: { origin: base.recordingOrigin, allowed: false } }),
    null,
  );
  assert.equal(siteNotice({ ...base, page: undefined }), null);
});

test('記録しないと選んだサイトでは、1 行に畳む', () => {
  assert.equal(siteNotice({ ...base, declined: [base.page.origin] })?.mode, 'collapsed');
  assert.equal(siteNotice({ ...base, declined: ['https://other.example'] })?.mode, 'full');
});

test('記録できるサイトの上限に達している場合は、そのことを示す。手順を記録済みのサイトは上限に含める', () => {
  const full = ['https://a.example', 'https://b.example'];
  assert.equal(siteNotice({ ...base, extraOrigins: full, maxExtraOrigins: 2 })?.limitReached, true);
  assert.equal(
    siteNotice({ ...base, extraOrigins: [...full, base.page.origin], maxExtraOrigins: 3 })
      ?.limitReached,
    false,
  );
});

test('知らせの文言は、何が起きたか、なぜか、どうすればよいかの順に書く', () => {
  const notice = /** @type {NonNullable<ReturnType<typeof siteNotice>>} */ (siteNotice(base));
  const text = siteNoticeText(notice, 10);
  assert.equal(text.title, 'www.amazon.co.jp では記録が止まっています');
  assert.match(
    text.body,
    /^このサイトはまだ操作の許可をしていないため、ここでの操作は手順に入りません。/,
  );
  assert.match(text.body, /Chrome の確認で「許可」を選んでください。$/);
  assert.equal(text.collapsed, 'www.amazon.co.jp は記録していません');
});

test('上限に達している場合の文言は、許可を求めず、上限の件数と戻り方を示す', () => {
  const notice = /** @type {NonNullable<ReturnType<typeof siteNotice>>} */ (
    siteNotice({ ...base, extraOrigins: ['https://a.example'], maxExtraOrigins: 1 })
  );
  const { body } = siteNoticeText(notice, 1);
  assert.match(body, /ほかに 1 件までのため/);
  assert.doesNotMatch(body, /許可/);
});
