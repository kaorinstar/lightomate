// 案内付きの記録（#245）の、目的と段階の定義と判定です。chrome.* を使いません。
// 記録中の状態（background/recording.js の Recording）に GuideState を保存し、手順を記録するたびに
// guideAfterStep で次の段階へ進むかを決めます。サイドパネルは guideView の内容を表示します。

import { parseDate } from './condition.js';
import { ACTION_TAGS, candidateKey } from './record-loop.js';

/** @typedef {import('./flow.js').Step} Step */

/**
 * 記録の目的です（#246）。
 * @typedef {'files' | 'pdf' | 'purchase' | 'form' | 'routine' | 'free'} Purpose
 */

/**
 * 目的の一覧です。選ぶ欄に、この順で並べます。既定は「自由に記録する」です。
 * @type {{ id: Purpose, label: string }[]}
 */
export const PURPOSES = [
  { id: 'free', label: '自由に記録する' },
  { id: 'files', label: 'ファイルをまとめて保存する（領収書・請求書など）' },
  { id: 'pdf', label: 'ページを PDF で保存する' },
  { id: 'purchase', label: '商品を購入する（確定の手前で止める）' },
  { id: 'form', label: '入力欄に記入して送信する（申請・問い合わせなど）' },
  { id: 'routine', label: '決まった手順をくり返す（ポイントの受け取りなど）' },
];

/**
 * 段階の進み方です。
 * - button：利用者がサイドパネルのボタン（label）を押すと進みます。
 * - date：日付として読める文字のクリックを記録すると進みます。
 * - text：リンクやボタンではない文字のクリックを記録すると進みます（ファイル名にする文字、#247）。
 * - save：段階の中で、ファイルを保存する手順（ダウンロードか PDF の保存）を記録すると進みます（#247）。
 * - picked：ボタン（label）を押すと、ページで 2 件目の同じものを押すのを待ち、押されて 1 件分が決まると
 *   進みます（#241、#247）。
 * - pager：次のページへ送るのに使えるクリック（#182 の PagerHint を作れたもの）を記録すると進みます（#247）。
 * - click：クリックを記録すると進みます（［かごに入れる］など、#249）。
 * - stop：ボタン（label）を押すと、手順の最後に一時停止を加えて進みます（購入の確定の手前で止める、#249）。
 * - end：最後の段階です。これより先には進みません。
 * @typedef {object} GuideStage
 * @property {string} id
 * @property {string} text 案内の 1 文
 * @property {'button' | 'date' | 'text' | 'save' | 'picked' | 'pager' | 'click' | 'stop' | 'end'} advance
 * @property {string} [label] advance が button か picked の場合の、ボタンの文言。end の場合は、完成のボタンの文言です（#248）
 * @property {string} [waiting] advance が picked で、ページで押すのを待っている間の案内の文
 * @property {boolean} [skippable] 次の段階へ、［飛ばす］で進めるか
 * @property {string} [skipLabel] 飛ばすボタンの文言。省略した場合は「飛ばす」です
 */

/** 段階ごとに案内する目的の、段階の並びです。 */
/** @type {Partial<Record<Purpose, GuideStage[]>>} */
const STAGES = {
  files: [
    {
      id: 'list',
      text: 'ファイルの一覧のページ（購入履歴など）を開き、［このページから始める］を押してください。',
      advance: 'button',
      label: 'このページから始める',
    },
    {
      id: 'date',
      text: '一覧の 1 件目の日付（注文日など）の文字を押してください。対象の月を選ぶときに使います。日付がない一覧では［飛ばす］を押してください。',
      advance: 'date',
      skippable: true,
    },
    {
      id: 'name',
      text: 'ファイル名にしたい文字（注文番号など）があれば、一覧の 1 件目のその文字を押してください。ない場合は［なし］を押してください。',
      advance: 'text',
      skippable: true,
      skipLabel: 'なし',
    },
    {
      id: 'save',
      text: '1 件目のファイルを保存するまで操作してください（［注文詳細］→［発行する］など）。保存が始まると、次へ進みます。',
      advance: 'save',
    },
    {
      id: 'second',
      text: '一覧のページへ戻り、［一覧のページに戻りました］を押してください。',
      advance: 'picked',
      label: '一覧のページに戻りました',
      waiting:
        '一覧の 2 件目の、1 件目で押したものと同じもの（注文番号など。なければ日付）を押してください。押してもページは移動しません。',
    },
    {
      id: 'next',
      text: '一覧に次のページがあれば、［次へ］を押してください。次のページがない場合は［次のページはない］を押してください。',
      advance: 'pager',
      skippable: true,
      skipLabel: '次のページはない',
    },
    {
      id: 'rest',
      text: '記録ができました。［繰り返しを作って保存へ進む］を押すと、2 件目以降の注文と次のページにも同じ操作をするよう設定し、記録を停止します。',
      advance: 'end',
      label: '繰り返しを作って保存へ進む',
    },
  ],
};

