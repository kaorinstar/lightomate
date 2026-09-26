// フローの管理画面です。保存したフローの内容の表示、最初のページを開く操作と実行、名前の変更、
// 書き出し、削除、JSON の編集と、
// JSON からの追加、サイトごとの「必ず止まる場所」の指定を行います。2 つはタブで分けています。
// ビジュアルエディタ（#9）ができるまでは、手順の変更は JSON を直接編集して行います。
// 配置と、知らせを出す場所は docs/design-guidelines.md に従います。成功は画面の上部のトーストに出し、
// 誤り・警告・確認は押したボタンの直下に出します。

import {
  addFlows,
  deleteFlow,
  deleteFlows,
  getFlow,
  listFlows,
  onFlowsChanged,
  renameFlow,
  saveFlow,
  setFlowInterval,
} from '../common/flow-store.js';
import { requestPermission } from '../common/permissions.js';
import {
  getStopRule,
  listStopRules,
  onStopRulesChanged,
  saveStopRule,
} from '../common/stop-rules-store.js';
import { listHistory, onHistoryChanged } from '../common/history-store.js';
import { describeParam, describeStep, formatDateTime, stepKindLabel } from '../shared/describe.js';
import {
  formatFlowJson,
  isWebOrigin,
  orderFlow,
  replaceJsonFields,
  replaceJsonName,
} from '../shared/flow.js';
import { conflictMessage, findConflictingRun, runStatesFrom } from '../shared/flow-list.js';
import { attachCombobox } from '../shared/combobox.js';
import { flowFileName, flowFileText, parseFlowFile, splitDuplicates } from '../shared/flow-file.js';
import { buildFlowGroups } from '../shared/flow-groups.js';
import { pruneSelection, selectAllState, splitDeletable } from '../shared/flow-selection.js';
import { MATCH_MODES, filterFlows, groupByHost, suggestions } from '../shared/flow-search.js';
import {
  NO_FIRST_PAGE,
  buildRunFields,
  firstPageParams,
  firstPageUrl,
  readRunFields,
  secretStepIndexes,
  showRunFieldErrors,
} from '../shared/run-form.js';
import { STATUS_LABELS, historyToCsv, stepText } from '../shared/history.js';
import { formatSeconds, readIntervalInput } from '../shared/speed.js';
import { parseLines, stopRuleFieldErrors } from '../shared/stop-rules.js';
import {
  confirmInline,
  followColorScheme,
  showFieldError,
  showNotice,
  showToast,
} from '../shared/ui.js';

/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */

const elements = {
  version: byId('version'),
  flows: byId('flows'),
  flowCount: byId('flow-count'),
  empty: byId('empty'),
  searchArea: byId('search-area'),
  search: /** @type {HTMLInputElement} */ (byId('search')),
  searchSuggestions: byId('search-suggestions'),
  searchMode: /** @type {HTMLSelectElement} */ (byId('search-mode')),
  noMatch: byId('no-match'),
  newFlow: byId('new'),
  placeholder: byId('placeholder'),
  editor: byId('editor'),
  editorHeading: byId('editor-heading'),
  editorOrigin: byId('editor-origin'),
  editorMeta: byId('editor-meta'),
  editorTitle: byId('editor-title'),
  editorActions: byId('editor-actions'),
  editorConfirm: byId('editor-confirm'),
  editorNotice: byId('editor-notice'),
  openFirst: /** @type {HTMLButtonElement} */ (byId('open-first')),
  run: /** @type {HTMLButtonElement} */ (byId('run')),
  runReason: byId('run-reason'),
  runForm: /** @type {HTMLFormElement} */ (byId('run-form')),
  runFormHeading: byId('run-form-heading'),
  runFields: byId('run-fields'),
  runSubmit: byId('run-submit'),
  runCancel: byId('run-cancel'),
  runNotice: byId('run-notice'),
  rename: byId('rename'),
  renameForm: /** @type {HTMLFormElement} */ (byId('rename-form')),
  renameInput: /** @type {HTMLInputElement} */ (byId('rename-input')),
  renameFeedback: byId('rename-feedback'),
  renameCancel: byId('rename-cancel'),
  paramsSection: byId('params-section'),
  speedForm: /** @type {HTMLFormElement} */ (byId('speed-form')),
  intervalMin: /** @type {HTMLInputElement} */ (byId('interval-min')),
  intervalMax: /** @type {HTMLInputElement} */ (byId('interval-max')),
  intervalFeedback: byId('interval-feedback'),
  speedNotice: byId('speed-notice'),
  params: byId('params'),
  stepCount: byId('step-count'),
  steps: byId('steps'),
  jsonDetails: /** @type {HTMLDetailsElement} */ (byId('json-details')),
  jsonNotice: byId('json-notice'),
  jsonFeedback: byId('json-feedback'),
  json: /** @type {HTMLTextAreaElement} */ (byId('json')),
  format: byId('format'),
  save: byId('save'),
  exportFlow: byId('export'),
  bulkArea: byId('bulk-area'),
  selectAll: /** @type {HTMLInputElement} */ (byId('select-all')),
  bulkBar: byId('bulk-bar'),
  bulkCount: byId('bulk-count'),
  bulkExport: byId('bulk-export'),
  bulkDelete: byId('bulk-delete'),
  bulkConfirm: byId('bulk-confirm'),
  bulkNotice: byId('bulk-notice'),
  flowsNotice: byId('flows-notice'),
  deleteFlow: byId('delete'),
  importer: byId('importer'),
  importConfirm: byId('import-confirm'),
  importNotice: byId('import-notice'),
  file: /** @type {HTMLInputElement} */ (byId('file')),
  importJson: /** @type {HTMLTextAreaElement} */ (byId('import-json')),
  importJsonFeedback: byId('import-json-feedback'),
  importFormat: byId('import-format'),
  importFlow: byId('import'),
  stopList: byId('stop-list'),
  stopEmpty: byId('stop-empty'),
  stopForm: /** @type {HTMLFormElement} */ (byId('stop-form')),
  stopOrigin: /** @type {HTMLInputElement} */ (byId('stop-origin')),
  stopOriginFeedback: byId('stop-origin-feedback'),
  stopOrigins: byId('stop-origins'),
  stopSelectors: /** @type {HTMLTextAreaElement} */ (byId('stop-selectors')),
  stopSelectorsFeedback: byId('stop-selectors-feedback'),
  stopPaths: /** @type {HTMLTextAreaElement} */ (byId('stop-paths')),
  stopPathsFeedback: byId('stop-paths-feedback'),
  stopClear: byId('stop-clear'),
  stopDelete: byId('stop-delete'),
  stopConfirm: byId('stop-confirm'),
  stopNotice: byId('stop-notice'),
  toast: byId('toast'),
  history: byId('history'),
  historyCount: byId('history-count'),
  historyEmpty: byId('history-empty'),
  historyTableWrap: byId('history-table-wrap'),
  historyCsv: byId('history-csv'),
  historyClear: byId('history-clear'),
  historyConfirm: byId('history-confirm'),
  historyNotice: byId('history-notice'),
};

