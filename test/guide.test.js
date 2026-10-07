import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PURPOSES,
  currentStage,
  guideAfterRemoval,
  guideAfterStep,
  guideAfterPicked,
  guideBack,
  guideNext,
  guideView,
  startGuide,
} from '../extension/shared/guide.js';

/** @typedef {import('../extension/shared/flow.js').Step} Step */

/** @type {Step} */
const navigate = { type: 'navigate', url: 'https://shop.example.com/orders', cause: 'user' };
/**
 * @param {string} text
 * @param {string} [tag]
 * @returns {Step}
 */
const click = (text, tag = 'span') => ({
  type: 'click',
  target: { selectors: ['.x'], tag, label: text, text },
});

test('6 種類の目的のうち、ファイルは段階で、自由に記録するは案内なし、ほかは 1 文で案内する（#246）', () => {
  assert.deepEqual(
    PURPOSES.map((purpose) => purpose.id),
    ['free', 'files', 'pdf', 'purchase', 'form', 'routine'],
  );
  assert.equal(startGuide('free', 1), undefined);
  assert.equal(startGuide('unknown', 1), undefined);
  const files = startGuide('files', 1);
  assert.ok(files);
  assert.equal(currentStage(files)?.id, 'list');
  assert.deepEqual(guideView(files).step, { number: 1, total: 7 });
  for (const purpose of ['pdf', 'purchase', 'form', 'routine']) {
    const guide = startGuide(purpose, 1);
    assert.ok(guide);
    const view = guideView(guide);
    assert.notEqual(view.text, '');
    assert.equal(view.step, undefined);
    assert.equal(view.canBack, false);
  }
});

test('［このページから始める］で日付の段階へ進み、日付として読める文字を押すと次へ進む（#246）', () => {
  let guide = /** @type {import('../extension/shared/guide.js').GuideState} */ (
    startGuide('files', 1)
  );
  // 一覧の段階は、文字を押しても進みません。
  guide = guideAfterStep(guide, [navigate, click('2026/09/25(金)')]);
  assert.equal(currentStage(guide)?.id, 'list');
  guide = guideNext(guide, 2, 'button');
  assert.equal(currentStage(guide)?.id, 'date');
  assert.equal(guideView(guide).skip, '飛ばす');

  // 日付ではない文字は、理由を返して進みません。
  const steps = [navigate, click('2026/09/25(金)'), click('注文番号 203694')];
  guide = guideAfterStep(guide, steps);
  assert.equal(currentStage(guide)?.id, 'date');
  assert.match(guide.notice ?? '', /「注文番号 203694」は、日付として読めません/);
  // ボタンやリンクの文字は、日付が含まれていても日付の手順にしません。
  guide = guideAfterStep(guide, [...steps, click('2026/09/25 の注文詳細', 'a')]);
  assert.equal(currentStage(guide)?.id, 'date');

  guide = guideAfterStep(guide, [...steps, click('2026年9月25日')]);
  assert.equal(currentStage(guide)?.id, 'name');
  assert.equal(guide.notice, undefined);
  assert.deepEqual(guide.done, [2, 4]);
});

test('［飛ばす］は飛ばせる段階だけで進み、ボタンの段階では使えない（#246）', () => {
  const guide = /** @type {import('../extension/shared/guide.js').GuideState} */ (
    startGuide('files', 1)
  );
  assert.deepEqual(guideNext(guide, 1, 'skip'), guide);
  const date = guideNext(guide, 1, 'button');
  assert.deepEqual(guideNext(date, 1, 'button'), date);
  assert.equal(currentStage(guideNext(date, 3, 'skip'))?.id, 'name');
});

test('［ひとつ戻る］で前の段階に戻り、前の段階の始まりまでの手順を残す（#246）', () => {
  const start = /** @type {import('../extension/shared/guide.js').GuideState} */ (
    startGuide('files', 1)
  );
  assert.equal(guideBack(start), undefined);
  const date = guideNext(start, 2, 'button');
  const rest = guideAfterStep(date, [navigate, click('x'), click('2026/9/25')]);
  const back = guideBack(rest);
  assert.ok(back);
  assert.equal(currentStage(back.guide)?.id, 'date');
  // 日付の段階は手順 2 から始まったため、2 件を残し、押した日付の手順を消します。
  assert.equal(back.keep, 2);
  const first = guideBack(back.guide);
  assert.ok(first);
  assert.equal(currentStage(first.guide)?.id, 'list');
  assert.equal(first.keep, 1);
});