STAGES.purchase = [
  {
    id: 'product',
    text: '買いたい商品のページを開き、［このページから始める］を押してください。',
    advance: 'button',
    label: 'このページから始める',
  },
  {
    id: 'options',
    text: '色や数量などを選ぶ場合は、選んでから［選び終えました］を押してください。選ぶものがない場合は［なし］を押してください。',
    advance: 'button',
    label: '選び終えました',
    skippable: true,
    skipLabel: 'なし',
  },
  {
    id: 'cart',
    text: '［かごに入れる］を押してください。',
    advance: 'click',
  },
  {
    id: 'checkout',
    text: '買い物かごを開き、購入の手続きを進めてください。注文を確定するボタンが見えたら、そのボタンは押さずに、［ここで止める］を押してください。',
    advance: 'stop',
    label: 'ここで止める',
  },
  {
    id: 'rest',
    text: '完成しました。実行すると、注文を確定するボタンの手前で止まります。確定は人が押してください。［記録を停止して保存へ進む］を押してください。',
    advance: 'end',
    label: '記録を停止して保存へ進む',
  },
];

/** 購入の確定の手前で止める一時停止の、止まる理由です（#249）。 */
export const PURCHASE_STOP_NOTE = '注文の確定は人が押してください。';

/** 1 文の案内だけを出す目的の、案内の文です。 */
/** @type {Partial<Record<Purpose, string>>} */
const HINTS = {
  pdf: '保存したいページを開くまでの操作を記録してください。PDF の保存の手順は、記録の後に管理画面の編集画面で「PDF を保存」を加えます。',
  form: '入力する欄に記入し、送信のボタンを押してください。毎回変わる値は、後で実行するときに入力する項目にできます。',
  routine: 'いつも行う操作を、最初から最後まで 1 回行ってください。',
};

/**
 * 記録中の案内の状態です。記録中の状態（Recording の guide）に保存します。
 * @typedef {object} GuideState
 * @property {Purpose} purpose
 * @property {number} start 目的を選んだ時点の手順の数です。最初の段階は、この番号の手順から始まります
 * @property {number[]} done 終えた段階ごとの、終えた時点の手順の数です。done の長さが今の段階の番号です
 * @property {string} [notice] 押したものが合わないときの知らせです。次の手順を記録すると消えます
 * @property {number[]} [mistakes] 今の段階で、押したものが合わないと知らせたクリックの手順の番号です（#276）。
 *   正しいものを押して段階を終えたときに、これらの手順を削除します（guideDropMistakes）
 */

/**
 * 目的を選んだときの、案内の状態を作ります。「自由に記録する」と、知らない目的の場合は undefined です。
 * @param {unknown} purpose
 * @param {number} stepCount 今の手順の数
 * @returns {GuideState | undefined}
 */
export function startGuide(purpose, stepCount) {
  if (!PURPOSES.some((item) => item.id === purpose) || purpose === 'free') {
    return undefined;
  }
  return { purpose: /** @type {Purpose} */ (purpose), start: stepCount, done: [] };
}

/**
 * 今の段階です。段階ごとに案内しない目的の場合は undefined です。
 * @param {GuideState} guide
 * @returns {GuideStage | undefined}
 */