/** 区画に置いた知らせの表示欄です。次の操作を始めるときに、まとめて消します。 */
const notices = [
  elements.flowsNotice,
  elements.bulkNotice,
  elements.importNotice,
  elements.editorNotice,
  elements.runNotice,
  elements.jsonNotice,
  elements.stopNotice,
  elements.historyNotice,
  elements.speedNotice,
];

/**
 * 入力欄と、その直下に置いた誤りの表示欄の組み合わせです。次の操作を始めるときに、まとめて消します。
 * @type {Array<[HTMLInputElement | HTMLTextAreaElement, HTMLElement]>}
 */
const fieldFeedbacks = [
  [elements.json, elements.jsonFeedback],
  [elements.intervalMin, elements.intervalFeedback],
  [elements.intervalMax, elements.intervalFeedback],
  [elements.importJson, elements.importJsonFeedback],
  [elements.stopOrigin, elements.stopOriginFeedback],
  [elements.stopSelectors, elements.stopSelectorsFeedback],
  [elements.stopPaths, elements.stopPathsFeedback],
];

/** 編集中のフローの id です。URL の # 以降にも書き、再読み込みしても同じフローを開きます。 */
let selectedId = decodeURIComponent(location.hash.slice(1));

elements.version.textContent = chrome.runtime.getManifest().version;
followColorScheme(document.documentElement, matchMedia('(prefers-color-scheme: dark)'));

/** 前の操作の知らせを消します。操作を始めるときに呼びます。 */
function clearNotices() {
  for (const notice of notices) {
    showNotice(notice, '');
  }
  // 入力欄の直下に出した誤りも、次の操作を始めるときに消します。
  for (const [control, feedback] of fieldFeedbacks) {
    showFieldError(control, feedback, '');
  }
}

// ---- タブ ----
// WAI-ARIA の Tabs パターンに従います（https://www.w3.org/WAI/ARIA/apg/patterns/tabs/）。
// 選んだタブは URL の ?tab= に書き、再読み込みしても同じタブを開きます。

const tabs = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[role="tab"]')]);

/**
 * タブを切り替えます。
 * @param {string} name data-tab の値
 * @param {boolean} [focus] 選んだタブにフォーカスを移すか。矢印キーで移動したときに使います
 */
function selectTab(name, focus = false) {
  const current = tabs.find((tab) => tab.dataset.tab === name) ?? tabs[0];
  for (const tab of tabs) {
    const selected = tab === current;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    // 選ばれていないタブは Tab キーで移動せず、矢印キーで移動します。
    tab.tabIndex = selected ? 0 : -1;
    byId(tab.getAttribute('aria-controls') ?? '').hidden = !selected;
  }
  if (focus) {
    current.focus();
  }
  const url = new URL(location.href);
  if (current === tabs[0]) {
    url.searchParams.delete('tab');
  } else {
    url.searchParams.set('tab', current.dataset.tab ?? '');
  }
  history.replaceState(null, '', url);
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => {
    clearNotices();
    selectTab(tab.dataset.tab ?? '');
  });
  tab.addEventListener('keydown', (event) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    const move = moves[/** @type {'ArrowRight' | 'ArrowLeft'} */ (event.key)];
    if (move) {
      event.preventDefault();
      const next = tabs[(index + move + tabs.length) % tabs.length];
      selectTab(next.dataset.tab ?? '', true);
    }
  });
}

// ?tab= がない場合は、保存したフローのタブを開きます。サイドパネルの［編集］から開く URL
// （#<フローの id>）には ?tab= がないため、そのフローを保存したフローのタブで開きます。
selectTab(new URL(location.href).searchParams.get('tab') ?? 'flows');

// ---- 保存したフロー ----

elements.newFlow.addEventListener('click', () => {
  select('');
  elements.importer.hidden = false;
  elements.placeholder.hidden = true;
  elements.importJson.focus();
});

/**
 * 編集欄の JSON を整形します（#50）。整形だけでは保存しません。
 * 読み取れない場合は欄の内容を変えず、誤りを欄の直下に出します。
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} feedback 編集欄の直後に置いた、誤りを表示する要素
 * @param {string} message 整形した後に、トーストで出す知らせ
 */
function formatJson(textarea, feedback, message) {
  clearNotices();
  const result = formatFlowJson(textarea.value);
  if (!result.ok) {
    showFieldError(textarea, feedback, result.error);
    return;
  }
  textarea.value = result.text;
  showToast(elements.toast, message);
}

elements.format.addEventListener('click', () =>
  formatJson(
    elements.json,
    elements.jsonFeedback,
    '整形しました。保存するには［JSON を保存］を押してください。',
  ),
);

elements.save.addEventListener('click', async () => {
  clearNotices();
  const flow = parse(elements.json, elements.jsonFeedback);
  if (!flow) {
    return;
  }
  const result = await saveFlow(flow, selectedId);
  if (!result.ok) {
    showFieldError(
      elements.json,
      elements.jsonFeedback,
      `形式に誤りがあるため、保存しませんでした。\n${result.errors.join('\n')}`,
    );
    return;
  }
  const { name } = /** @type {{ name: string }} */ (flow);
  if (result.name === name) {
    showToast(elements.toast, '保存しました。');
    return;
  }
  // 同じサイトに同じ名前のフローがあり、番号を付けて保存した場合は、編集欄の名前も合わせます。
  elements.json.value = JSON.stringify(
    orderFlow(/** @type {import('../shared/flow.js').Flow} */ ({ ...flow, name: result.name })),
    null,
    2,
  );
  // 名前が変わったことは見落とすと困るため、自動で消えるトーストではなく、ボタンの直下に残します。
  showNotice(
    elements.jsonNotice,
    `同じサイトに「${name}」があるため、「${result.name}」として保存しました。`,
    'warning',
  );
});

// ---- 最初のページを開く・実行（#43） ----

/**
 * 入力フォームで行う操作です。開く（open）か、実行する（run）かを、フォームを開いたときに決めます。
 * @type {{ mode: 'open' | 'run', flowId: string } | null}
 */
