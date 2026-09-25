// フローのファイルへの書き出しと、ファイルからの読み込みです（#27）。chrome.* は使いません。
//
// ファイルは、フロー 1 件（オブジェクト）か、複数件（フローの配列）の JSON です。
// 読み込むときは全件を検証し、1 件でも誤りがあれば 1 件も追加しません。どれが追加されたかを
// わかりにくくしないためです。保存済みのフローと内容が同じフローは、追加しません。

import { orderFlow, validateFlow } from './flow.js';
import { uniqueName } from './flow-list.js';

/** @typedef {import('./flow.js').Flow} Flow */
/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */

/** Windows でファイル名に使えない文字と、制御文字です。 */
// 制御文字もファイル名から除くため、正規表現に含めます。
// eslint-disable-next-line no-control-regex
const UNSAFE_FILE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 1 つのファイルから読み込めるフローの件数の上限です。保存領域を使い切ることを防ぎます。 */
export const MAX_IMPORT_FLOWS = 100;

/**
 * 読み込んだ JSON の値を、フローの一覧にします。
 * @param {unknown} value JSON.parse の結果
 * @returns {{ ok: true, flows: Flow[], multiple: boolean } | { ok: false, errors: string[] }}
 *   multiple は、ファイルが配列だったかどうかです
 */
export function parseFlowFile(value) {
  if (!Array.isArray(value)) {
    const errors = validateFlow(value);
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, flows: [/** @type {Flow} */ (value)], multiple: false };
  }
  if (value.length === 0) {
    return { ok: false, errors: ['フローの配列が空です。'] };
  }
  if (value.length > MAX_IMPORT_FLOWS) {
    return {
      ok: false,
      errors: [
        `フローが ${value.length} 件あります。1 つのファイルで読み込めるのは ${MAX_IMPORT_FLOWS} 件までです。`,
      ],
    };
  }
  const errors = value.flatMap((flow, index) =>
    validateFlow(flow).map((error) => `${index + 1} 件目：${error}`),
  );
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, flows: /** @type {Flow[]} */ (value), multiple: true };
}

/**
 * フローの内容を比べるための文字列です（#27）。フロー名と schemaVersion を除き、項目を名前の順に並べた JSON です。
 * 名前だけを変えたフローや、版番号だけが異なるフローを、同じ内容として扱うためです。
 * ハッシュは保存せず、比べるたびに作ります。保存すると、フローを編集するたびに更新が必要になるためです。
 * @param {Flow} flow
 * @returns {string}
 */
export function flowContentKey(flow) {
  const content = { ...flow };
  delete (/** @type {Partial<Flow>} */ (content).name);
  delete (/** @type {Partial<Flow>} */ (content).schemaVersion);
  return JSON.stringify(sortKeys(content));
}

/**
 * 読み込むフローを、追加するものと、同じ内容のフローがすでにあるため追加しないものに分けます。
 * 同じファイルの中で内容が同じフローは、最初の 1 件だけを追加します。
 * @param {Flow[]} flows 読み込むフロー
 * @param {StoredFlow[]} existing 保存済みのフロー
 * @returns {{ fresh: Flow[], duplicates: Flow[] }}
 */
export function splitDuplicates(flows, existing) {
  const seen = new Set(existing.map((stored) => flowContentKey(stored.flow)));
  /** @type {Flow[]} */
  const fresh = [];
  /** @type {Flow[]} */
  const duplicates = [];
  for (const flow of flows) {
    const key = flowContentKey(flow);
    if (seen.has(key)) {
      duplicates.push(flow);
    } else {
      seen.add(key);
      fresh.push(flow);
    }
  }
  return { fresh, duplicates };
}

/**
 * オブジェクトの項目を、名前の順に並べ直した値を返します。配列の順序は変えません。
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(/** @type {Record<string, unknown>} */ (value)[key])]),
    );
  }
  return value;
}

/**
 * 追加するフローの名前を決めます。同じサイトに同じ名前のフローがある場合は、番号を付けます。
 * 既存のフローのほか、同じファイルの中の先のフローとも重ならないようにします。
 * @param {Flow[]} flows 追加するフロー
 * @param {StoredFlow[]} existing 保存済みのフロー
 * @returns {string[]} flows と同じ順の名前
 */
export function namesForImport(flows, existing) {
  /** @type {StoredFlow[]} */
  const taken = [...existing];
  return flows.map((flow, index) => {
    const name = uniqueName(flow.name, flow.origin, taken);
    taken.push({
      id: `import-${index}`,
      createdAt: '',
      updatedAt: '',
      flow: { ...flow, name },
    });
    return name;
  });
}

/**
 * 書き出すファイルの内容です。1 件の場合はオブジェクト、複数件の場合は配列にします。
 * 項目の順序は、管理画面の JSON の表示と同じ（orderFlow）です。
 * @param {Flow[]} flows
 * @returns {string}
 */
export function flowFileText(flows) {
  const ordered = flows.map(orderFlow);
  return `${JSON.stringify(ordered.length === 1 ? ordered[0] : ordered, null, 2)}\n`;
}

/**
 * 書き出すファイルの名前です。
 * 1 件の場合は「lightomate-<フロー名>-<年月日>.json」、複数件の場合は「lightomate-flows-<件数>件-<年月日>.json」です。
 * @param {Flow[]} flows
 * @param {Date} now
 * @returns {string}
 */
export function flowFileName(flows, now) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const label =
    flows.length === 1
      ? flows[0].name.replace(UNSAFE_FILE_NAME_CHARACTERS, '_').trim() || 'flow'
      : `flows-${flows.length}件`;
  return `lightomate-${label}-${date}.json`;
}
