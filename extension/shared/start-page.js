// 手順の最初を「ページを開く」手順にそろえる処理です（#257、#277）。chrome.* を使いません。
// 最初の手順を誤って削除すると、実行するときに開くページが決まらず、実行できないフローになるためです。

/** @typedef {import('./flow.js').Step} Step */

/** 最初のページを開く手順を加えたときの知らせです（#257、#277）。 */
export const START_PAGE_ADDED = '最初にこのページを開く手順を加えました。';

/**
 * 手順の始まりのページを url に変えたときの、手順の origin と、記録したサイト（extraOrigins）を決め直します。
 * url のサイトが、記録を始めたサイト（previous）と異なる場合は、url のサイトを origin にします。元のサイトで
 * 記録した手順には元のサイトを手順の origin として書き、元のサイトを使う手順がある場合だけ extraOrigins に残します。
 * @param {Step[]} steps
 * @param {string} previous 記録を始めたサイト（記録中の状態の origin）
 * @param {string} url 始まりのページの URL
 * @param {string[]} extraOrigins
 * @returns {{ steps: Step[], origin: string, extraOrigins: string[] }}
 */
export function rebaseOrigin(steps, previous, url, extraOrigins) {
  const origin = new URL(url).origin;
  /** @type {Step[]} */
  const rebased = steps.map((step) => {
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
    rebased.flatMap((step) => {
      if (step.type === 'navigate') {
        return [new URL(step.url).origin];
      }
      return 'origin' in step && typeof step.origin === 'string' ? [step.origin] : [];
    }),
  );
  return {
    steps: rebased,
    origin,
    extraOrigins: [...new Set([...extraOrigins, previous])].filter(
      (site) => site !== origin && (site !== previous || used.has(site)),
    ),
  };
}

/**
 * 最初の手順が「ページを開く」手順でない場合に、表示中のページを開く手順を先頭に加えます（#277）。
 * 記録中に次の操作を記録するときに使います。最初の手順が「ページを開く」手順の場合は、undefined を返します。
 * 判定には手順の種類と URL だけを使い、ページの文字は使いません。
 * @template H, P
 * @param {{ steps: Step[], rowHints: H[], pagerHints: P[], origin: string, extraOrigins: string[] }} state
 * @param {string} url 表示中のページ（最上位のページ）の URL
 * @returns {{ steps: Step[], rowHints: (H | null)[], pagerHints: (P | null)[], origin: string, extraOrigins: string[] } | undefined}
 */
export function withOpenPage(state, url) {
  if (state.steps[0]?.type === 'navigate') {
    return undefined;
  }
  /** @type {Step} */
  const open = { type: 'navigate', url, cause: 'user' };
  const rebased = rebaseOrigin([open, ...state.steps], state.origin, url, state.extraOrigins);
  return {
    ...rebased,
    rowHints: [null, ...state.steps.map((_, index) => state.rowHints[index] ?? null)],
    pagerHints: [null, ...state.steps.map((_, index) => state.pagerHints[index] ?? null)],
  };
}