let runFormState = null;

elements.openFirst.addEventListener('click', async () => {
  clearNotices();
  hideRunForm();
  const stored = await getFlow(selectedId);
  if (!stored) {
    return;
  }
  if (firstPageParams(stored.flow).length > 0) {
    showRunForm(stored, 'open');
    return;
  }
  await openFirstPage(stored, {});
});

elements.run.addEventListener('click', () => {
  onRunClick().catch((error) => showNotice(elements.editorNotice, String(error), 'error'));
});

async function onRunClick() {
  clearNotices();
  hideRunForm();
  // 許可を求める処理は、ボタンを押した直後に呼び出す必要があります。その前に待ち時間を入れないよう、
  // 選んだフローのサイトは、表示中の内容から取ります。
  const origin = elements.editorOrigin.textContent ?? '';
  if (!selectedId || !origin) {
    return;
  }
  const denied = await requestPermission(origin);
  if (denied) {
    showNotice(elements.editorNotice, denied, 'error');
    return;
  }
  const stored = await getFlow(selectedId);
  if (!stored) {
    return;
  }
  if ((stored.flow.params ?? []).length === 0 && secretStepIndexes(stored.flow).length === 0) {
    await startRun(stored, {}, {}, elements.editorNotice);
    return;
  }
  showRunForm(stored, 'run');
}

elements.runForm.addEventListener('submit', (event) => {
  event.preventDefault();
  onRunFormSubmit().catch((error) => showNotice(elements.runNotice, String(error), 'error'));
});

async function onRunFormSubmit() {
  clearNotices();
  const state = runFormState;
  const stored = state ? await getFlow(state.flowId) : undefined;
  if (!state || !stored) {
    hideRunForm();
    return;
  }
  const params = state.mode === 'open' ? firstPageParams(stored.flow) : (stored.flow.params ?? []);
  if (showRunFieldErrors(elements.runForm, params, new Date())) {
    return;
  }
  const { params: values, secrets } = readRunFields(new FormData(elements.runForm));
  const done =
    state.mode === 'open'
      ? await openFirstPage(stored, values)
      : await startRun(stored, values, secrets, elements.runNotice);
  if (done) {
    hideRunForm();
  }
}

elements.runCancel.addEventListener('click', hideRunForm);

/**
 * 最初の手順の URL を新しいタブで開きます。手順は実行しません。
 * @param {StoredFlow} stored
 * @param {Record<string, string>} params
 * @returns {Promise<boolean>} 開いたか
 */
async function openFirstPage(stored, params) {
  const result = firstPageUrl(stored.flow, params, new Date());
  const notice = runFormState ? elements.runNotice : elements.editorNotice;
  if (!result.ok) {
    showNotice(notice, result.error, 'error');
    return false;
  }
  await chrome.tabs.create({ url: result.url, active: true });
  return true;
}

/**
 * サイドパネルの［実行］と同じ処理で、フローの実行を始めます。
 * @param {StoredFlow} stored
 * @param {Record<string, string>} params
 * @param {Record<string, string>} secrets
 * @param {HTMLElement} notice 始められなかった理由を出す場所
 * @returns {Promise<boolean>} 始めたか
 */
async function startRun(stored, params, secrets, notice) {
  const response = await chrome.runtime.sendMessage({
    kind: 'runner/start',
    flowId: stored.id,
    params,
    secrets,
  });
  if (!response?.ok) {
    showNotice(notice, response?.error ?? '実行を開始できません。', 'error');
    return false;
  }
  showToast(
    elements.toast,
    `「${stored.flow.name}」の実行を始めました。実行の状態はサイドパネルに表示します。`,
    { kind: 'info' },
  );
  return true;
}

/**
 * 値の入力フォームを表示します。開く場合は、最初の手順の URL が参照するパラメータだけを尋ねます。
 * @param {StoredFlow} stored
 * @param {'open' | 'run'} mode
 */
function showRunForm(stored, mode) {
  runFormState = { mode, flowId: stored.id };
  const open = mode === 'open';
  elements.runFormHeading.textContent = open ? '開くページの値の入力' : '実行する値の入力';
  elements.runSubmit.textContent = open ? 'この値で開く' : 'この値で実行';
  elements.runFields.replaceChildren(
    ...buildRunFields(document, stored.flow, {
      params: open ? firstPageParams(stored.flow) : (stored.flow.params ?? []),
      secretSteps: open ? [] : secretStepIndexes(stored.flow),
      now: new Date(),
    }),
  );
  showNotice(elements.runNotice, '');
  elements.runForm.hidden = false;
  elements.runForm.scrollIntoView({ block: 'nearest' });
  const first = elements.runFields.querySelector('input, select');
  if (first instanceof HTMLElement) {
    first.focus();
  }
}

function hideRunForm() {
  runFormState = null;
  elements.runForm.hidden = true;
  // 入力したパスワードなどを画面に残さないよう、入力欄ごと消します。
  elements.runFields.replaceChildren();
  showNotice(elements.runNotice, '');
}

/**
 * ［最初のページを開く］と［実行］を押せるかを、フローと、記録・実行の状態に合わせて更新します。
 * 押せない場合は、理由をボタンの下に表示します。
 * @param {import('../shared/flow.js').Flow} flow
 */
async function renderRunButtons(flow) {
  const stored = await chrome.storage.session.get(null);
  const conflict = findConflictingRun(flow.origin, runStatesFrom(stored));
  const noFirstPage = flow.steps[0]?.type !== 'navigate';
  const reason = noFirstPage
    ? NO_FIRST_PAGE
    : stored.recording
      ? '記録中は実行できません。'
      : conflict
        ? conflictMessage(conflict.origin, conflict.flowName)
        : '';
  elements.openFirst.disabled = noFirstPage;
  elements.run.disabled = Boolean(reason);
  elements.runReason.textContent = reason;
  elements.runReason.hidden = !reason;
}

// 記録と実行の状態は Service Worker が chrome.storage.session に書き込みます。
// 実行中は手順ごとに書き込まれるため、一覧は作り直さず、ボタンの状態だけを更新します。
chrome.storage.session.onChanged.addListener(() => {
  (async () => {
    const stored = selectedId ? await getFlow(selectedId) : undefined;
    if (stored) {
      await renderRunButtons(stored.flow);
    }
  })().catch(console.error);
});

elements.rename.addEventListener('click', async () => {
  clearNotices();
  const stored = await getFlow(selectedId);
  if (!stored) {
    return;
  }
  showRenameForm(true);
  elements.renameInput.value = stored.flow.name;
  elements.renameInput.focus();
  elements.renameInput.select();
});