export function currentStage(guide) {
  const stages = STAGES[guide.purpose];
  return stages?.[Math.min(guide.done.length, stages.length - 1)];
}

/**
 * 段階ごとの始まりの手順の番号です。
 * @param {GuideState} guide
 * @param {number} stage
 */
function stageStart(guide, stage) {
  return stage === 0 ? guide.start : (guide.done[stage - 1] ?? guide.start);
}

/**
 * 日付として読める文字のクリックかを判定します。［繰り返しにする］で対象の月の条件に使える手順と同じ判定です
 * （record-loop.js の dateSteps）。
 * @param {Step} step
 */
function isDateClick(step) {
  return (
    step.type === 'click' &&
    step.download === undefined &&
    step.newTab === undefined &&
    !ACTION_TAGS.includes(step.target.tag) &&
    step.target.text !== undefined &&
    parseDate(step.target.text).ok
  );
}

/**
 * ファイルを保存する手順か（ダウンロードを保存するクリックか、PDF の保存）を判定します。
 * @param {Step} step
 */
function isSaveStep(step) {
  return step.type === 'savePdf' || (step.type === 'click' && step.download !== undefined);
}

/**
 * 段階を終えた状態を返します。
 * @param {GuideState} guide
 * @param {number} stepCount
 * @returns {GuideState}
 */
function advanced(guide, stepCount) {
  const { notice, ...rest } = guide;
  void notice;
  return { ...rest, done: [...guide.done, stepCount] };
}

/**
 * 押したものが合わないと知らせ、その手順を押し間違えた手順として覚えた状態を返します（#276）。
 * @param {GuideState} guide
 * @param {string} notice
 * @param {number} index 押し間違えた手順の番号
 * @returns {GuideState}
 */
function withMistake(guide, notice, index) {
  return { ...guide, notice, mistakes: [...(guide.mistakes ?? []), index] };
}

/**
 * 押し間違えた手順の記録を消した状態を返します。
 * @param {GuideState} guide
 * @returns {GuideState}
 */
function withoutMistakes(guide) {
  const { mistakes, ...rest } = guide;
  void mistakes;
  return rest;
}

/**
 * 手順を記録した後、または記録した手順が変わった後（クリックがダウンロードの保存に変わった場合など）の、
 * 案内の状態です。ページの移動の手順では、知らせを残します。押したものの知らせが、押した直後の移動で消えない
 * ようにするためです。
 * @param {GuideState} guide
 * @param {Step[]} steps 記録した後の手順
 * @param {(unknown | null)[]} [pagerHints] steps と同じ順の、ページ送りに使う場合の指定（#182）
 * @returns {GuideState}
 */
export function guideAfterStep(guide, steps, pagerHints = []) {
  const stage = currentStage(guide);
  const step = steps.at(-1);
  if (!stage || !step) {
    return guide;
  }
  // 購入の案内の途中で確定ボタンが押された場合は、一時停止として記録されています（#249）。最後の段階へ進み、
  // 注文が確定していないかを確かめるよう知らせます。
  if (guide.purpose === 'purchase' && step.type === 'pause' && stage.advance !== 'end') {
    const stages = STAGES.purchase ?? [];
    return {
      ...clearNotice(guide),
      done: [...guide.done, ...Array(stages.length - 1 - guide.done.length).fill(steps.length)],
      notice:
        '確定ボタンが押されました。手順には、押す代わりに一時停止を記録しています。注文が確定していないか、サイトの注文履歴を確かめてください。',
    };
  }
  if (stage.advance === 'save') {
    const from = stageStart(guide, guide.done.length);
    return steps.slice(from).some(isSaveStep) ? advanced(guide, steps.length) : guide;
  }
  if (step.type !== 'click') {
    return step.type === 'navigate' ? guide : clearNotice(guide);
  }
  const label = step.target.label;
  switch (stage.advance) {
    case 'date':
      return isDateClick(step)
        ? advanced(guide, steps.length)
        : withMistake(
            guide,
            `押した「${label}」は、日付として読めません。一覧の 1 件目の日付の文字を押してください。日付を押すと、いま押した手順は削除します。`,
            steps.length - 1,
          );
    case 'text':
      if (ACTION_TAGS.includes(step.target.tag)) {
        return withMistake(
          guide,
          `押した「${label}」は、リンクかボタンのため、ファイル名にできません。ボタンではなく文字を押してください。文字を押すと、いま押した手順は削除します。ファイル名にしたい文字がない場合は［なし］を押してください。`,
          steps.length - 1,
        );
      }
      return step.target.text ? advanced(guide, steps.length) : guide;
    case 'click':
      return advanced(guide, steps.length);
    case 'pager':
      return pagerHints[steps.length - 1]
        ? advanced(guide, steps.length)
        : withMistake(
            guide,
            `押した「${label}」では、次のページへ進めません。一覧の［次へ］などを押してください。［次へ］を押すと、いま押した手順は削除します。次のページがない場合は［次のページはない］を押してください。`,
            steps.length - 1,
          );
    default:
      return clearNotice(guide);
  }
}

