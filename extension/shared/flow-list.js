// 保存したフローの一覧と、実行を始めてよいかの判定です。chrome.* を使わない処理だけを置きます。

import { flattenSteps } from './control-flow.js';
import { isWebUrl } from './flow.js';

/**
 * 一覧の判定に使う、保存したフローの項目です。
 * @typedef {object} FlowEntry
 * @property {string} id
 * @property {{
 *   name: string,
 *   origin: string,
 *   extraOrigins?: string[],
 *   steps?: { type: string, url?: string }[],
 * }} flow
 */

/**
 * 実行を始めてよいかの判定に使う、実行の状態の項目です。
 * @typedef {object} RunEntry
 * @property {string} flowName
 * @property {string} origin
 * @property {string} status
 * @property {string} startedAt
 */

/** 実行の状態を chrome.storage.session に保存するキーの先頭です。続けて実行の id を付けます。 */
export const RUN_KEY_PREFIX = 'run/';

/** 名前の末尾に付けた番号（例：「 (2)」）です。 */
const NUMBER_SUFFIX = /\s\((\d+)\)$/;

/**
 * フローに関係するサイト（オリジン）の一覧です（#41）。フローの origin、extraOrigins、移動の手順の URL の
 * サイトです。移動の手順には、転送で通過しただけのサイト（ログインの画面など）も含みます。
 * URL にパラメータ（{{名前}}）を含み、サイトが決まらない移動の手順は含めません。
 * @param {FlowEntry['flow']} flow
 * @returns {Set<string>}
 */
export function flowSites(flow) {
  const sites = new Set([flow.origin, ...(flow.extraOrigins ?? [])]);
  // if と forEach の内側の移動の手順も含めます（#6）。
  const steps = /** @type {import('./flow.js').Step[]} */ (flow.steps ?? []);
  for (const { step } of flattenSteps(steps)) {
    if (step.type === 'navigate' && typeof step.url === 'string' && isWebUrl(step.url)) {
      const url = new URL(step.url);
      if (!url.host.includes('{{') && !url.host.includes('%7B')) {
        sites.add(url.origin);
      }
    }
  }
  return sites;
}

/**
 * 表示中のページのサイトに関係するフローだけを返します。順序は変えません。
 * フローの origin のほか、extraOrigins と移動の手順の URL のサイトとも比べます（#41）。
 * @template {FlowEntry} T
 * @param {T[]} flows
 * @param {string | null | undefined} origin
 * @returns {T[]}
 */
export function flowsForOrigin(flows, origin) {
  if (!origin) {
    return [];
  }
  return flows.filter((stored) => flowSites(stored.flow).has(origin));
}

/**
 * 表示中のページの URL から、フローの対象となるオリジンを返します。
 * Web ページ（https:// または http://）以外の場合は null を返します。新しいタブ（chrome://newtab）、
 * about:blank、chrome://、file://、拡張機能のページ（PDF の表示を含む）などです。
 * @param {string | undefined} url
 * @returns {string | null}
 */
export function pageOrigin(url) {
  return url && isWebUrl(url) ? new URL(url).origin : null;
}

/**
 * サイドパネルに表示するフローを決めます（#44）。
 * Web ページ（https:// または http://）を表示している場合は、そのサイトのフローだけを返します。
 * そのサイトのフローがなくても、ほかのサイトのフローは返しません。誤って実行することを防ぐためです。
 * Web ページ以外（新しいタブ、about:blank、chrome:// など）の場合は、すべてのフローを返します。
 * @template {FlowEntry} T
 * @param {T[]} flows
 * @param {string | null | undefined} origin 表示中のページのオリジン。Web ページ以外では null
 * @returns {{ scope: 'site' | 'all', flows: T[] }}
 */
export function flowsToShow(flows, origin) {
  return origin ? { scope: 'site', flows: flowsForOrigin(flows, origin) } : { scope: 'all', flows };
}

/**
 * 同じサイトのフローと名前が重ならないようにします。重なる場合は、末尾に番号を付けます
 * （例：「領収書」→「領収書 (2)」）。すでに番号が付いている名前は、番号を除いた名前から数え直します。
 * @param {string} name 付けたい名前
 * @param {string} origin フローのオリジン
 * @param {FlowEntry[]} flows 保存済みのフロー
 * @param {string} [ownId] 名前を変えるフローの id。自分自身とは比べません。
 * @returns {string}
 */
export function uniqueName(name, origin, flows, ownId) {
  const taken = new Set(
    flows
      .filter((stored) => stored.id !== ownId && stored.flow.origin === origin)
      .map((stored) => stored.flow.name),
  );
  if (!taken.has(name)) {
    return name;
  }
  const base = name.replace(NUMBER_SUFFIX, '');
  for (let number = 2; ; number += 1) {
    const candidate = `${base} (${number})`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** 実行中とみなす状態です。一時停止中も、再開できるよう実行中として扱います（#37）。 */
const ACTIVE_STATUSES = ['running', 'stopping', 'pausing', 'paused'];

/**
 * 実行中（停止の処理中、一時停止の処理中、一時停止中を含む）かどうかです。
 * @param {{ status: string }} run
 * @returns {boolean}
 */
export function isActiveRun(run) {
  return ACTIVE_STATUSES.includes(run.status);
}

/**
 * 同じサイトで実行中のフローを返します。ない場合は undefined を返し、実行を始めてよいことを示します。
 * 同じ Chrome では、同じサイトのログイン状態とカートの中身をタブの間で共有するため、
 * 同じサイトの 2 つのフローを同時に実行すると、互いの操作が干渉する可能性があります。
 * @template {RunEntry} T
 * @param {string} origin 実行したいフローのオリジン
 * @param {T[]} runs 実行の状態の一覧
 * @returns {T | undefined}
 */
export function findConflictingRun(origin, runs) {
  return runs.find((run) => isActiveRun(run) && run.origin === origin);
}

/**
 * 同じサイトのフローを実行中のため、実行を始められないことの説明です。
 * @param {string} origin
 * @param {string} flowName 実行中のフロー名。分からない場合は空の文字列です。
 * @returns {string}
 */
export function conflictMessage(origin, flowName) {
  const running = flowName ? `「${flowName}」` : '別のフロー';
  return `${origin} では${running}を実行中のため、実行できません。同じサイトのフローは、同時に実行できません。`;
}

/**
 * chrome.storage.session の内容から、実行の状態だけを、始めた日時の古い順に取り出します。
 * @param {Record<string, unknown>} stored
 * @returns {RunEntry[]}
 */
export function runStatesFrom(stored) {
  return Object.entries(stored)
    .filter(([key]) => key.startsWith(RUN_KEY_PREFIX))
    .map(([, value]) => /** @type {RunEntry} */ (value))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