elements.renameCancel.addEventListener('click', () => showRenameForm(false));

elements.renameInput.addEventListener('input', () => {
  showFieldError(elements.renameInput, elements.renameFeedback, '');
});

elements.renameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotices();
  const name = elements.renameInput.value.trim();
  if (!name) {
    showFieldError(elements.renameInput, elements.renameFeedback, 'フロー名を入力してください。');
    return;
  }
  const result = await renameFlow(selectedId, name);
  if (!result.ok) {
    showFieldError(
      elements.renameInput,
      elements.renameFeedback,
      `名前を変更できませんでした。${result.errors.join(' ')}`,
    );
    return;
  }
  showRenameForm(false);
  // JSON の編集欄は読み込み直さず、名前だけを書き換えます。保存していない編集を失わないためです（#53）。
  const renamed = replaceJsonName(elements.json.value, result.name);
  if (renamed === null) {
    showNotice(
      elements.jsonNotice,
      `JSON の編集欄を読み取れないため、編集欄の名前は書き換えていません。［JSON を保存］を押すと、名前は編集欄の内容に戻ります。`,
      'warning',
    );
  } else {
    elements.json.value = renamed;
  }
  if (result.name === name) {
    showToast(elements.toast, `名前を「${name}」に変更しました。`);
    return;
  }
  showNotice(
    elements.editorNotice,
    `同じサイトに「${name}」があるため、「${result.name}」に変更しました。`,
    'warning',
  );
  await render();
});

/**
 * 見出しの位置を、名前の入力欄に切り替えます。
 * @param {boolean} show
 */
function showRenameForm(show) {
  elements.renameForm.hidden = !show;
  elements.editorTitle.hidden = show;
  elements.editorActions.hidden = show;
  showFieldError(elements.renameInput, elements.renameFeedback, '');
}

elements.exportFlow.addEventListener('click', async () => {
  clearNotices();
  const stored = await getFlow(selectedId);
  if (stored) {
    downloadFlows([stored.flow]);
  }
});

// ---- 一覧のチェックボックスと一括操作（#83） ----
// 操作の対象は、一覧に表示中（検索で絞り込んだ結果）で、選んでいるフローだけです。
// 検索語を変えて表示から外れたフローは、render() で選択を外します。

/** 一覧で選んでいるフローの id です。 */
let checkedIds = new Set();

/** 一覧に表示中のフローです。render() のたびに更新します。 */
/** @type {StoredFlow[]} */
let shownFlows = [];

/** @returns {StoredFlow[]} 表示中で、選んでいるフロー */
function checkedFlows() {
  return shownFlows.filter((stored) => checkedIds.has(stored.id));
}

/** ［すべて選択］と操作の帯を、選んでいる状態に合わせます。 */
function renderBulk() {
  elements.bulkArea.hidden = shownFlows.length === 0;
  const state = selectAllState(
    shownFlows.map((stored) => stored.id),
    checkedIds,
  );
  elements.selectAll.checked = state === 'all';
  elements.selectAll.indeterminate = state === 'some';
  const count = checkedFlows().length;
  elements.bulkBar.hidden = count === 0;
  elements.bulkCount.textContent = count > 0 ? `${count} 件を選択中` : '';
  if (count === 0) {
    elements.bulkConfirm.replaceChildren();
    elements.bulkConfirm.hidden = true;
  }
}

elements.selectAll.addEventListener('change', () => {
  clearNotices();
  // 閉じたまとまりの中のフローも選びます。まとまりの見出しに選んだ件数を示します。
  for (const stored of shownFlows) {
    if (elements.selectAll.checked) {
      checkedIds.add(stored.id);
    } else {
      checkedIds.delete(stored.id);
    }
  }
  render().catch(console.error);
});

// 選んだフローを 1 つのファイルに書き出します（#27 と同じ形式とファイル名）。
elements.bulkExport.addEventListener('click', () => {
  clearNotices();
  const flows = checkedFlows();
  if (flows.length > 0) {
    downloadFlows(flows.map((stored) => stored.flow));
  }
});

elements.bulkDelete.addEventListener('click', async () => {
  clearNotices();
  const flows = checkedFlows();
  if (flows.length === 0) {
    return;
  }
  const runs = /** @type {{ flowId: string, status: string }[]} */ (
    /** @type {unknown} */ (runStatesFrom(await chrome.storage.session.get(null)))
  );
  const { remove, running } = splitDeletable(
    flows.map((stored) => stored.id),
    runs,
  );
  /** @param {string[]} ids */
  const names = (ids) =>
    flows
      .filter((stored) => ids.includes(stored.id))
      .map((stored) => `・${stored.flow.name}（${stored.flow.origin}）`)
      .join('\n');
  if (remove.length === 0) {
    showNotice(
      elements.bulkNotice,
      '選んだフローはすべて実行中のため、削除できません。実行が終わってから削除してください。',
      'warning',
    );
    return;
  }
  const runningText =
    running.length === 0
      ? ''
      : `\n\n次の ${running.length} 件は実行中のため、削除しません。\n${names(running)}`;
  if (
    !(await confirmInline(elements.bulkConfirm, {
      message: `次の ${remove.length} 件のフローを削除します。元に戻せません。\n${names(remove)}${runningText}`,
      confirmLabel: '削除する',
      danger: true,
    }))
  ) {
    return;
  }
  await deleteFlows(remove);
  for (const id of remove) {
    checkedIds.delete(id);
  }
  if (remove.includes(selectedId)) {
    select('');
  }
  showToast(
    elements.toast,
    `${remove.length} 件のフローを削除しました。` +
      (running.length === 0 ? '' : `実行中の ${running.length} 件は削除しませんでした。`),
  );
});

/**
 * フローを JSON ファイルとして、Chrome のダウンロード先フォルダーに保存します。
 * @param {import('../shared/flow.js').Flow[]} flows
 */
