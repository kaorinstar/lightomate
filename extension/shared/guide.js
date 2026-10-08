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
 * 知らせを付けた状態を返します。
 * @param {GuideState} guide
 * @param {string} notice
 * @returns {GuideState}
 */
function withNotice(guide, notice) {
  return { ...guide, notice };
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
        : withNotice(
            guide,
            `押した「${label}」は、日付として読めません。一覧の 1 件目の日付の文字を押してください。押した手順は残っています。不要な場合は手順の一覧から削除してください。`,
          );
    case 'text':
      if (ACTION_TAGS.includes(step.target.tag)) {
        return withNotice(
          guide,
          `押した「${label}」は、リンクかボタンのため、ファイル名にできません。ボタンではなく文字を押してください。ファイル名にしたい文字がない場合は［なし］を押してください。`,
        );
      }
      return step.target.text ? advanced(guide, steps.length) : guide;
    case 'click':
      return advanced(guide, steps.length);
    case 'pager':
      return pagerHints[steps.length - 1]
        ? advanced(guide, steps.length)
        : withNotice(
            guide,
            `押した「${label}」では、次のページへ進めません。一覧の［次へ］などを押してください。次のページがない場合は［次のページはない］を押してください。`,
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