/**
 * 知らせを消した状態を返します。
 * @param {GuideState} guide
 * @returns {GuideState}
 */
function clearNotice(guide) {
  const { notice, ...rest } = guide;
  void notice;
  return rest;
}

/**
 * 今の段階が、ページで 2 件目を押してもらう段階かを返します（#247）。
 * @param {GuideState} guide
 */
export function waitsForPick(guide) {
  return currentStage(guide)?.advance === 'picked';
}

/**
 * ページで 2 件目が押され、1 件分が決まった後の、案内の状態です（#247）。
 * @param {GuideState} guide
 * @param {number} stepCount
 * @returns {GuideState}
 */
export function guideAfterPicked(guide, stepCount) {
  return waitsForPick(guide) ? advanced(guide, stepCount) : guide;
}

/**
 * ［このページから始める］などのボタンと、［飛ばす］で、次の段階へ進めます。進めない段階では、そのまま返します。
 * @param {GuideState} guide
 * @param {number} stepCount 今の手順の数
 * @param {'button' | 'skip'} by
 * @returns {GuideState}
 */
export function guideNext(guide, stepCount, by) {
  const stage = currentStage(guide);
  if (!stage || stage.advance === 'end') {
    return guide;
  }
  if (by === 'button' ? stage.advance !== 'button' : stage.skippable !== true) {
    return guide;
  }
  // ［飛ばす］で段階を終えた場合は、押し間違えた手順を削除しません（#276）。正しいものを押していないためです。
  const { notice, ...rest } = withoutMistakes(guide);
  void notice;
  return { ...rest, done: [...guide.done, stepCount] };
}

/**
 * ［ひとつ戻る］で、前の段階に戻ります。前の段階の始まりより後に記録した手順は、削除する手順として返します。
 * @param {GuideState} guide
 * @returns {{ guide: GuideState, keep: number } | undefined} keep は残す手順の数です。戻れない場合は undefined です
 */
export function guideBack(guide) {
  if (guide.done.length === 0) {
    return undefined;
  }
  const previous = guide.done.length - 1;
  const { notice, ...rest } = withoutMistakes(guide);
  void notice;
  return {
    guide: { ...rest, done: guide.done.slice(0, previous) },
    keep: stageStart(guide, previous),
  };
}

/**
 * 手順の一覧から手順を削除した後の、案内の状態です。削除した手順を使って終えた段階は、終えていないことにします。
 * @param {GuideState} guide
 * @param {number} index 削除した手順の番号
 * @returns {GuideState}
 */
export function guideAfterRemoval(guide, index) {
  const done = guide.done.filter((count) => count <= index);
  const next = withoutMistakes(guide);
  // 押し間違えた手順の番号は、削除した手順の分をずらします（#276）。
  const mistakes = (guide.mistakes ?? [])
    .filter((mistake) => mistake !== index)
    .map((mistake) => (mistake > index ? mistake - 1 : mistake));
  return {
    ...next,
    start: Math.min(guide.start, index),
    done,
    ...(mistakes.length > 0 && done.length === guide.done.length ? { mistakes } : {}),
  };
}