function downloadFlows(flows) {
  const blob = new Blob([flowFileText(flows)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = flowFileName(flows, new Date());
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  // パラメータの既定値に個人の情報を入れている場合に備え、ファイルに含まれることを知らせます。
  showToast(
    elements.toast,
    `${flows.length === 1 ? `「${flows[0].name}」` : `${flows.length} 件のフロー`}をファイルに書き出しました。実行時に入力する値の既定値も含まれます。`,
  );
}

elements.deleteFlow.addEventListener('click', async () => {
  clearNotices();
  const stored = await getFlow(selectedId);
  if (
    !stored ||
    !(await confirmInline(elements.editorConfirm, {
      message: `「${stored.flow.name}」を削除します。元に戻せません。`,
      confirmLabel: '削除する',
      danger: true,
    }))
  ) {
    return;
  }
  await deleteFlow(stored.id);
  select('');
  showToast(elements.toast, `「${stored.flow.name}」を削除しました。`);
});

elements.file.addEventListener('change', async () => {
  const file = elements.file.files?.[0];
  if (file) {
    elements.importJson.value = await file.text();
  }
});

elements.importFormat.addEventListener('click', () =>
  formatJson(elements.importJson, elements.importJsonFeedback, '整形しました。'),
);

elements.importFlow.addEventListener('click', async () => {
  clearNotices();
  const value = parse(elements.importJson, elements.importJsonFeedback);
  if (value === null) {
    return;
  }
  const parsed = parseFlowFile(value);
  if (!parsed.ok) {
    showFieldError(
      elements.importJson,
      elements.importJsonFeedback,
      `形式に誤りがあるため、追加しませんでした。\n${parsed.errors.join('\n')}`,
    );
    return;
  }
  // 保存済みのフローと内容が同じフローは、追加しません（#27）。
  const { fresh: flows, duplicates } = splitDuplicates(parsed.flows, await listFlows());
  const duplicateText =
    duplicates.length === 0
      ? ''
      : `\n\n次の ${duplicates.length} 件は、同じ内容のフローがあるため追加しません。\n` +
        duplicates.map((flow) => `・${flow.name}（${flow.origin}）`).join('\n');
  if (flows.length === 0) {
    showNotice(
      elements.importNotice,
      `${parsed.flows.length === 1 ? 'このフロー' : `${parsed.flows.length} 件のフロー`}はすべて追加済みです。同じ内容のフローがあるため、何も追加しませんでした。`,
      'info',
    );
    return;
  }
  // 他人から受け取ったフローは、ログイン中のサイトで意図しない操作を行う可能性があります（#14）。
  const confirmed = await confirmInline(elements.importConfirm, {
    message:
      (flows.length === 1
        ? `「${flows[0].name}」は ${flows[0].origin} を操作するフローです。` +
          '内容を確認し、信頼できるフローだけを追加してください。'
        : `次の ${flows.length} 件のフローを追加します。各フローは、括弧内のサイトを操作します。` +
          '内容を確認し、信頼できるフローだけを追加してください。\n' +
          flows.map((flow) => `・${flow.name}（${flow.origin}）`).join('\n')) + duplicateText,
    confirmLabel: '追加する',
  });
  if (!confirmed) {
    return;
  }
  const result = await addFlows(flows);
  if (!result.ok) {
    showFieldError(elements.importJson, elements.importJsonFeedback, result.errors.join('\n'));
    return;
  }
  elements.importJson.value = '';
  elements.file.value = '';
  select(result.added[0].id);
  const renamed = result.added.filter(({ name, originalName }) => name !== originalName);
  const skipped =
    duplicates.length === 0 ? '' : `同じ内容の ${duplicates.length} 件は追加しませんでした。`;
  if (renamed.length === 0) {
    showToast(
      elements.toast,
      (flows.length === 1
        ? `「${result.added[0].name}」を追加しました。`
        : `${flows.length} 件のフローを追加しました。`) + skipped,
    );
    return;
  }
  // 追加したフローは詳細の区画で開くため、名前が変わったことはその区画に残します。
  showNotice(
    elements.editorNotice,
    (flows.length === 1 ? '' : `${flows.length} 件のフローを追加しました。`) +
      skipped +
      `同じサイトに同じ名前のフローがあるため、次の名前で追加しました。\n` +
      renamed.map(({ name, originalName }) => `・「${originalName}」→「${name}」`).join('\n'),
    'warning',
  );
});

// ---- 一覧の検索（#42） ----
// 検索欄の入力と一致方法は保存しません。画面を開き直すと、空欄と「部分一致」に戻ります。

/** 折りたたんだまとまりのホスト名です。一覧を作り直しても閉じたままにします。 */
const collapsedHosts = new Set();

/** 候補を作るための、保存したフローの一覧です。一覧を表示するたびに更新します。 */
/** @type {StoredFlow[]} */
let allFlows = [];

elements.searchMode.append(...MATCH_MODES.map(({ value, label }) => new Option(label, value)));

/** @returns {import('../shared/flow-search.js').MatchMode} */
function searchMode() {
  return /** @type {import('../shared/flow-search.js').MatchMode} */ (elements.searchMode.value);
}

attachCombobox(elements.search, elements.searchSuggestions, {
  getOptions: () =>
    suggestions(allFlows, elements.search.value, searchMode()).map(({ value, kind }) => ({
      value,
      note: kind === 'flow' ? 'フロー' : 'サイト',
    })),
  onSelect: () => render().catch(console.error),
});

elements.search.addEventListener('input', () => {
  render().catch(console.error);
});

elements.searchMode.addEventListener('change', () => {
  render().catch(console.error);
});

onFlowsChanged(() => {
  render().catch(console.error);
  renderStopRules().catch(console.error);
});
render().catch(console.error);

// ---- 実行の速度（#15） ----

/**
 * 実行の速度の欄に、フローの手順の間隔を入れます。指定がない場合は空欄にします（既定の 1 秒）。
 * @param {import('../shared/flow.js').Flow} flow
 */
function fillSpeedFields(flow) {
  elements.intervalMin.value = flow.interval ? formatSeconds(flow.interval.min) : '';
  elements.intervalMax.value = flow.interval ? formatSeconds(flow.interval.max) : '';
  clearSpeedError();
}

/** 実行の速度の誤りを消します。2 つの欄で、行の直下の表示欄を共有しています。 */
function clearSpeedError() {
  showFieldError(elements.intervalMin, elements.intervalFeedback, '');
  showFieldError(elements.intervalMax, elements.intervalFeedback, '');
}

elements.intervalMin.addEventListener('input', clearSpeedError);
elements.intervalMax.addEventListener('input', clearSpeedError);

elements.speedForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotices();
  const input = readIntervalInput(elements.intervalMin.value, elements.intervalMax.value);
  if (!input.ok) {
    const control = input.field === 'min' ? elements.intervalMin : elements.intervalMax;
    showFieldError(control, elements.intervalFeedback, input.error);
    control.focus();
    return;
  }
  const { interval } = input;
  const result = await setFlowInterval(selectedId, interval);
  if (!result.ok) {
    showNotice(
      elements.speedNotice,
      `保存できませんでした。\n${result.errors.join('\n')}`,
      'error',
    );
    return;
  }
  fillSpeedFields(result.flow);
  // JSON の編集欄は読み込み直さず、版番号と間隔だけを書き換えます。保存していない編集を失わないためです（#53）。
  const replaced = replaceJsonFields(elements.json.value, {
    schemaVersion: result.flow.schemaVersion,
    interval: result.flow.interval,
  });
  if (replaced === null) {
    showNotice(
      elements.jsonNotice,
      'JSON の編集欄を読み取れないため、編集欄の速度は書き換えていません。［JSON を保存］を押すと、速度は編集欄の内容に戻ります。',
      'warning',
    );
  } else {
    elements.json.value = replaced;
  }
  showToast(
    elements.toast,
    interval
      ? interval.min === interval.max
        ? `手順の間隔を ${formatSeconds(interval.min)} 秒にしました。`
        : `手順の間隔を ${formatSeconds(interval.min)}〜${formatSeconds(interval.max)} 秒にしました。`
      : '手順の間隔を既定の 1 秒に戻しました。',
  );
});

