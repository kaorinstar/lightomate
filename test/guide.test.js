import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PURPOSES,
  currentStage,
  guideAfterRemoval,
  guideAfterStep,
  guideAfterPicked,
  guideBack,
  guideLoop,
  guideNext,
  guideStop,
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

test('目的の名前に、初めて使う人に意味がわからない「今までどおり」を含めない（#263）', () => {
  assert.equal(PURPOSES.find((purpose) => purpose.id === 'free')?.label, '自由に記録する');
  for (const purpose of PURPOSES) {
    assert.doesNotMatch(purpose.label, /今まで/);
  }
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
  for (const purpose of ['pdf', 'form', 'routine']) {
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

test('最後まで進めた記録から、範囲・ファイル名・対象の月・ページ送りを求める（#248）', () => {
  /** @type {Step} */
  const issue = {
    type: 'click',
    target: { selectors: ['#issue'], tag: 'button', label: '発行する' },
    download: { path: 'Lightomate/{{flow}}/{{run.date}}', onConflict: 'rename' },
  };
  /** @type {Step} */
  const detailPage = { type: 'navigate', url: 'https://shop.example.com/detail', cause: 'page' };
  const steps = [
    navigate,
    click('2026/09/25(金)'),
    click('R-001'),
    click('注文詳細', 'a'),
    detailPage,
    issue,
    navigate,
    click('次へ', 'a'),
    navigate,
  ];
  const row = {
    items: { selectors: ['.order'], tag: 'div', label: '' },
    count: 2,
    inner: { selectors: ['.x'], tag: 'span', label: '', scope: /** @type {const} */ ('item') },
  };
  /** @type {import('../extension/shared/record-loop.js').RowHint[]} */
  const hints = [null, [row], [row], [row], null, null, null, null, null];
  const guide = { purpose: /** @type {const} */ ('files'), start: 1, done: [1, 2, 3, 6, 7, 8] };
  const result = guideLoop(guide, steps, hints);
  assert.ok(result.ok);
  assert.deepEqual(result.loop, {
    from: 1,
    to: 5,
    key: JSON.stringify(['.order']),
    names: [1, 2],
    nextPage: 7,
    dateStep: 1,
  });

  // 日付とファイル名と［次へ］を飛ばした場合は、それぞれ使いません。
  const skipped = guideLoop({ ...guide, done: [1, 1, 1, 4, 5, 5] }, steps.slice(0, 5), hints);
  assert.ok(skipped.ok);
  assert.deepEqual(skipped.loop, { from: 1, to: 3, key: JSON.stringify(['.order']), names: [] });

  // 最後の段階まで進んでいない場合と、1 件分が決まっていない場合は、理由を返します。
  assert.equal(guideLoop({ ...guide, done: [1, 2] }, steps, hints).ok, false);
  const noRow = guideLoop(
    guide,
    steps,
    steps.map(() => null),
  );
  assert.equal(noRow.ok, false);
  assert.match(noRow.ok ? '' : noRow.error, /1 件分が決まっていません/);
});

test('購入の案内は、商品のページ・選択・かご・手続きの段階で進み、［ここで止める］で一時停止を 1 つだけ加える（#249）', () => {
  let guide = /** @type {import('../extension/shared/guide.js').GuideState} */ (
    startGuide('purchase', 1)
  );
  assert.deepEqual(guideView(guide).step, { number: 1, total: 5 });
  assert.equal(guideView(guide).button, 'このページから始める');
  guide = guideNext(guide, 1, 'button');
  assert.equal(currentStage(guide)?.id, 'options');
  assert.equal(guideView(guide).skip, 'なし');
  guide = guideNext(guide, 1, 'skip');
  assert.equal(currentStage(guide)?.id, 'cart');
  // ［かごに入れる］のクリックで進みます。
  const steps = [navigate, click('かごに入れる', 'button')];
  guide = guideAfterStep(guide, steps);
  assert.equal(currentStage(guide)?.id, 'checkout');
  assert.equal(guideView(guide).button, 'ここで止める');

  const stopped = guideStop(guide, steps);
  assert.equal(currentStage(stopped.guide)?.id, 'rest');
  assert.deepEqual(stopped.steps.at(-1), {
    type: 'pause',
    note: '注文の確定は人が押してください。',
  });
  assert.equal(stopped.steps.length, 3);
  // 最後の手順がすでに一時停止の場合は、重ねて加えません。
  const twice = guideStop(guide, stopped.steps);
  assert.equal(twice.steps.length, 3);
  assert.equal(guideView(stopped.guide).finish, true);
  // ほかの段階では、何も加えません。
  assert.deepEqual(guideStop(stopped.guide, stopped.steps).steps, stopped.steps);
});

test('購入の案内の途中で確定ボタンが押されると、最後の段階へ進み、注文を確かめるよう知らせる（#249）', () => {
  const guide = guideNext(
    /** @type {import('../extension/shared/guide.js').GuideState} */ (startGuide('purchase', 1)),
    1,
    'button',
  );
  /** @type {Step} */
  const pause = { type: 'pause' };
  const next = guideAfterStep(guide, [navigate, pause]);
  assert.equal(currentStage(next)?.id, 'rest');
  assert.match(next.notice ?? '', /注文が確定していないか/);
});