/**
 * 正しいものを押して段階を終えた直後に、その段階で押し間違えた手順を削除します（#276）。
 * 削除するのは、押し間違えたクリックと、それより後に記録した「ページを開く」手順（押し間違えたリンクでページが
 * 移動し、戻った場合の移動）です。入力と選択は、利用者が意図した操作の場合があるため残します。
 * 段階を終えた直後でない場合と、押し間違えた手順がない場合は、undefined を返します。
 * @param {GuideState} guide 段階を終えた後の状態
 * @param {Step[]} steps
 * @returns {{ guide: GuideState, keep: boolean[], removed: number } | undefined}
 */
export function guideDropMistakes(guide, steps) {
  const mistakes = guide.mistakes ?? [];
  if (mistakes.length === 0 || guide.done.length === 0 || guide.done.at(-1) !== steps.length) {
    return undefined;
  }
  const from = stageStart(guide, guide.done.length - 1);
  const rest = withoutMistakes(guide);
  // 終えた段階の中の、段階を終えた手順（最後の手順）より前の手順だけを対象にします。
  const inStage = mistakes.filter((index) => index >= from && index < steps.length - 1);
  if (inStage.length === 0) {
    return { guide: rest, keep: steps.map(() => true), removed: 0 };
  }
  const first = Math.min(...inStage);
  const keep = steps.map(
    (step, index) =>
      index < from ||
      index === steps.length - 1 ||
      !(inStage.includes(index) || (index > first && step.type === 'navigate')),
  );
  const removed = keep.filter((kept) => !kept).length;
  return {
    guide: {
      ...rest,
      done: [...guide.done.slice(0, -1), steps.length - removed],
      notice: `押し間違えた手順を削除しました（${removed} 件）。`,
    },
    keep,
    removed,
  };
}

/**
 * サイドパネルに表示する案内です。
 * @param {GuideState} guide
 * @param {boolean} [picking] ページで 2 件目を押すのを待っているか（記録中の状態の picking）
 * @returns {{ text: string, notice?: string, button?: string, finish?: boolean, skip?: string, canBack: boolean, step?: { number: number, total: number } }}
 *   finish は、button が完成のボタン（繰り返しを作って記録を停止する、#248）か
 */
export function guideView(guide, picking = false) {
  const stages = STAGES[guide.purpose];
  const stage = currentStage(guide);
  if (!stages || !stage) {
    return { text: HINTS[guide.purpose] ?? '', canBack: false };
  }
  const number = Math.min(guide.done.length, stages.length - 1);
  const waiting = picking && stage.advance === 'picked';
  return {
    text: waiting && stage.waiting ? stage.waiting : stage.text,
    ...(guide.notice ? { notice: guide.notice } : {}),
    ...((stage.advance === 'button' ||
      stage.advance === 'picked' ||
      stage.advance === 'stop' ||
      stage.advance === 'end') &&
    stage.label &&
    !waiting
      ? { button: stage.label }
      : {}),
    ...(stage.advance === 'end' && stage.label ? { finish: true } : {}),
    ...(stage.skippable === true ? { skip: stage.skipLabel ?? '飛ばす' } : {}),
    // 待っている間の［ひとつ戻る］は、待つのをやめます。
    canBack: guide.done.length > 0 || waiting,
    step: { number: number + 1, total: stages.length },
  };
}

/**
 * 段階を終えたときに記録した、最後の手順の番号です。段階で手順を記録していない場合（飛ばした場合）は undefined です。
 * @param {GuideState} guide
 * @param {number} stage
 */
function lastStepOf(guide, stage) {
  const end = guide.done[stage];
  if (end === undefined || end <= stageStart(guide, stage)) {
    return undefined;
  }
  return end - 1;
}

/**
 * 繰り返しを作る値です（background/recording.js の makeRecordedLoop に渡します）。
 * @typedef {object} GuideLoop
 * @property {number} from 範囲の先頭
 * @property {number} to 範囲の末尾（保存の手順）
 * @property {string} key 一覧の行の候補（candidateKey の値）
 * @property {number[]} names ファイル名に使う手順の番号
 * @property {number} [nextPage] 次のページへ送るクリックの番号
 * @property {number} [dateStep] 対象の月の条件に使う日付の手順の番号
 */