// ---- 実行履歴（#19） ----
// 履歴は Service Worker が実行の終わりに記録します。この画面は表示と CSV への書き出しを行い、
// 削除（#75）は Service Worker に依頼します。記録と削除の書き込みを、同じ待ち行列で順に行うためです。

onHistoryChanged(() => {
  renderHistory().catch(console.error);
});
renderHistory().catch(console.error);

elements.historyCsv.addEventListener('click', async () => {
  clearNotices();
  const history = await listHistory();
  const blob = new Blob([historyToCsv(history)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lightomate-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

elements.historyClear.addEventListener('click', async () => {
  clearNotices();
  const runIds = (await listHistory()).map((entry) => entry.runId);
  if (runIds.length === 0) {
    return;
  }
  // 確認の後に記録された履歴は、利用者が見ていないため削除しません。確認を出した時点の履歴だけを削除します。
  if (
    !(await confirmInline(elements.historyConfirm, {
      message: `実行履歴 ${runIds.length} 件をすべて削除します。元に戻せません。保存したファイルは削除しません。`,
      confirmLabel: '削除する',
      danger: true,
    }))
  ) {
    return;
  }
  if (await removeHistoryEntries(runIds)) {
    showToast(elements.toast, `実行履歴 ${runIds.length} 件を削除しました。`);
  }
});

/**
 * 実行履歴の削除を Service Worker に依頼します。削除できなかった場合は、見出しの帯の直下に知らせます。
 * @param {string[]} runIds
 * @returns {Promise<boolean>} 削除できたか
 */
async function removeHistoryEntries(runIds) {
  const response = await chrome.runtime.sendMessage({ kind: 'history/remove', runIds });
  if (!response?.ok) {
    showNotice(
      elements.historyNotice,
      `実行履歴を削除できませんでした。\n${response?.error ?? ''}`.trim(),
      'error',
    );
    return false;
  }
  return true;
}

/** 実行履歴の一覧を表示し直します。 */
async function renderHistory() {
  const history = await listHistory();
  elements.historyCount.textContent = history.length > 0 ? String(history.length) : '';
  elements.historyEmpty.hidden = history.length > 0;
  elements.historyTableWrap.hidden = history.length === 0;
  elements.historyCsv.toggleAttribute('disabled', history.length === 0);
  elements.historyClear.toggleAttribute('disabled', history.length === 0);
  elements.history.replaceChildren(
    ...history.map((entry) => {
      const started = document.createElement('td');
      started.className = 'lm-nowrap';
      started.textContent = formatDateTime(entry.startedAt);
      const ended = document.createElement('div');
      ended.className = 'lm-sub';
      ended.textContent = `終了 ${formatDateTime(entry.endedAt)}`;
      started.append(ended);

      const flow = document.createElement('td');
      const name = document.createElement('div');
      name.textContent = entry.flowName;
      const origin = document.createElement('div');
      origin.className = 'lm-sub';
      origin.textContent = entry.origin;
      flow.append(name, origin);

      const status = document.createElement('td');
      status.className = `lm-nowrap lm-status-${entry.status}`;
      status.textContent = STATUS_LABELS[entry.status];

      const reason = document.createElement('td');
      if (entry.stepNumber !== undefined) {
        const step = document.createElement('div');
        step.textContent = `手順 ${stepText(entry)}`;
        reason.append(step);
      }
      if (entry.reason) {
        const text = document.createElement('div');
        text.className = 'lm-sub';
        text.textContent = entry.reason;
        reason.append(text);
      }

      const files = document.createElement('td');
      files.className = 'lm-sub';
      files.textContent = entry.files.join('\n');

      // 行ごとに同じ「×」が並ぶため、読み上げでは対象の日時とフロー名を示します。1 件ずつの削除は確認しません。
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-sm btn-ghost-secondary lm-history-remove';
      remove.textContent = '×';
      remove.title = 'この履歴を削除';
      remove.setAttribute(
        'aria-label',
        `${formatDateTime(entry.startedAt)} の「${entry.flowName}」の履歴を削除`,
      );
      remove.addEventListener('click', async () => {
        clearNotices();
        if (await removeHistoryEntries([entry.runId])) {
          showToast(elements.toast, `「${entry.flowName}」の履歴を削除しました。`);
        }
      });
      const actions = document.createElement('td');
      actions.className = 'lm-nowrap';
      actions.append(remove);

      const row = document.createElement('tr');
      row.append(started, flow, status, reason, files, actions);
      return row;
    }),
  );
}

// ---- 必ず止まる場所（#54） ----

elements.stopForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearNotices();
  onSaveStopRule().catch((error) => showNotice(elements.stopNotice, String(error), 'error'));
});

elements.stopClear.addEventListener('click', () => {
  clearNotices();
  editStopRule('', { selectors: [], paths: [] });
});

elements.stopDelete.addEventListener('click', () => {
  clearNotices();
  onDeleteStopRule().catch((error) => showNotice(elements.stopNotice, String(error), 'error'));
});

// 入力欄の誤りは、その欄を直し始めたときに消します。
for (const [control, feedback] of fieldFeedbacks) {
  control.addEventListener('input', () => showFieldError(control, feedback, ''));
}

onStopRulesChanged(() => {
  renderStopRules().catch(console.error);
});
renderStopRules().catch(console.error);

/** 入力欄の指定を検証し、保存します。 */
async function onSaveStopRule() {
  const origin = elements.stopOrigin.value.trim().replace(/\/+$/, '');
  if (!isWebOrigin(origin)) {
    showFieldError(
      elements.stopOrigin,
      elements.stopOriginFeedback,
      'サイトは https:// または http:// で始まるオリジン（例：https://www.amazon.co.jp）で入力してください。',
    );
    elements.stopOrigin.focus();
    return;
  }
  showFieldError(elements.stopOrigin, elements.stopOriginFeedback, '');
  const rule = {
    selectors: parseLines(elements.stopSelectors.value),
    paths: parseLines(elements.stopPaths.value),
  };
  const errors = stopRuleFieldErrors(rule);
  errors.selectors.push(...selectorSyntaxErrors(rule.selectors));
  showFieldError(
    elements.stopSelectors,
    elements.stopSelectorsFeedback,
    errors.selectors.join('\n'),
  );
  showFieldError(elements.stopPaths, elements.stopPathsFeedback, errors.paths.join('\n'));
  if (errors.selectors.length > 0) {
    elements.stopSelectors.focus();
    return;
  }
  if (errors.paths.length > 0) {
    elements.stopPaths.focus();
    return;
  }
  const removing = rule.selectors.length === 0 && rule.paths.length === 0;
  if (
    removing &&
    !(await confirmInline(elements.stopConfirm, {
      message: `要素と画面の指定が空のため、${origin} の指定を削除します。元に戻せません。`,
      confirmLabel: '削除する',
      danger: true,
    }))
  ) {
    return;
  }
  const result = await saveStopRule(origin, rule);
  if (!result.ok) {
    showNotice(elements.stopNotice, `保存できませんでした。\n${result.errors.join('\n')}`, 'error');
    return;
  }
  elements.stopOrigin.value = origin;
  showToast(
    elements.toast,
    removing ? `${origin} の指定を削除しました。` : `${origin} の指定を保存しました。`,
  );
}

/** 入力欄のサイトの指定を削除します。削除の前に確認を表示します。 */
async function onDeleteStopRule() {
  const origin = elements.stopOrigin.value.trim().replace(/\/+$/, '');
  const exists = (await listStopRules()).some((entry) => entry.origin === origin);
  if (!exists) {
    showFieldError(
      elements.stopOrigin,
      elements.stopOriginFeedback,
      origin
        ? `${origin} の指定はありません。削除するサイトを一覧から選んでください。`
        : '削除するサイトを一覧から選んでください。',
    );
    elements.stopOrigin.focus();
    return;
  }
  if (
    !(await confirmInline(elements.stopConfirm, {
      message: `${origin} の指定を削除します。元に戻せません。`,
      confirmLabel: '削除する',
      danger: true,
    }))
  ) {
    return;
  }
  const result = await saveStopRule(origin, { selectors: [], paths: [] });
  if (!result.ok) {
    showNotice(elements.stopNotice, `削除できませんでした。\n${result.errors.join('\n')}`, 'error');
    return;
  }
  editStopRule('', { selectors: [], paths: [] });
  showToast(elements.toast, `${origin} の指定を削除しました。`);
}

/**
 * CSS セレクターの構文を確かめます。誤りのある指定は、実行時に一致しないまま飛ばされるためです。
 * @param {string[]} selectors
 * @returns {string[]}
 */
function selectorSyntaxErrors(selectors) {
  const probe = document.createDocumentFragment();
  return selectors.flatMap((selector) => {
    try {
      probe.querySelector(selector);
      return [];
    } catch {
      return [`止める要素の「${selector}」は、CSS セレクターとして読み取れません。`];
    }
  });
}

/**
 * 指定を入力欄に表示します。
 * @param {string} origin
 * @param {{ selectors: string[], paths: string[] }} rule
 */
function editStopRule(origin, rule) {
  for (const [control, feedback] of fieldFeedbacks) {
    showFieldError(control, feedback, '');
  }
  elements.stopOrigin.value = origin;
  elements.stopSelectors.value = rule.selectors.join('\n');
  elements.stopPaths.value = rule.paths.join('\n');
  elements.stopOrigin.focus();
}

/** 指定のあるサイトの一覧と、入力候補のサイトを表示し直します。 */
async function renderStopRules() {
  const rules = await listStopRules();
  elements.stopEmpty.hidden = rules.length > 0;
  elements.stopList.replaceChildren(
    ...rules.map(({ origin, rule }) => {
      const count = document.createElement('div');
      count.className = 'lm-sub';
      count.textContent = `要素 ${rule.selectors.length} 件・画面 ${rule.paths.length} 件`;
      const button = listButton(origin, count);
      button.addEventListener('click', () => {
        clearNotices();
        getStopRule(origin)
          .then((current) => editStopRule(origin, current))
          .catch(console.error);
      });
      return button;
    }),
  );

  // 保存したフローのサイトを、入力の候補にします。
  const origins = new Set([
    ...(await listFlows()).map((stored) => stored.flow.origin),
    ...rules.map(({ origin }) => origin),
  ]);
  elements.stopOrigins.replaceChildren(
    ...[...origins].sort().map((origin) => new Option(origin, origin)),
  );
}

/**
 * 編集するフローを選びます。空の文字列の場合は、どれも選びません。
 * @param {string} id
 */
function select(id) {
  selectedId = id;
  history.replaceState(null, '', id ? `#${encodeURIComponent(id)}` : location.pathname);
  elements.importer.hidden = true;
  // 別のフローを選んだら、前のフローへの確認と誤りの表示を消します。
  for (const container of [elements.importConfirm, elements.editorConfirm]) {
    container.replaceChildren();
    container.hidden = true;
  }
  clearNotices();
  showRenameForm(false);
  hideRunForm();
  // 別のフローを選んだら、JSON の編集欄は閉じ、内容の表示から見せます。
  elements.jsonDetails.open = false;
  render().catch(console.error);
}

/** 一覧と詳細を表示し直します。 */
async function render() {
  const flows = await listFlows();
  elements.empty.hidden = flows.length > 0;
  elements.flowCount.textContent = flows.length > 0 ? String(flows.length) : '';
  allFlows = flows;
  elements.searchArea.hidden = flows.length === 0;
  const query = elements.search.value;
  shownFlows = filterFlows(flows, query, searchMode());
  checkedIds = pruneSelection(
    checkedIds,
    shownFlows.map((stored) => stored.id),
  );
  const groups = groupByHost(shownFlows);
  elements.noMatch.hidden = flows.length === 0 || groups.length > 0;
  // 作り直す前に、フォーカスのあった行のチェックボックスを控えます。押した直後に作り直すためです。
  const focusedId =
    document.activeElement instanceof HTMLInputElement
      ? document.activeElement.dataset.flowId
      : undefined;
  elements.flows.replaceChildren(
    ...buildFlowGroups(document, groups, {
      renderItem: flowListItem,
      note: (items) => {
        const count = items.filter((stored) => checkedIds.has(stored.id)).length;
        return count > 0 ? `・${count} 件選択` : '';
      },
      // 検索中は、該当するフローが見えるよう、すべてのまとまりを開きます。
      isOpen: (host) => query.trim() !== '' || !collapsedHosts.has(host),
      onToggle: (host, open) => {
        if (query.trim() !== '') {
          return;
        }
        if (open) {
          collapsedHosts.delete(host);
        } else {
          collapsedHosts.add(host);
        }
      },
    }),
  );
  if (focusedId !== undefined) {
    const input = elements.flows.querySelector(`input[data-flow-id="${CSS.escape(focusedId)}"]`);
    if (input instanceof HTMLInputElement) {
      input.focus();
    }
  }
  renderBulk();

  const stored = selectedId ? await getFlow(selectedId) : undefined;
  elements.editor.hidden = !stored;
  elements.placeholder.hidden = Boolean(stored) || !elements.importer.hidden;
  if (stored && elements.editor.dataset.id !== stored.id) {
    // 編集中の内容を上書きしないよう、別のフローを選んだときだけ JSON を入れ替えます。
    elements.editor.dataset.id = stored.id;
    elements.json.value = JSON.stringify(orderFlow(stored.flow), null, 2);
    fillSpeedFields(stored.flow);
  }
  if (stored) {
    renderDetail(stored);
    await renderRunButtons(stored.flow);
  } else {
    delete elements.editor.dataset.id;
  }
}

/**
 * 選んだフローの内容（名前、サイト、実行時に入力する値、手順）を表示します。
 * JSON を読まなくても、フローが何をするかがわかるようにするためです。
 * @param {StoredFlow} stored
 */
function renderDetail({ flow, createdAt, updatedAt }) {
  elements.editorHeading.textContent = flow.name;
  elements.editorOrigin.textContent = flow.origin;

  const params = flow.params ?? [];
  const secrets = flow.steps.flatMap((step, index) =>
    step.type === 'input' && step.secret ? [{ step, index }] : [],
  );
  const inputs = params.length + secrets.length;
  elements.editorMeta.textContent = [
    `手順 ${flow.steps.length} 件`,
    inputs > 0 ? `実行時に入力 ${inputs} 項目` : '',
    `作成 ${formatDateTime(createdAt)}`,
    `更新 ${formatDateTime(updatedAt)}`,
  ]
    .filter(Boolean)
    .join('・');

  elements.paramsSection.hidden = inputs === 0;
  elements.params.replaceChildren(
    ...params.flatMap((param) => definition(param.label, describeParam(param))),
    ...secrets.flatMap(({ step, index }) =>
      definition(
        `${step.type === 'input' ? step.target.label : ''}（手順 ${index + 1}）`,
        '値は記録していません。実行するときに入力します',
      ),
    ),
  );

  elements.stepCount.textContent = String(flow.steps.length);
  elements.steps.replaceChildren(
    ...flow.steps.map((step) => {
      const kind = document.createElement('span');
      kind.className = 'lm-kind';
      kind.textContent = stepKindLabel(step);
      const text = document.createElement('span');
      text.className = 'lm-step-text';
      // 種類は前に表示しているため、説明の先頭の「クリック：」などは省きます。
      const description = describeStep(step);
      text.textContent = description.includes('：')
        ? description.replace(/^[^：]+：/, '')
        : 'ここで止まります。続きは人が操作します。';
      const item = document.createElement('li');
      item.className = step.type === 'pause' ? 'lm-step lm-step-pause' : 'lm-step';
      item.append(kind, text);
      return item;
    }),
  );
}

/**
 * 実行時に入力する値の一覧の、1 項目（名前と説明）です。
 * @param {string} term
 * @param {string} description
 * @returns {HTMLElement[]}
 */
function definition(term, description) {
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = description;
  return [dt, dd];
}

/**
 * フローの一覧の 1 行です。左端に選ぶためのチェックボックス、その右に詳細を開くボタンを置きます（#83）。
 * ボタンの中にはチェックボックスを置けないため、2 つに分けます。
 * @param {StoredFlow} stored
 * @returns {HTMLDivElement}
 */
function flowListItem(stored) {
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'lm-check lm-flow-check';
  check.checked = checkedIds.has(stored.id);
  check.dataset.flowId = stored.id;
  check.setAttribute('aria-label', `「${stored.flow.name}」を選択`);
  check.addEventListener('change', () => {
    clearNotices();
    if (check.checked) {
      checkedIds.add(stored.id);
    } else {
      checkedIds.delete(stored.id);
    }
    render().catch(console.error);
  });

  const detail = document.createElement('div');
  detail.className = 'lm-sub';
  detail.textContent = `手順 ${stored.flow.steps.length} 件・更新 ${formatDateTime(stored.updatedAt)}`;
  const button = listButton(stored.flow.name, detail);
  button.className = 'list-group-item-action lm-flow-open';
  button.addEventListener('click', () => select(stored.id));

  const row = document.createElement('div');
  row.className = 'list-group-item lm-flow-row';
  const current = stored.id === selectedId;
  row.classList.toggle('active', current);
  if (current) {
    button.setAttribute('aria-current', 'true');
  }
  row.append(check, button);
  return row;
}

/**
 * 一覧の 1 行のボタンです。
 * @param {string} title
 * @param {HTMLElement} detail
 * @returns {HTMLButtonElement}
 */
function listButton(title, detail) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'list-group-item list-group-item-action';
  const name = document.createElement('div');
  name.className = 'lm-item-name';
  name.textContent = title;
  button.append(name, detail);
  return button;
}

/**
 * JSON を読み取ります。誤りがある場合は、その内容を編集欄の直下に表示して null を返します。
 * 誤りの対象は編集欄そのものであるため、ほかの入力欄の誤りと同じく、入力欄の直下に出します。
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} feedback 編集欄の直後に置いた、誤りを表示する要素
 * @returns {unknown}
 */
function parse(textarea, feedback) {
  try {
    const value = JSON.parse(textarea.value);
    showFieldError(textarea, feedback, '');
    return value;
  } catch (error) {
    showFieldError(textarea, feedback, `JSON として読み取れません。${String(error)}`);
    return null;
  }
}

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`#${id} が見つかりません。`);
  }
  return element;
}
