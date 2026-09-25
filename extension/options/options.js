// フローの管理画面です。保存したフローの内容の表示、最初のページを開く操作と実行、名前の変更、
// 書き出し、削除、JSON の編集と、
// JSON からの追加、サイトごとの「必ず止まる場所」の指定を行います。2 つはタブで分けています。
// ビジュアルエディタ（#9）ができるまでは、手順の変更は JSON を直接編集して行います。
// 配置と、知らせを出す場所は docs/design-guidelines.md に従います。成功は画面の上部のトーストに出し、
// 誤り・警告・確認は押したボタンの直下に出します。

import {
  deleteFlow,
  getFlow,
  listFlows,
  onFlowsChanged,
  renameFlow,
  saveFlow,
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
import { isWebOrigin, orderFlow, replaceJsonName, validateFlow } from '../shared/flow.js';
import { conflictMessage, findConflictingRun, runStatesFrom } from '../shared/flow-list.js';
import { attachCombobox } from '../shared/combobox.js';
import { buildFlowGroups } from '../shared/flow-groups.js';
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
  params: byId('params'),
  stepCount: byId('step-count'),
  steps: byId('steps'),
  jsonDetails: /** @type {HTMLDetailsElement} */ (byId('json-details')),
  jsonNotice: byId('json-notice'),
  jsonFeedback: byId('json-feedback'),
  json: /** @type {HTMLTextAreaElement} */ (byId('json')),
  save: byId('save'),
  exportFlow: byId('export'),
  deleteFlow: byId('delete'),
  importer: byId('importer'),
  importConfirm: byId('import-confirm'),
  file: /** @type {HTMLInputElement} */ (byId('file')),
  importJson: /** @type {HTMLTextAreaElement} */ (byId('import-json')),
  importJsonFeedback: byId('import-json-feedback'),
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
};

/** 区画に置いた知らせの表示欄です。次の操作を始めるときに、まとめて消します。 */
const notices = [
  elements.editorNotice,
  elements.runNotice,
  elements.jsonNotice,
  elements.stopNotice,
];

/**
 * 入力欄と、その直下に置いた誤りの表示欄の組み合わせです。次の操作を始めるときに、まとめて消します。
 * @type {Array<[HTMLInputElement | HTMLTextAreaElement, HTMLElement]>}
 */
const fieldFeedbacks = [
  [elements.json, elements.jsonFeedback],
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
  if (!stored) {
    return;
  }
  const blob = new Blob([JSON.stringify(stored.flow, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lightomate-${stored.flow.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

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

elements.importFlow.addEventListener('click', async () => {
  clearNotices();
  const flow = parse(elements.importJson, elements.importJsonFeedback);
  if (!flow) {
    return;
  }
  const errors = validateFlow(flow);
  if (errors.length > 0) {
    showFieldError(
      elements.importJson,
      elements.importJsonFeedback,
      `形式に誤りがあるため、追加しませんでした。\n${errors.join('\n')}`,
    );
    return;
  }
  const { name, origin } = /** @type {{ name: string, origin: string }} */ (flow);
  // 他人から受け取ったフローは、ログイン中のサイトで意図しない操作を行う可能性があります（#14）。
  const confirmed = await confirmInline(elements.importConfirm, {
    message:
      `「${name}」は ${origin} を操作するフローです。` +
      '内容を確認し、信頼できるフローだけを追加してください。',
    confirmLabel: '追加する',
  });
  if (!confirmed) {
    return;
  }
  const result = await saveFlow(flow);
  if (!result.ok) {
    showFieldError(elements.importJson, elements.importJsonFeedback, result.errors.join('\n'));
    return;
  }
  elements.importJson.value = '';
  elements.file.value = '';
  select(result.id);
  if (result.name === name) {
    showToast(elements.toast, `「${name}」を追加しました。`);
    return;
  }
  // 追加したフローは詳細の区画で開くため、名前が変わったことはその区画に残します。
  showNotice(
    elements.editorNotice,
    `同じサイトに「${name}」があるため、「${result.name}」として追加しました。`,
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

// ---- 実行履歴（#19） ----
// 履歴は Service Worker が実行の終わりに記録します。この画面は表示と CSV への書き出しだけを行います。

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

/** 実行履歴の一覧を表示し直します。 */
async function renderHistory() {
  const history = await listHistory();
  elements.historyCount.textContent = history.length > 0 ? String(history.length) : '';
  elements.historyEmpty.hidden = history.length > 0;
  elements.historyTableWrap.hidden = history.length === 0;
  elements.historyCsv.toggleAttribute('disabled', history.length === 0);
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

      const row = document.createElement('tr');
      row.append(started, flow, status, reason, files);
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
  const groups = groupByHost(filterFlows(flows, query, searchMode()));
  elements.noMatch.hidden = flows.length === 0 || groups.length > 0;
  elements.flows.replaceChildren(
    ...buildFlowGroups(document, groups, {
      renderItem: flowListItem,
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

  const stored = selectedId ? await getFlow(selectedId) : undefined;
  elements.editor.hidden = !stored;
  elements.placeholder.hidden = Boolean(stored) || !elements.importer.hidden;
  if (stored && elements.editor.dataset.id !== stored.id) {
    // 編集中の内容を上書きしないよう、別のフローを選んだときだけ JSON を入れ替えます。
    elements.editor.dataset.id = stored.id;
    elements.json.value = JSON.stringify(orderFlow(stored.flow), null, 2);
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
 * フローの一覧の 1 行です。
 * @param {StoredFlow} stored
 * @returns {HTMLButtonElement}
 */
function flowListItem(stored) {
  const detail = document.createElement('div');
  detail.className = 'lm-sub';
  detail.textContent = `手順 ${stored.flow.steps.length} 件・更新 ${formatDateTime(stored.updatedAt)}`;
  const button = listButton(stored.flow.name, detail);
  const current = stored.id === selectedId;
  button.classList.toggle('active', current);
  if (current) {
    button.setAttribute('aria-current', 'true');
  }
  button.addEventListener('click', () => select(stored.id));
  return button;
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
