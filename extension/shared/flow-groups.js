// フローの一覧を、ホスト名ごとの折りたためる見出しの下にまとめて表示する部品です（#42）。
// chrome.* は使いません。管理画面のほか、サイドパネル（#44）からも使う想定です。
// 折りたたみは HTML 標準の <details> と <summary> で行います。

/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */

/**
 * まとまりごとの見出しと、その下のフローの行を作ります。
 * @param {Document} document
 * @param {{ host: string, flows: StoredFlow[] }[]} groups flow-search.js の groupByHost の結果
 * @param {{
 *   renderItem: (stored: StoredFlow) => HTMLElement,
 *   isOpen: (host: string) => boolean,
 *   onToggle: (host: string, open: boolean) => void,
 * }} handlers
 *   renderItem はフローの 1 行を作ります。isOpen と onToggle で、一覧を作り直しても開閉の状態を保ちます
 * @returns {HTMLDetailsElement[]}
 */
export function buildFlowGroups(document, groups, { renderItem, isOpen, onToggle }) {
  return groups.map(({ host, flows }) => {
    const details = document.createElement('details');
    details.className = 'lm-group';
    details.open = isOpen(host);
    const summary = document.createElement('summary');
    summary.className = 'list-group-item lm-list-heading';
    summary.textContent = `${host}（${flows.length} 件）`;
    details.append(summary, ...flows.map(renderItem));
    details.addEventListener('toggle', () => onToggle(host, details.open));
    return details;
  });
}
