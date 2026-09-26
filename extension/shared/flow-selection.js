// 管理画面のフローの一覧で、チェックボックスで選んだフローの扱いです（#83）。chrome.* は使いません。

import { isActiveRun } from './flow-list.js';

/**
 * ［すべて選択］のチェックボックスの状態を決めます。
 * @param {string[]} shownIds 一覧に表示中（検索で絞り込んだ結果）のフローの id
 * @param {ReadonlySet<string>} selected 選んでいるフローの id
 * @returns {'all' | 'some' | 'none'} all はすべて、some は一部（中間の状態）、none は選んでいない状態です
 */
export function selectAllState(shownIds, selected) {
  const count = shownIds.filter((id) => selected.has(id)).length;
  if (count === 0) {
    return 'none';
  }
  return count === shownIds.length ? 'all' : 'some';
}

/**
 * 表示から外れたフローの選択を外します。検索語を変えた後に、見えないフローを操作しないためです。
 * @param {ReadonlySet<string>} selected
 * @param {string[]} shownIds 一覧に表示中のフローの id
 * @returns {Set<string>}
 */
export function pruneSelection(selected, shownIds) {
  const shown = new Set(shownIds);
  return new Set([...selected].filter((id) => shown.has(id)));
}

/**
 * 選んだフローを、削除するものと、実行中のため削除しないものに分けます。
 * 実行中のフローを削除すると、サイドパネルに実行中の手順を表示できなくなるためです。
 * @param {string[]} ids 選んだフローの id
 * @param {{ flowId: string, status: string }[]} runs 実行の状態の一覧
 * @returns {{ remove: string[], running: string[] }}
 */
export function splitDeletable(ids, runs) {
  const running = new Set(runs.filter((run) => isActiveRun(run)).map((run) => run.flowId));
  return {
    remove: ids.filter((id) => !running.has(id)),
    running: ids.filter((id) => running.has(id)),
  };
}