/**
 * 「ファイルをまとめて保存する」の案内を最後まで終えた記録から、繰り返しを作る値を求めます（#248）。
 * 範囲は 1 件目の日付（飛ばした場合はファイル名、さらに飛ばした場合は保存の段階の最初の手順）から保存の手順まで、
 * ファイル名は日付とファイル名の文字、対象の月は日付、ページ送りは［次へ］のクリックです。
 * @param {GuideState} guide
 * @param {Step[]} steps
 * @param {import('./record-loop.js').RowHint[]} rowHints steps と同じ順の、一覧の行の候補
 * @returns {{ ok: true, loop: GuideLoop } | { ok: false, error: string }}
 */
export function guideLoop(guide, steps, rowHints) {
  const stages = STAGES[guide.purpose];
  if (guide.purpose !== 'files' || !stages || guide.done.length < stages.length - 1) {
    return { ok: false, error: '案内の最後の段階まで進んでから押してください。' };
  }
  const order = stages.map((stage) => stage.id);
  const at = (/** @type {string} */ id) => order.indexOf(id);
  const dateStep = lastStepOf(guide, at('date'));
  const nameStep = lastStepOf(guide, at('name'));
  const from = stageStart(guide, at('date'));
  const saveEnd = guide.done[at('save')];
  // 保存の手順は、保存の段階の最後の手順です。段階は、保存の手順ができた時点で終えるためです。
  const to = saveEnd - 1;
  if (!(to >= from) || to >= steps.length) {
    return {
      ok: false,
      error: '保存の手順が見つかりません。［ひとつ戻る］で保存の段階からやり直してください。',
    };
  }
  const hint = rowHints
    .slice(from, to + 1)
    .find((candidates) => candidates && candidates.length > 0);
  if (!hint) {
    return {
      ok: false,
      error:
        '一覧の 1 件分が決まっていません。［ひとつ戻る］で 2 件目の段階からやり直してください。',
    };
  }
  const nextPage = lastStepOf(guide, at('next'));
  return {
    ok: true,
    loop: {
      from,
      to,
      key: candidateKey(hint[0].items),
      names: [dateStep, nameStep].filter((index) => index !== undefined),
      ...(nextPage !== undefined ? { nextPage } : {}),
      ...(dateStep !== undefined ? { dateStep } : {}),
    },
  };
}

/**
 * 今の段階が、［ここで止める］で一時停止を加える段階かを返します（#249）。
 * @param {GuideState} guide
 */
export function stopsHere(guide) {
  return currentStage(guide)?.advance === 'stop';
}

/**
 * ［ここで止める］を押した後の手順と案内の状態です（#249）。手順の最後に一時停止を 1 つだけ加えます。
 * 最後の手順がすでに一時停止の場合は、加えません。
 * @param {GuideState} guide
 * @param {Step[]} steps
 * @returns {{ guide: GuideState, steps: Step[] }}
 */
export function guideStop(guide, steps) {
  if (!stopsHere(guide)) {
    return { guide, steps };
  }
  const next =
    steps.at(-1)?.type === 'pause'
      ? steps
      : [...steps, /** @type {Step} */ ({ type: 'pause', note: PURCHASE_STOP_NOTE })];
  return { guide: advanced(guide, next.length), steps: next };
}

/** 最初のページを開く手順を加えたときの知らせです（#257）。 */
export const START_PAGE_ADDED = '最初にこのページを開く手順を加えました。';

/** ［このページから始める］を押す前の移動の手順を、このページを開く手順に置き換えたときの知らせです（#264）。 */
export const START_PAGE_REPLACED =
  'ここまでの移動の手順を削除し、このページを直接開く手順にしました。';

