// 案内付きの記録（#245）の、目的と段階の定義と判定です。chrome.* を使いません。
// 記録中の状態（background/recording.js の Recording）に GuideState を保存し、手順を記録するたびに
// guideAfterStep で次の段階へ進むかを決めます。サイドパネルは guideView の内容を表示します。

import { parseDate } from './condition.js';
import { ACTION_TAGS } from './record-loop.js';

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
  { id: 'free', label: '自由に記録する（今までどおり）' },
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
 * - end：最後の段階です。これより先には進みません。
 * @typedef {object} GuideStage
 * @property {string} id
 * @property {string} text 案内の 1 文
 * @property {'button' | 'date' | 'end'} advance
 * @property {string} [label] advance が button の場合の、ボタンの文言
 * @property {boolean} [skippable] 次の段階へ、［飛ばす］で進めるか
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
      id: 'rest',
      text: 'ここから先は、今までどおり記録してください。1 件目のファイルを保存するまで操作してから、［繰り返しにする］を押します。',
      advance: 'end',
    },
  ],
};

/** 1 文の案内だけを出す目的の、案内の文です。 */
/** @type {Partial<Record<Purpose, string>>} */
const HINTS = {
  pdf: '保存したいページを開くまでの操作を記録してください。PDF の保存の手順は、記録の後に管理画面の編集画面で「PDF を保存」を加えます。',
  purchase:
    '買いたい商品のページを開き、［かごに入れる］から購入の手続きまで進めてください。注文を確定するボタンは押さないでください。確定ボタンを押すと、実際に注文が確定します。',
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
 * 手順を 1 つ記録した後の、案内の状態です。
 * @param {GuideState} guide
 * @param {Step[]} steps 記録した後の手順
 * @returns {GuideState}
 */
export function guideAfterStep(guide, steps) {
  const stage = currentStage(guide);
  const { notice, ...rest } = guide;
  void notice;
  if (stage?.advance !== 'date') {
    return rest;
  }
  const step = steps.at(-1);
  if (!step || step.type !== 'click') {
    return rest;
  }
  if (isDateClick(step)) {
    return { ...rest, done: [...guide.done, steps.length] };
  }
  const label = step.target.label;
  return {
    ...rest,
    notice: `押した「${label}」は、日付として読めません。一覧の 1 件目の日付の文字を押してください。押した手順は残っています。不要な場合は手順の一覧から削除してください。`,
  };
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
  const { notice, ...rest } = guide;
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
  const { notice, ...rest } = guide;
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
  return { ...guide, start: Math.min(guide.start, index), done };
}

/**
 * サイドパネルに表示する案内です。
 * @param {GuideState} guide
 * @returns {{ text: string, notice?: string, button?: string, canSkip: boolean, canBack: boolean, step?: { number: number, total: number } }}
 */
export function guideView(guide) {
  const stages = STAGES[guide.purpose];
  const stage = currentStage(guide);
  if (!stages || !stage) {
    return { text: HINTS[guide.purpose] ?? '', canSkip: false, canBack: false };
  }
  const number = Math.min(guide.done.length, stages.length - 1);
  return {
    text: stage.text,
    ...(guide.notice ? { notice: guide.notice } : {}),
    ...(stage.advance === 'button' && stage.label ? { button: stage.label } : {}),
    canSkip: stage.skippable === true,
    canBack: guide.done.length > 0,
    step: { number: number + 1, total: stages.length },
  };
}
