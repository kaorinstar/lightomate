// フローの一覧をドメイン（ホスト名）ごとにまとめ、検索で絞り込む処理です（#42）。
// chrome.* は使いません。管理画面のほか、サイドパネル（#44）からも使う想定です。

/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */

/**
 * 一致方法です。contains は部分一致、prefix は前方一致、suffix は後方一致です。
 * @typedef {'contains' | 'prefix' | 'suffix'} MatchMode
 */

/** 一致方法の一覧と、画面に出す名前です。先頭が既定です。 */
export const MATCH_MODES = /** @type {const} */ ([
  { value: 'contains', label: '部分一致' },
  { value: 'prefix', label: '前方一致' },
  { value: 'suffix', label: '後方一致' },
]);

/** 候補として表示する最大の件数です。 */
export const MAX_SUGGESTIONS = 10;

/**
 * フローの origin から、まとめる単位のホスト名を取り出します（例：https://www.amazon.co.jp → www.amazon.co.jp）。
 * 読み取れない場合は、origin をそのまま返します。
 * @param {string} origin
 * @returns {string}
 */
export function hostOf(origin) {
  try {
    return new URL(origin).hostname || origin;
  } catch {
    return origin;
  }
}

/**
 * 比較のための文字列にします。前後の空白を除き、大文字と小文字を区別しないようにします。
 * 全角と半角は区別します（#42 の補足）。
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text.trim().toLowerCase();
}

/**
 * 文字列が、検索語と一致方法の条件に合うかを判定します。検索語が空の場合は、すべて該当とします。
 * @param {string} text
 * @param {string} query
 * @param {MatchMode} mode
 * @returns {boolean}
 */
export function matchesText(text, query, mode) {
  const needle = normalize(query);
  if (!needle) {
    return true;
  }
  const haystack = normalize(text);
  switch (mode) {
    case 'prefix':
      return haystack.startsWith(needle);
    case 'suffix':
      return haystack.endsWith(needle);
    default:
      return haystack.includes(needle);
  }
}

/**
 * フロー名とホスト名のどちらかが条件に合うフローだけを返します。
 * @param {StoredFlow[]} flows
 * @param {string} query
 * @param {MatchMode} mode
 * @returns {StoredFlow[]}
 */
export function filterFlows(flows, query, mode) {
  return flows.filter(
    (stored) =>
      matchesText(stored.flow.name, query, mode) ||
      matchesText(hostOf(stored.flow.origin), query, mode),
  );
}

/**
 * フローをホスト名ごとにまとめます。まとまりはホスト名の順、まとまりの中はフロー名の順に並べます。
 * @param {StoredFlow[]} flows
 * @returns {{ host: string, flows: StoredFlow[] }[]}
 */
export function groupByHost(flows) {
  /** @type {Map<string, StoredFlow[]>} */
  const groups = new Map();
  for (const stored of flows) {
    const host = hostOf(stored.flow.origin);
    groups.set(host, [...(groups.get(host) ?? []), stored]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([host, group]) => ({
      host,
      flows: group.sort((a, b) => compareText(a.flow.name, b.flow.name)),
    }));
}

/**
 * 検索欄の候補を作ります。フロー名とホスト名のうち、条件に合うものを重複なく返します。
 * フロー名、ホスト名の順に、それぞれ名前の順で並べ、最大 MAX_SUGGESTIONS 件とします。
 * 検索語が空の場合は、候補を出しません。
 * @param {StoredFlow[]} flows
 * @param {string} query
 * @param {MatchMode} mode
 * @returns {{ value: string, kind: 'flow' | 'site' }[]}
 */
export function suggestions(flows, query, mode) {
  if (!normalize(query)) {
    return [];
  }
  /**
   * @param {string[]} values
   * @returns {string[]}
   */
  const pick = (values) =>
    [...new Set(values)].filter((value) => matchesText(value, query, mode)).sort(compareText);
  return [
    ...pick(flows.map((stored) => stored.flow.name)).map((value) => ({
      value,
      kind: /** @type {const} */ ('flow'),
    })),
    ...pick(flows.map((stored) => hostOf(stored.flow.origin))).map((value) => ({
      value,
      kind: /** @type {const} */ ('site'),
    })),
  ].slice(0, MAX_SUGGESTIONS);
}

/**
 * 名前の順に並べるための比較です。日本語の照合順を使います。かなは五十音順ですが、漢字は読みの順になりません。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareText(a, b) {
  return a.localeCompare(b, 'ja');
}