/**
 * 案内の最初の段階で［このページから始める］を押したときに、手順の始まりを表示中のページにそろえます。
 * - 目的を選んだ後に記録した手順（最初の段階で、ページを探す途中のクリックや移動）を削除し、表示中のページを
 *   開く手順に置き換えます（#264）。目的を選ぶ前の手順が「ページを開く」手順だけの場合は、その手順も置き換えます。
 * - 目的を選ぶ前に記録したクリックや入力は残します。その手順の最初が「ページを開く」手順でない場合は、表示中の
 *   ページを開く手順を先頭に加えます（#257）。最初の手順を誤って削除すると、開くページが決まらず、実行できない
 *   フローになるためです。
 * - 変える手順がない場合（記録を始めたページのまま押した場合など）は、undefined を返します。
 * 判定には手順の種類と URL だけを使い、ページの文字は使いません。
 *
 * 表示中のページのサイトが、記録を始めたサイト（origin）と異なる場合は、表示中のページのサイトを origin にします。
 * 元のサイトで記録した手順には元のサイトを手順の origin として書き、元のサイトを使う手順がある場合だけ
 * extraOrigins に残します。
 * @template H, P
 * @param {{ steps: Step[], rowHints: H[], pagerHints: P[], origin: string, extraOrigins: string[], guide: GuideState }} state
 * @param {string} url 表示中のページの URL
 * @returns {{ steps: Step[], rowHints: (H | null)[], pagerHints: (P | null)[], origin: string, extraOrigins: string[], guide: GuideState, removed: number } | undefined}
 */
export function withStartPage(state, url) {
  /** @type {Step} */
  const open = { type: 'navigate', url, cause: 'user' };
  const start = Math.min(state.guide.start, state.steps.length);
  const entries = state.steps.map((step, index) => ({
    step,
    row: state.rowHints[index] ?? null,
    pager: state.pagerHints[index] ?? null,
  }));
  const after = entries.slice(start);
  let before = entries.slice(0, start);
  if (before.every((entry) => entry.step.type === 'navigate')) {
    before = [];
  }
  const head = { step: open, row: null, pager: null };
  /** @type {typeof entries} */
  let next;
  if (before.length === 0) {
    next = [head];
  } else if (before[0].step.type !== 'navigate') {
    next = [head, ...before];
  } else {
    next = after.length > 0 ? [...before, head] : before;
  }
  if (JSON.stringify(next.map((entry) => entry.step)) === JSON.stringify(state.steps)) {
    return undefined;
  }
  const removed = state.steps.length - next.filter((entry) => entry !== head).length;
  const origin = new URL(url).origin;
  const previous = state.origin;
  /** @type {Step[]} */
  const steps = next.map(({ step }) => {
    if (!('target' in step)) {
      return step;
    }
    const own = 'origin' in step && typeof step.origin === 'string' ? step.origin : previous;
    const changed = /** @type {Step & { origin?: string }} */ ({ ...step });
    if (own === origin) {
      delete changed.origin;
    } else {
      changed.origin = own;
    }
    return changed;
  });
  /** 手順が使うサイトです。ページを開く手順の行き先と、手順の origin です。 */
  const used = new Set(
    steps.flatMap((step) => {
      if (step.type === 'navigate') {
        return [new URL(step.url).origin];
      }
      return 'origin' in step && typeof step.origin === 'string' ? [step.origin] : [];
    }),
  );
  const extraOrigins = [...new Set([...state.extraOrigins, previous])].filter(
    (site) => site !== origin && (site !== previous || used.has(site)),
  );
  const { notice, ...guide } = state.guide;
  void notice;
  return {
    steps,
    rowHints: next.map((entry) => entry.row),
    pagerHints: next.map((entry) => entry.pager),
    origin,
    extraOrigins,
    // 最後に加えた「ページを開く」手順は、最初の段階の手順です。［ひとつ戻る］で最初の段階に戻ると、この手順から後を消します。
    guide: { ...guide, start: next.at(-1) === head ? next.length - 1 : next.length, done: [] },
    removed,
  };
}

/**
 * 今の段階が、案内の最初の段階（［このページから始める］）かを返します（#257）。
 * @param {GuideState} guide
 */
export function atStartPage(guide) {
  const stage = currentStage(guide);
  return guide.done.length === 0 && stage?.advance === 'button';
}