test('手順を削除すると、削除した手順を使って終えた段階に戻る（#246）', () => {
  const guide = { purpose: /** @type {const} */ ('files'), start: 1, done: [2, 4] };
  assert.deepEqual(guideAfterRemoval(guide, 3).done, [2]);
  assert.deepEqual(guideAfterRemoval(guide, 5).done, [2, 4]);
  assert.deepEqual(guideAfterRemoval(guide, 0), { purpose: 'files', start: 0, done: [] });
});

/**
 * 「ファイルをまとめて保存する」の、指定した段階まで進めた状態です。
 * @param {string} id
 */
function filesAt(id) {
  const order = ['list', 'date', 'name', 'save', 'second', 'next', 'rest'];
  const guide = /** @type {import('../extension/shared/guide.js').GuideState} */ (
    startGuide('files', 1)
  );
  return { ...guide, done: order.slice(0, order.indexOf(id)).map((_, index) => index + 1) };
}

test('ファイル名の段階は、文字を押すと進み、リンクやボタンを押すと理由を返し、［なし］で飛ばせる（#247）', () => {
  const guide = filesAt('name');
  assert.equal(guideView(guide).skip, 'なし');
  const steps = [navigate, click('R-001')];
  assert.equal(currentStage(guideAfterStep(guide, steps))?.id, 'save');
  const link = guideAfterStep(guide, [navigate, click('注文詳細', 'a')]);
  assert.equal(currentStage(link)?.id, 'name');
  assert.match(link.notice ?? '', /リンクかボタンのため、ファイル名にできません/);
  // 押した直後のページの移動では、知らせを消しません。
  const moved = guideAfterStep(link, [navigate, click('注文詳細', 'a'), navigate]);
  assert.equal(moved.notice, link.notice);
  assert.equal(currentStage(guideNext(guide, 2, 'skip'))?.id, 'save');
});

test('保存の段階は、段階の中にダウンロードの保存か PDF の保存があると進む（#247）', () => {
  const guide = { ...filesAt('save'), done: [1, 2, 3] };
  /** @type {Step} */
  const issue = {
    type: 'click',
    target: { selectors: ['#issue'], tag: 'button', label: '発行する' },
    download: { path: 'Lightomate/{{flow}}/{{run.date}}', onConflict: 'rename' },
  };
  const before = [navigate, click('a'), click('b'), click('注文詳細', 'a')];
  assert.equal(currentStage(guideAfterStep(guide, [...before, navigate]))?.id, 'save');
  // クリックの手順が、後からダウンロードの保存に変わった場合も進みます。
  const after = guideAfterStep(guide, [...before, navigate, issue]);
  assert.equal(currentStage(after)?.id, 'second');
  assert.equal(after.done.at(-1), 6);
  /** @type {Step} */
  const pdf = { type: 'savePdf' };
  assert.equal(currentStage(guideAfterStep(guide, [...before, pdf]))?.id, 'second');
});

test('2 件目の段階は、ボタンで待ち始め、押されて 1 件分が決まると進む（#247）', () => {
  const guide = filesAt('second');
  const view = guideView(guide);
  assert.equal(view.button, '一覧のページに戻りました');
  const waiting = guideView(guide, true);
  assert.equal(waiting.button, undefined);
  assert.match(waiting.text, /2 件目の/);
  assert.equal(waiting.canBack, true);
  // ボタンだけでは進みません。
  assert.deepEqual(guideNext(guide, 6, 'button'), guide);
  assert.equal(currentStage(guideAfterPicked(guide, 6))?.id, 'next');
  // ほかの段階では、押されても進みません。
  assert.deepEqual(guideAfterPicked(filesAt('save'), 6), filesAt('save'));
});

test('次へ の段階は、ページ送りに使えるクリックで進み、使えないクリックは理由を返す（#247）', () => {
  const guide = filesAt('next');
  assert.equal(guideView(guide).skip, '次のページはない');
  const steps = [navigate, click('次へ', 'a')];
  assert.equal(
    currentStage(guideAfterStep(guide, steps, [null, { selectors: ['a.next'] }]))?.id,
    'rest',
  );
  const wrong = guideAfterStep(guide, steps, [null, null]);
  assert.equal(currentStage(wrong)?.id, 'next');
  assert.match(wrong.notice ?? '', /次のページへ進めません/);
  assert.equal(currentStage(guideNext(guide, 2, 'skip'))?.id, 'rest');
  // 最後の段階からは進みません。
  const rest = filesAt('rest');
  assert.deepEqual(guideNext(rest, 9, 'skip'), rest);
  assert.deepEqual(guideView(rest).step, { number: 7, total: 7 });
});
