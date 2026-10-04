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
import { deleteBatch, listBatches, onBatchesChanged, saveBatch } from '../common/batch-store.js';
import { ALL_SITES, hasAllSites, requestPermission } from '../common/permissions.js';
import { batchProblems } from '../shared/batch.js';
import { exportBackup, previewRestore, restoreBackup } from '../common/backup-store.js';
import { backupFileName, parseBackup } from '../shared/backup.js';
import {
  getStopRule,
  listStopRules,
  onStopRulesChanged,
  saveStopRule,
} from '../common/stop-rules-store.js';
import { listHistory, onHistoryChanged } from '../common/history-store.js';
import { formatDateTime, paramColumns, skippedText } from '../shared/describe.js';
import { flattenSteps } from '../shared/control-flow.js';
import { createBlockEditor } from './block-editor.js';
import { paramFieldset, readParamRows, showParamRowErrors } from './param-form.js';
import {
  describeParamSaveErrors,
  paramRowErrors,
  paramsFromRows,
  renameParamReferences,
  rowsFromParams,
} from '../shared/param-edit.js';
import {
  flowOrigins,
  formatFlowJson,
  isWebOrigin,
  isWebUrl,
  orderFlow,
  replaceJsonFields,
  replaceJsonName,
  withSteps,
} from '../shared/flow.js';
import { conflictMessage, findConflictingRun, runStatesFrom } from '../shared/flow-list.js';
import { attachCombobox } from '../shared/combobox.js';
import { flowFileName, flowFileText, parseFlowFile, splitDuplicates } from '../shared/flow-file.js';
import { buildFlowGroups } from '../shared/flow-groups.js';
import { pruneSelection, selectAllState, splitDeletable } from '../shared/flow-selection.js';
import {
  MATCH_MODES,
  batchSuggestions,
  filterBatches,
  filterFlows,
  groupByHost,
  suggestions,
} from '../shared/flow-search.js';
import {
  NO_FIRST_PAGE,
  batchFirstPageUrls,
  buildRunFields,
  fieldEntries,
  firstPageParams,
  firstPageUrl,
  readRunFields,
  secretStepIndexes,
  showRunFieldErrors,
} from '../shared/run-form.js';
import {
  STATUS_LABELS,
  STATUS_TONES,
  historyEntryText,
  historyToCsv,
  stepText,
} from '../shared/history.js';
import { formatSeconds, readIntervalInput } from '../shared/speed.js';
import {
  SCHEDULES_KEY,
  listSchedules,
  removeSchedule,
  saveSchedule,
} from '../common/schedule-store.js';
import {
  WEEKDAY_NAMES,
  describeSchedule,
  formatRunAt,
  nextRunAt,
  readScheduleInput,
  schedulingProblems,
  schedulingRemedies,
} from '../shared/schedule.js';
import { parseLines, stopRuleFieldErrors } from '../shared/stop-rules.js';
import {
  confirmInline,
  followColorScheme,
  showFieldError,
  showNotice,
  showToast,
} from '../shared/ui.js';

/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */
/** @typedef {import('../common/batch-store.js').StoredBatch} StoredBatch */

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
  editor: byId('editor'),
  editorHeading: byId('editor-heading'),
  editorOrigin: byId('editor-origin'),
  editorMeta: byId('editor-meta'),
  editorTitle: byId('editor-title'),
  editorActions: byId('editor-actions'),
  more: /** @type {HTMLButtonElement} */ (byId('more')),
  editorMore: byId('editor-more'),
  editorConfirm: byId('editor-confirm'),
  editorNotice: byId('editor-notice'),
  openFirst: /** @type {HTMLButtonElement} */ (byId('open-first')),
  run: /** @type {HTMLButtonElement} */ (byId('run')),
  runReason: byId('run-reason'),
  runReasonText: byId('run-reason-text'),
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
  speedForm: /** @type {HTMLFormElement} */ (byId('speed-form')),
  intervalMin: /** @type {HTMLInputElement} */ (byId('interval-min')),
  intervalMax: /** @type {HTMLInputElement} */ (byId('interval-max')),
  intervalFeedback: byId('interval-feedback'),
  speedNotice: byId('speed-notice'),
  scheduleForm: /** @type {HTMLFormElement} */ (byId('schedule-form')),
  scheduleState: byId('schedule-state'),
  scheduleSummary: byId('schedule-summary'),
  scheduleReason: byId('schedule-reason'),
  scheduleReasonBody: byId('schedule-reason-body'),
  scheduleFrequency: /** @type {HTMLSelectElement} */ (byId('schedule-frequency')),
  scheduleWeekday: /** @type {HTMLSelectElement} */ (byId('schedule-weekday')),
  scheduleDayField: byId('schedule-day-field'),
  scheduleDay: /** @type {HTMLInputElement} */ (byId('schedule-day')),
  scheduleTime: /** @type {HTMLInputElement} */ (byId('schedule-time')),
  scheduleCatchUp: /** @type {HTMLInputElement} */ (byId('schedule-catch-up')),
  scheduleFeedback: byId('schedule-feedback'),
  scheduleSave: /** @type {HTMLButtonElement} */ (byId('schedule-save')),
  scheduleNotice: byId('schedule-notice'),
  params: byId('params'),
  paramsBody: byId('params-body'),
  paramsEmpty: byId('params-empty'),
  paramsButtons: byId('params-buttons'),
  paramsEdit: /** @type {HTMLButtonElement} */ (byId('params-edit')),
  paramsEditNotice: byId('params-edit-notice'),
  paramsForm: /** @type {HTMLFormElement} */ (byId('params-form')),
  paramsRows: byId('params-rows'),
  paramsAdd: /** @type {HTMLButtonElement} */ (byId('params-add')),
  paramsCancel: /** @type {HTMLButtonElement} */ (byId('params-cancel')),
  paramsNotice: byId('params-notice'),
  stepCount: byId('step-count'),
  blocks: byId('blocks'),
  blocksSave: /** @type {HTMLButtonElement} */ (byId('blocks-save')),
  blocksRevert: /** @type {HTMLButtonElement} */ (byId('blocks-revert')),
  blocksUnsaved: byId('blocks-unsaved'),
  blocksNotice: byId('blocks-notice'),
  blocksPickNotice: byId('blocks-pick-notice'),
  blocksValues: byId('blocks-values'),
  blocksValuesTitle: byId('blocks-values-title'),
  blocksValuesFields: byId('blocks-values-fields'),
  blocksValuesFieldOptions: byId('blocks-values-field-options'),
  blocksValuesList: byId('blocks-values-list'),
  blocksValuesClose: /** @type {HTMLButtonElement} */ (byId('blocks-values-close')),
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
  bulkBatch: byId('bulk-batch'),
  bulkButtons: byId('bulk-buttons'),
  importButtons: byId('import-buttons'),
  stopButtons: byId('stop-buttons'),
  historyButtons: byId('history-buttons'),
  batchForm: /** @type {HTMLFormElement} */ (byId('batch-form')),
  batchName: /** @type {HTMLInputElement} */ (byId('batch-name')),
  batchNameFeedback: byId('batch-name-feedback'),
  batchOrder: byId('batch-order'),
  batchCancel: byId('batch-cancel'),
  batchNotice: byId('batch-notice'),
  batchCount: byId('batch-count'),
  batchEmpty: byId('batch-empty'),
  batchNoMatch: byId('batch-no-match'),
  batchSearchArea: byId('batch-search-area'),
  batchSearch: /** @type {HTMLInputElement} */ (byId('batch-search')),
  batchSearchSuggestions: byId('batch-search-suggestions'),
  batchSearchMode: /** @type {HTMLSelectElement} */ (byId('batch-search-mode')),
  batchList: byId('batch-list'),
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
  allSites: /** @type {HTMLInputElement} */ (byId('all-sites')),
  allSitesNotice: byId('all-sites-notice'),
  backupFile: /** @type {HTMLInputElement} */ (byId('backup-file')),
  backupButtons: byId('backup-buttons'),
  backupExport: byId('backup-export'),
  backupRestore: byId('backup-restore'),
  backupConfirm: byId('backup-confirm'),
  backupNotice: byId('backup-notice'),
};

/** 区画に置いた知らせの表示欄です。次の操作を始めるときに、まとめて消します。 */
const notices = [
  elements.flowsNotice,
  elements.bulkNotice,
  elements.batchNotice,
  elements.importNotice,
  elements.editorNotice,
  elements.runNotice,
  elements.jsonNotice,
  elements.stopNotice,
  elements.historyNotice,
  elements.speedNotice,
  elements.scheduleNotice,
  elements.allSitesNotice,
  elements.backupNotice,
  elements.blocksNotice,
  elements.blocksPickNotice,
  elements.paramsEditNotice,
  elements.paramsNotice,
];

/**
 * 入力欄と、その直下に置いた誤りの表示欄の組み合わせです。次の操作を始めるときに、まとめて消します。
 * @type {Array<[HTMLInputElement | HTMLTextAreaElement, HTMLElement]>}
 */
const fieldFeedbacks = [
  [elements.json, elements.jsonFeedback],
  [elements.batchName, elements.batchNameFeedback],
  [elements.intervalMin, elements.intervalFeedback],
  [elements.intervalMax, elements.intervalFeedback],
  [elements.scheduleDay, elements.scheduleFeedback],
  [elements.scheduleTime, elements.scheduleFeedback],
  [elements.importJson, elements.importJsonFeedback],
  [elements.stopOrigin, elements.stopOriginFeedback],
  [elements.stopSelectors, elements.stopSelectorsFeedback],
  [elements.stopPaths, elements.stopPathsFeedback],
];

/** 編集中のフローの id です。URL の # 以降にも書き、再読み込みしても同じフローを開きます。 */
let selectedId = decodeURIComponent(location.hash.slice(1));

// ---- 手順のブロック（#9） ----

/** ［手順］タブのブロックの編集画面です。 */
const blockEditor = createBlockEditor(elements.blocks, {
  onChange: updateBlockButtons,
  onPick: (blockId, field) => {
    startPick(blockId, field).catch((error) =>
      showNotice(elements.blocksPickNotice, String(error), 'error'),
    );
  },
  onInsert: (blockId) => {
    openValues(blockId).catch((error) =>
      showNotice(elements.blocksPickNotice, String(error), 'error'),
    );
  },
});

/** 表示しているフローです。要素の選択モード（#139）で、開くサイトを決めるのに使います。 */
/** @type {import('../shared/flow.js').Flow | null} */
let shownFlow = null;

/**
 * ブロックに表示している手順（保存済みの内容）です。JSON の文字列で持ち、保存済みのフローと比べて、
 * ほかの場所（［JSON］タブなど）で手順が変わったかを判定します。
 */
let loadedSteps = '';

/** ［JSON］タブの編集欄に、保存していない変更があるかです。 */
let jsonDirty = false;

elements.json.addEventListener('input', () => {
  jsonDirty = true;
});

/**
 * 保存していない変更の有無に合わせて、［手順を保存］［変更を取り消す］を押せるようにし、未保存の表示を出します。
 * @param {boolean} dirty
 */
function updateBlockButtons(dirty) {
  elements.blocksSave.disabled = !dirty;
  elements.blocksRevert.disabled = !dirty;
  elements.blocksUnsaved.hidden = !dirty;
}

// ---- ページで要素を選ぶ（#139） ----

/**
 * 選択モードで選んでいる途中のブロックです。結果が届いたら、このブロックに入れます。
 * @type {{ blockId: string, field: 'TARGET' | 'NEXT', requestId: string } | null}
 */
let pendingPick = null;

/**
 * 要素の選択モードを始めます。フローのサイトのタブで利用者が要素を押すと、結果が picker/done で届きます。
 * サイトを操作する許可は、メニューの［ページで選ぶ］を押した直後に求めます。Chrome は、押した直後にしか確認を
 * 出さないためです。
 * @param {string} blockId
 * @param {'TARGET' | 'NEXT'} field
 */
async function startPick(blockId, field) {
  clearNotices();
  const info = blockEditor.pickInfo(blockId);
  const flow = shownFlow;
  if (!info || !flow) {
    return;
  }
  if (info.error && field === 'TARGET') {
    showNotice(elements.blocksPickNotice, info.error, 'error');
    return;
  }
  const denied = await requestPermission(flow.origin);
  if (denied) {
    showNotice(elements.blocksPickNotice, denied, 'error');
    return;
  }
  // 最初の手順がページを開く手順なら、その URL を開きます。実行時に入力する値（{{名前}}）を含む場合は、
  // サイトの先頭のページを開きます。
  const first = flow.steps[0];
  const url =
    first?.type === 'navigate' && !first.url.includes('{{') && isWebUrl(first.url)
      ? first.url
      : undefined;
  const response = await chrome.runtime.sendMessage({
    kind: 'picker/start',
    origin: flow.origin,
    url,
    mode: field === 'TARGET' && info.blockType.startsWith('lm_forEach') ? 'rows' : 'element',
    // ページ送りの［次へ］は行の内側を探さないため、囲む繰り返しの行は使いません。
    chain: field === 'NEXT' ? [] : info.chain,
  });
  if (!response?.ok) {
    showNotice(
      elements.blocksPickNotice,
      response?.error ?? '選択を始められませんでした。',
      'error',
    );
    return;
  }
  pendingPick = { blockId, field, requestId: response.requestId };
  // サイトのタブに切り替わらなかった場合も、選択が始まったことと、どこで選ぶかがわかるようにします。
  showNotice(
    elements.blocksPickNotice,
    'サイトのタブで、要素を選んでいます。そのタブでページの要素を押してください。Esc キーで取り消せます。',
    'info',
  );
}

// 選択モードの結果を受け取ります。Service Worker が、ページで選んだ要素の指定を送ります。
chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.kind !== 'picker/done' ||
    !pendingPick ||
    message.requestId !== pendingPick.requestId
  ) {
    return;
  }
  const { blockId, field } = pendingPick;
  pendingPick = null;
  clearNotices();
  const result = message.result ?? {};
  if (result.cancelled) {
    showNotice(elements.blocksPickNotice, '要素の選択を取り消しました。', 'info');
  } else if (result.error) {
    showNotice(elements.blocksPickNotice, result.error, 'error');
  } else if (!blockEditor.applyPick(blockId, field, result)) {
    showNotice(
      elements.blocksPickNotice,
      '要素を選んでいる間にブロックが削除されたため、反映しませんでした。',
      'error',
    );
  } else {
    const label = (result.items ?? result.target)?.label ?? '';
    const rows = result.items ? `（${result.count} 件の行）` : '';
    // ページ送りのある繰り返しでは、行の次に［次へ］のボタンを選ぶ必要があるため、続けて押すボタンを示します。
    const next =
      field === 'TARGET' && blockEditor.pickInfo(blockId)?.blockType === 'lm_forEach_pages'
        ? '続けて、同じブロックを右クリックし、［次のページへ進むボタンをページで選ぶ］を押してください。'
        : '保存するには［手順を保存］を押してください。';
    showToast(elements.toast, `「${label}」${rows}を選びました。${next}`);
  }
});

// ---- 値を入れる（#147） ----

/** 値の一覧のまとまりの見出しです。 */
const VALUE_GROUP_LABELS = {
  param: '実行時に入力する値（パラメータ）',
  extract: '前の「読み取り」で覚えた値',
  builtin: '決まった値',
};

/**
 * ブロックの欄に入れられる値の一覧を、ブロックの編集画面の直上に出します。
 * 欄が複数あるブロックでは、入れる欄を選べるようにします。最初の値のボタンにフォーカスを移します。
 * @param {string} blockId
 */
async function openValues(blockId) {
  clearNotices();
  const target = blockEditor.valueTarget(blockId);
  const stored = await getFlow(selectedId);
  if (!target || target.fields.length === 0 || !stored) {
    return;
  }
  const params = stored.flow.params ?? [];
  elements.blocksValuesTitle.textContent = `値を入れる：${target.label}`;
  elements.blocksValuesFields.hidden = target.fields.length < 2;
  elements.blocksValuesFieldOptions.replaceChildren(
    ...target.fields.map((field, index) => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.className = 'form-check-input';
      input.name = 'blocks-values-field';
      input.id = `blocks-values-field-${index}`;
      input.value = String(index);
      input.checked = index === 0;
      input.addEventListener('change', () => renderValues(blockId, target.fields[index], params));
      const label = document.createElement('label');
      label.className = 'form-check-label';
      label.htmlFor = input.id;
      label.textContent = field.label;
      const wrapper = document.createElement('div');
      wrapper.className = 'form-check form-check-inline';
      wrapper.append(input, label);
      return wrapper;
    }),
  );
  renderValues(blockId, target.fields[0], params);
  valuesBlockId = blockId;
  elements.blocksValues.hidden = false;
  elements.blocksValues.scrollIntoView({ block: 'nearest' });
  (elements.blocksValuesList.querySelector('button') ?? elements.blocksValuesClose).focus();
}

/**
 * 欄に入れられる値の一覧を表示し直します。値のまとまりごとに見出しを付けます。
 * @param {string} blockId
 * @param {import('../shared/block-values.js').ValueField} field
 * @param {import('../shared/params.js').Param[]} params
 */
function renderValues(blockId, field, params) {
  const values = blockEditor.insertableValues(blockId, field.kind, params);
  if (values.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mb-0';
    empty.textContent =
      'この欄に入れられる値はありません。この欄に使えるのは、実行時に入力する値（パラメータ）だけです。パラメータは、［値の定義を編集］で追加できます。';
    elements.blocksValuesList.replaceChildren(empty);
    return;
  }
  elements.blocksValuesList.replaceChildren(
    ...Object.entries(VALUE_GROUP_LABELS).flatMap(([group, heading]) => {
      const items = values.filter((value) => value.group === group);
      if (items.length === 0) {
        return [];
      }
      const title = document.createElement('p');
      title.className = 'lm-values-group';
      title.textContent = heading;
      const list = document.createElement('ul');
      list.className = 'lm-values-list';
      list.setAttribute('aria-label', heading);
      list.append(
        ...items.map((value) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn btn-sm';
          const code = document.createElement('code');
          code.textContent = value.text;
          const note = document.createElement('span');
          note.className = 'lm-sub';
          note.textContent = value.label;
          button.append(code, ' ', note);
          button.addEventListener('click', () => insertValue(blockId, field, value.text));
          const item = document.createElement('li');
          item.append(button);
          return item;
        }),
      );
      return [title, list];
    }),
  );
}

/**
 * 値を欄の末尾に入れ、一覧を閉じます。
 * @param {string} blockId
 * @param {import('../shared/block-values.js').ValueField} field
 * @param {string} text
 */
function insertValue(blockId, field, text) {
  closeValues();
  const inserted = blockEditor.insertIntoField(blockId, field, text);
  if (!inserted) {
    showNotice(
      elements.blocksPickNotice,
      '値を入れる前にブロックが削除されたため、入れませんでした。',
      'error',
    );
    return;
  }
  blockEditor.focusBlock(blockId);
  showToast(
    elements.toast,
    `「${text}」を${field.label}の${inserted.beforeExtension ? '拡張子の前' : '末尾'}に入れました。保存するには［手順を保存］を押してください。`,
  );
}

/** 値の一覧を出しているブロックです。閉じた後に、このブロックへフォーカスを戻します。 */
let valuesBlockId = '';

/** 値の一覧を閉じます。 */
function closeValues() {
  elements.blocksValues.hidden = true;
  elements.blocksValuesList.replaceChildren();
  elements.blocksValuesFieldOptions.replaceChildren();
}

elements.blocksValuesClose.addEventListener('click', () => {
  closeValues();
  blockEditor.focusBlock(valuesBlockId);
});

elements.blocksValues.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeValues();
    blockEditor.focusBlock(valuesBlockId);
  }
});

/**
 * ブロックに、保存済みのフローの手順を表示し直します。
 * @param {import('../shared/flow.js').Step[]} steps
 */
function loadBlocks(steps) {
  closeValues();
  loadedSteps = JSON.stringify(steps);
  blockEditor.load(steps);
}

elements.blocksSave.addEventListener('click', async () => {
  clearNotices();
  const stored = await getFlow(selectedId);
  if (!stored) {
    return;
  }
  const { steps, error } = blockEditor.steps();
  if (error) {
    showNotice(elements.blocksNotice, error, 'error');
    return;
  }
  const flow = withSteps(stored.flow, steps);
  const result = await saveFlow(flow, selectedId);
  if (!result.ok) {
    showNotice(
      elements.blocksNotice,
      `形式に誤りがあるため、保存しませんでした。\n${result.errors.join('\n')}`,
      'error',
    );
    return;
  }
  loadedSteps = JSON.stringify(steps);
  blockEditor.markSaved();
  showSavedJson({ ...flow, name: result.name });
  showToast(elements.toast, '手順を保存しました。');
});

/**
 * ［手順］タブで保存したフローを、［JSON］タブの編集欄にも表示します。
 * ［JSON］タブに保存していない編集がある場合は、その編集を消さないよう入れ替えません。
 * @param {import('../shared/flow.js').Flow} flow
 */
function showSavedJson(flow) {
  if (!jsonDirty) {
    elements.json.value = JSON.stringify(orderFlow(flow), null, 2);
  }
}

// ---- 実行時に入力する値の定義（#9） ----

/**
 * 値の定義の入力欄を開くか閉じます。開いている間は［値の定義を編集］を隠します（#112）。
 * @param {import('../shared/params.js').Param[] | null} params 開く場合は、入力欄に入れる定義
 */
function showParamsForm(params) {
  elements.paramsForm.hidden = params === null;
  elements.paramsButtons.hidden = params !== null;
  // 入力欄と同じ内容の一覧は、編集している間は隠します。
  elements.params.classList.toggle('d-none', params !== null);
  elements.paramsEmpty.classList.toggle('d-none', params !== null);
  elements.paramsRows.replaceChildren(
    ...(params ? rowsFromParams(params).map((row, index) => paramFieldset(row, index)) : []),
  );
}

elements.paramsEdit.addEventListener('click', async () => {
  clearNotices();
  // 値の定義を保存すると、手順の中の参照も書き換えるため、ブロックの保存していない変更と両立しません。
  if (blockEditor.dirty) {
    showNotice(
      elements.paramsEditNotice,
      '手順のブロックに保存していない変更があります。先に［手順を保存］か［変更を取り消す］を押してください。',
      'warning',
    );
    return;
  }
  const stored = await getFlow(selectedId);
  if (stored) {
    showParamsForm(stored.flow.params ?? []);
    elements.paramsRows.querySelector('input')?.focus();
  }
});

elements.paramsAdd.addEventListener('click', () => {
  const index = elements.paramsRows.querySelectorAll('fieldset').length;
  const row = { originalName: '', name: '', label: '', type: 'text', options: '', default: '' };
  const fieldset = paramFieldset(row, index);
  elements.paramsRows.append(fieldset);
  fieldset.querySelector('input')?.focus();
});

elements.paramsCancel.addEventListener('click', () => {
  clearNotices();
  showParamsForm(null);
  elements.paramsEdit.focus();
});

elements.paramsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotices();
  const stored = await getFlow(selectedId);
  if (!stored) {
    return;
  }
  const rows = readParamRows(elements.paramsRows);
  // 値ごと・欄ごとの誤りは、その欄の直下に出します。「値 2」の見出しで、どの値かが分かります。
  if (showParamRowErrors(elements.paramsRows, paramRowErrors(rows))) {
    return;
  }
  const { params, renames } = paramsFromRows(rows);
  let steps = stored.flow.steps;
  for (const { from, to } of renames) {
    steps = renameParamReferences(steps, from, to);
  }
  /** @type {import('../shared/flow.js').Flow} */
  const flow = { ...stored.flow, steps };
  if (params.length > 0) {
    flow.params = params;
  } else {
    delete flow.params;
  }
  const result = await saveFlow(flow, selectedId);
  if (!result.ok) {
    showNotice(elements.paramsNotice, describeParamSaveErrors(result.errors), 'error');
    return;
  }
  showParamsForm(null);
  showSavedJson({ ...flow, name: result.name });
  showToast(elements.toast, '値の定義を保存しました。');
});

elements.blocksRevert.addEventListener('click', async () => {
  clearNotices();
  const stored = await getFlow(selectedId);
  if (stored) {
    loadBlocks(stored.flow.steps);
  }
});

/**
 * ブロックに保存していない変更がある場合に、破棄してよいかを、押したボタンの直下で確かめます。
 * 変更がない場合と、破棄してよい場合は true を返します。
 * @param {Element} anchor 押したボタン（確認は、その直後に出します）
 * @param {string} action 破棄した後に行う操作の名前（例：「別のフローを開く」）
 * @returns {Promise<boolean>}
 */
async function confirmDiscardBlocks(anchor, action) {
  if (!blockEditor.dirty) {
    return true;
  }
  const holder = document.createElement('div');
  anchor.after(holder);
  const ok = await confirmInline(holder, {
    message: `手順のブロックに保存していない変更があります。変更を破棄して${action}と、元に戻せません。`,
    confirmLabel: `破棄して${action}`,
    danger: true,
  });
  holder.remove();
  return ok;
}

// ---- 一覧の画面とフローの画面の切り替え（#9） ----
// フローを開くと、一覧に替えてフローの詳細を画面の幅いっぱいに表示します。開くときに履歴を 1 件積むため、
// ブラウザーの［戻る］でも一覧に戻れます。

const flowsPanel = byId('panel-flows');
const backToList = /** @type {HTMLButtonElement} */ (byId('back-to-list'));

/**
 * 一覧の画面と、フローの画面（詳細か、JSON からの追加）を切り替えます。
 * @param {boolean} detail フローの画面にする場合は true
 */
function showDetailView(detail) {
  const changed = flowsPanel.classList.contains('lm-view-detail') !== detail;
  flowsPanel.classList.toggle('lm-view-detail', detail);
  flowsPanel.classList.toggle('lm-view-list', !detail);
  if (!changed) {
    return;
  }
  window.scrollTo(0, 0);
  if (detail) {
    // 隠していた間は大きさが 0 のため、表示した後にブロックの表示の大きさを合わせ直します。
    blockEditor.resize();
    // 押した一覧の行は隠れるため、フォーカスを戻るボタンに移します。
    backToList.focus();
  }
}

/** 画面を離れる確認を出しているかです。 */
let confirmingLeave = false;

backToList.addEventListener('click', async () => {
  if (confirmingLeave) {
    return;
  }
  confirmingLeave = true;
  const ok = await confirmDiscardBlocks(backToList.parentElement ?? backToList, '一覧に戻る');
  confirmingLeave = false;
  if (!ok) {
    return;
  }
  const previous = selectedId;
  if (history.state?.lmDetail) {
    // フローを開いたときに積んだ履歴を戻します。popstate で一覧を表示します。
    blockEditor.markSaved();
    history.back();
  } else {
    select('');
    focusFlowRow(previous);
  }
});

// ブラウザーの［戻る］［進む］で、URL の # に合わせてフローを開くか一覧に戻ります。
window.addEventListener('popstate', async () => {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id === selectedId) {
    return;
  }
  if (blockEditor.dirty) {
    // 保存していない変更がある間は、画面を変えずに確認を出します。URL は今のフローに戻します。
    // 確認をすでに出している場合は、2 つ目を出しません。
    const target = id;
    history.pushState({ lmDetail: true }, '', `#${encodeURIComponent(selectedId)}`);
    if (confirmingLeave) {
      return;
    }
    confirmingLeave = true;
    const ok = await confirmDiscardBlocks(backToList.parentElement ?? backToList, '移動する');
    confirmingLeave = false;
    if (!ok) {
      return;
    }
    blockEditor.markSaved();
    select(target);
    return;
  }
  const previous = selectedId;
  select(id, { history: 'none' });
  if (!id) {
    focusFlowRow(previous);
  }
});

/**
 * 一覧に戻ったときに、開いていたフローの行にフォーカスを戻します。キーボードで続けて操作するためです。
 * @param {string} id
 */
function focusFlowRow(id) {
  requestAnimationFrame(() => {
    const input = elements.flows.querySelector(`input[data-flow-id="${CSS.escape(id)}"]`);
    input?.closest('.lm-flow-row')?.querySelector('button')?.focus();
  });
}

// 保存していない変更がある状態で管理画面を閉じる場合は、Chrome の確認を出します。
window.addEventListener('beforeunload', (event) => {
  if (blockEditor.dirty) {
    event.preventDefault();
  }
});

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

const tabs = /** @type {HTMLButtonElement[]} */ ([
  ...document.querySelectorAll('#main-tabs [role="tab"]'),
]);

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
  // 一覧から開いた画面の履歴（#9）を残すため、履歴の状態は引き継ぎます。
  history.replaceState(history.state, '', url);
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

// ---- フローの詳細のタブ（#132） ----
// 画面の上部のタブと同じく WAI-ARIA の Tabs パターンに従います。選んだタブは保存しません。
// タブを切り替えても、隠した区画の入力（保存していない JSON の編集など）は消しません。

const detailTabs = /** @type {HTMLButtonElement[]} */ ([
  ...document.querySelectorAll('[data-detail-tab]'),
]);

/** 選んでいるフローの詳細のタブです。 */
let detailTab = 'steps';

/**
 * フローの詳細のタブを切り替えます。
 * @param {string} name data-detail-tab の値
 * @param {boolean} [focus] 選んだタブにフォーカスを移すか
 */
function selectDetailTab(name, focus = false) {
  const current = detailTabs.find((tab) => tab.dataset.detailTab === name) ?? detailTabs[0];
  detailTab = current.dataset.detailTab ?? 'steps';
  for (const tab of detailTabs) {
    const selected = tab === current;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    byId(tab.getAttribute('aria-controls') ?? '').hidden = !selected;
  }
  if (detailTab === 'steps') {
    // 隠していた間は大きさを測れないため、表示したときに合わせ直します。
    blockEditor.resize();
    if (jsonDirty) {
      showNotice(
        elements.blocksNotice,
        '［JSON］タブに保存していない編集があります。ここで［手順を保存］を押すと、その編集は保存されません。',
        'warning',
      );
    }
  }
  if (detailTab === 'json' && blockEditor.dirty) {
    showNotice(
      elements.jsonNotice,
      '［手順］タブのブロックに保存していない変更があります。ここで［JSON を保存］を押すと、その変更は破棄されます。',
      'warning',
    );
  }
  if (focus) {
    current.focus();
  }
}

for (const [index, tab] of detailTabs.entries()) {
  tab.addEventListener('click', () => {
    clearNotices();
    selectDetailTab(tab.dataset.detailTab ?? '');
  });
  tab.addEventListener('keydown', (event) => {
    const moves = { ArrowRight: 1, ArrowLeft: -1 };
    const move = moves[/** @type {'ArrowRight' | 'ArrowLeft'} */ (event.key)];
    if (move) {
      event.preventDefault();
      const next = detailTabs[(index + move + detailTabs.length) % detailTabs.length];
      selectDetailTab(next.dataset.detailTab ?? '', true);
    }
  });
}

selectDetailTab('steps');

// ---- 保存したフロー ----

elements.newFlow.addEventListener('click', () => {
  select('');
  elements.importer.hidden = false;
  showDetailView(true);
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
  jsonDirty = false;
  // JSON で保存した手順を、ブロックにも表示します。ブロックの保存していない変更は破棄します（切り替えたときに知らせています）。
  loadBlocks(/** @type {import('../shared/flow.js').Flow} */ (flow).steps);
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
  // フローが操作するすべてのサイト（#41）の許可を、1 回の確認でまとめて求めます。
  const origins = JSON.parse(elements.editor.dataset.origins ?? '[]');
  if (!selectedId || origins.length === 0) {
    return;
  }
  const denied = await requestPermission(origins);
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
  // 入力フォームを開いている間は、詳細の操作のボタンを隠します。押すボタンをフォームの中に絞るためです（#112）。
  elements.editorActions.hidden = true;
  elements.runForm.scrollIntoView({ block: 'nearest' });
  const first = elements.runFields.querySelector('input, select');
  if (first instanceof HTMLElement) {
    first.focus();
  }
}

function hideRunForm() {
  runFormState = null;
  elements.runForm.hidden = true;
  elements.editorActions.hidden = false;
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
  elements.runReasonText.textContent = reason;
  elements.runReason.hidden = !reason;
  // 最初のページが決まらない場合は、フローを直す必要があるため注意（黄）にします。サイドパネルと同じです（#141）。
  // 記録中と実行中は待てば実行できるため、情報（青）のままにします。
  elements.runReason.classList.toggle('alert-warning', noFirstPage);
  elements.runReason.classList.toggle('alert-info', !noFirstPage);
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
    // JSON の編集欄は別のタブにあるため、名前の変更の知らせと同じく、詳細の上部に出します（#132）。
    showNotice(
      elements.editorNotice,
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
 * 詳細の見出しの「…」（その他の操作）を開閉します（#137）。
 * @param {boolean} open
 */
function setMoreOpen(open) {
  elements.editorMore.hidden = !open;
  elements.more.setAttribute('aria-expanded', String(open));
}

elements.more.addEventListener('click', () => {
  setMoreOpen(elements.editorMore.hidden === true);
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
    showBatchNameForm(false);
  }
  if (!elements.batchForm.hidden) {
    renderBatchOrder();
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
      hide: [elements.bulkButtons],
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

// ---- まとめフロー（#7） ----
// 一覧で選んだフローを、選んだ順に実行するまとめフローとして保存します。実行はサイドパネルで行います。

/** @returns {StoredFlow[]} 表示中で選んでいるフローを、選んだ順に並べたもの */
function checkedFlowsInOrder() {
  return [...checkedIds].flatMap((id) => shownFlows.filter((stored) => stored.id === id));
}

/** 登録の欄に、実行する順を表示します。 */
function renderBatchOrder() {
  elements.batchOrder.replaceChildren(
    ...checkedFlowsInOrder().map((stored) => {
      const item = document.createElement('li');
      item.textContent = `${stored.flow.name}（${stored.flow.origin}）`;
      return item;
    }),
  );
}

/**
 * まとめフローの登録の欄を開く、または閉じます。開いている間は、一括操作の帯のボタンを隠します。
 * 押すボタンを欄の中の［保存］に絞るためです（#112）。閉じるときは、入力した名前を消します。
 * @param {boolean} open
 */
function showBatchNameForm(open) {
  elements.batchForm.hidden = !open;
  elements.bulkButtons.hidden = open;
  if (!open) {
    elements.batchName.value = '';
  }
}

elements.bulkBatch.addEventListener('click', () => {
  clearNotices();
  showBatchNameForm(true);
  renderBatchOrder();
  elements.batchName.focus();
});

elements.batchCancel.addEventListener('click', () => {
  clearNotices();
  showBatchNameForm(false);
});

elements.batchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotices();
  const name = elements.batchName.value.trim();
  if (!name) {
    showFieldError(
      elements.batchName,
      elements.batchNameFeedback,
      'まとめフローの名前を入力してください。',
    );
    elements.batchName.focus();
    return;
  }
  const flowIds = checkedFlowsInOrder().map((stored) => stored.id);
  const problems = batchProblems(flowIds, await listFlows());
  if (problems.length > 0) {
    showNotice(elements.batchNotice, problems.join('\n'), 'error');
    return;
  }
  const result = await saveBatch(name, flowIds);
  if (!result.ok) {
    showNotice(elements.batchNotice, result.error, 'error');
    return;
  }
  showBatchNameForm(false);
  showToast(
    elements.toast,
    `まとめフロー「${name}」を保存しました。［まとめフロー］のタブか、サイドパネルから実行できます。`,
  );
});

/** まとめフローの検索欄の候補に添える、種類の説明です（#113）。 */
const BATCH_SUGGESTION_NOTES = { batch: 'まとめフロー', flow: 'フロー', site: 'サイト' };

/**
 * まとめフローを削除するときの確認と、行の中の知らせです。キーはまとめフローの id です。
 * 一覧を作り直しても消えないよう、ここに保持します。
 * @type {Map<string, { text: string, kind: import('../shared/ui.js').NoticeKind }>}
 */
const batchRowNotices = new Map();

/**
 * 検索の候補を作るための、まとめフローと保存したフローです。一覧を表示するたびに更新します。
 * @type {{ batches: StoredBatch[], flows: StoredFlow[] }}
 */
let batchSearchData = { batches: [], flows: [] };

/**
 * まとめフローの一覧を表示します。検索欄の語と一致方法で絞り込みます（#113）。
 * 検索語と一致方法は保存しません。フローの一覧の検索と同じです。
 */
async function renderBatches() {
  const [batches, flows] = await Promise.all([listBatches(), listFlows()]);
  batchSearchData = { batches, flows };
  const shown = filterBatches(batches, flows, elements.batchSearch.value, batchSearchMode());
  elements.batchCount.textContent = batches.length > 0 ? String(batches.length) : '';
  elements.batchEmpty.hidden = batches.length > 0;
  elements.batchSearchArea.hidden = batches.length === 0;
  if (elements.batchSearchArea.hidden) {
    batchSearchBox.close();
  }
  elements.batchNoMatch.hidden = batches.length === 0 || shown.length > 0;
  elements.batchList.replaceChildren(...shown.map((batch) => batchRow(batch, flows)));
}

elements.batchSearchMode.append(...MATCH_MODES.map(({ value, label }) => new Option(label, value)));

/** @returns {import('../shared/flow-search.js').MatchMode} */
function batchSearchMode() {
  return /** @type {import('../shared/flow-search.js').MatchMode} */ (
    elements.batchSearchMode.value
  );
}

const batchSearchBox = attachCombobox(elements.batchSearch, elements.batchSearchSuggestions, {
  getOptions: () =>
    batchSuggestions(
      batchSearchData.batches,
      batchSearchData.flows,
      elements.batchSearch.value,
      batchSearchMode(),
    ).map(({ value, kind }) => ({ value, note: BATCH_SUGGESTION_NOTES[kind] })),
  onSelect: () => renderBatches().catch(console.error),
});

elements.batchSearch.addEventListener('input', () => {
  renderBatches().catch(console.error);
});

elements.batchSearchMode.addEventListener('change', () => {
  renderBatches().catch(console.error);
});

/**
 * まとめフローの一覧の 1 行です。名前、実行する順のフロー、［実行］［すべて開く］［削除］を並べます。
 * 削除されたフローを含む場合など、実行できない理由があれば、警告として表示し、［実行］を押せなくします。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} flows 保存したすべてのフロー
 * @returns {HTMLDivElement}
 */
function batchRow(batch, flows) {
  const row = document.createElement('div');
  row.className = 'list-group-item lm-batch-row';
  const name = document.createElement('div');
  name.className = 'lm-item-name';
  name.textContent = batch.name;
  const order = document.createElement('ol');
  order.className = 'lm-batch-order';
  order.append(
    ...batch.flowIds.map((id) => {
      const stored = flows.find((entry) => entry.id === id);
      const item = document.createElement('li');
      item.textContent = stored
        ? `${stored.flow.name}（${stored.flow.origin}）`
        : '（削除されたフロー）';
      return item;
    }),
  );
  // 名前と実行する順を左に、操作を右端に置きます（#137）。行の幅を使い、ほかの一覧の行と同じ配置にします。
  const text = document.createElement('div');
  text.className = 'lm-batch-text';
  text.append(name, order);
  const head = document.createElement('div');
  head.className = 'lm-batch-head';
  row.append(head);

  const problems = batchProblems(batch.flowIds, flows);
  if (problems.length > 0) {
    const warning = document.createElement('p');
    showNotice(warning, problems.join('\n'), 'warning');
    row.append(warning);
  }

  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'btn btn-sm btn-outline-primary';
  run.textContent = '実行';
  run.setAttribute('aria-label', `まとめフロー「${batch.name}」を実行`);
  run.disabled = problems.length > 0;
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn btn-sm';
  open.textContent = 'すべて開く';
  open.setAttribute(
    'aria-label',
    `まとめフロー「${batch.name}」の各フローの最初のページをすべて開く`,
  );
  open.disabled = problems.length > 0;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-sm btn-ghost-danger';
  remove.textContent = '削除';
  remove.setAttribute('aria-label', `まとめフロー「${batch.name}」を削除`);
  const buttons = document.createElement('div');
  buttons.className = 'lm-buttons';
  buttons.append(run, open, remove);
  const confirm = document.createElement('div');
  confirm.hidden = true;
  const notice = document.createElement('p');
  const saved = batchRowNotices.get(batch.id);
  if (saved) {
    showNotice(notice, saved.text, saved.kind);
  } else {
    notice.hidden = true;
  }
  remove.addEventListener('click', async () => {
    clearNotices();
    batchRowNotices.clear();
    showNotice(notice, '');
    if (
      !(await confirmInline(confirm, {
        message: `まとめフロー「${batch.name}」を削除します。含めているフローは削除しません。`,
        confirmLabel: '削除する',
        danger: true,
        hide: [buttons],
      }))
    ) {
      return;
    }
    try {
      await deleteBatch(batch.id);
      showToast(elements.toast, `まとめフロー「${batch.name}」を削除しました。`);
    } catch (error) {
      batchRowNotices.set(batch.id, { text: String(error), kind: 'error' });
      await renderBatches();
    }
  });
  run.addEventListener('click', () => {
    onBatchRunClick(batch, flows, { row, buttons, notice }).catch((error) =>
      showNotice(notice, String(error), 'error'),
    );
  });
  open.addEventListener('click', () => {
    onBatchOpenClick(batch, flows, { row, buttons, notice }).catch((error) =>
      showNotice(notice, String(error), 'error'),
    );
  });
  head.append(text, buttons);
  row.append(confirm, notice);
  return row;
}

/**
 * まとめフローの［実行］です。値の入力が必要なフローがあれば、行の中に入力欄を開きます。
 * 入力欄を開いている間は、行の［実行］［削除］を隠します。押すボタンを入力欄の［この値でまとめて実行］に絞るためです。
 * 実行の状態は、サイドパネルに表示します。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} flows 保存したすべてのフロー
 * @param {{ row: HTMLElement, buttons: HTMLElement, notice: HTMLElement }} parts 行の要素
 */
async function onBatchRunClick(batch, flows, { row, buttons, notice }) {
  clearNotices();
  batchRowNotices.clear();
  showNotice(notice, '');
  const contained = batch.flowIds.flatMap((id) => flows.filter((stored) => stored.id === id));
  // 許可を求める処理は、ボタンを押した直後に呼び出す必要があります。この前に待ち時間を入れないでください。
  const denied = await requestPermission([
    ...new Set(contained.flatMap((stored) => flowOrigins(stored.flow))),
  ]);
  if (denied) {
    showNotice(notice, denied, 'error');
    return;
  }
  const needInput = contained.filter(
    (stored) => (stored.flow.params ?? []).length > 0 || secretStepIndexes(stored.flow).length > 0,
  );
  if (needInput.length === 0) {
    await startBatch(batch, {}, notice);
    return;
  }

  showBatchForm(
    batch,
    { row, buttons },
    {
      title: '実行する値の入力',
      description:
        '値の入力が必要なフローだけを表示しています。入力した値は保存しません。実行の状態はサイドパネルに表示します。',
      submitLabel: 'この値でまとめて実行',
      fields: needInput.map((stored) => ({
        stored,
        params: stored.flow.params ?? [],
        secretSteps: secretStepIndexes(stored.flow),
      })),
      onSubmit: (inputs, formNotice) => startBatch(batch, inputs, formNotice),
    },
  );
}

/**
 * まとめフローの［すべて開く］です。含めた各フローの最初のページを新しいタブで開きます。手順は実行しません。
 * 最初のページの URL が実行時の値を使うフローがあれば、行の中にその値の入力欄を開きます。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} flows 保存したすべてのフロー
 * @param {{ row: HTMLElement, buttons: HTMLElement, notice: HTMLElement }} parts 行の要素
 */
async function onBatchOpenClick(batch, flows, { row, buttons, notice }) {
  clearNotices();
  batchRowNotices.clear();
  showNotice(notice, '');
  const contained = batch.flowIds.flatMap((id) => flows.filter((stored) => stored.id === id));
  const needInput = contained.filter((stored) => firstPageParams(stored.flow).length > 0);
  if (needInput.length === 0) {
    await openBatchPages(batch, contained, {}, notice);
    return;
  }
  showBatchForm(
    batch,
    { row, buttons },
    {
      title: '開くページの値の入力',
      description:
        '最初のページの URL が値を使うフローだけを表示しています。入力した値は保存しません。手順は実行しません。',
      submitLabel: 'この値で開く',
      fields: needInput.map((stored) => ({
        stored,
        params: firstPageParams(stored.flow),
        secretSteps: [],
      })),
      onSubmit: (inputs, formNotice) => openBatchPages(batch, contained, inputs, formNotice),
    },
  );
}

/**
 * 含めた各フローの最初のページを、新しいタブで開きます。1 件でも開くページが決まらない場合は、どれも開きません。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} contained まとめフローに含めたフロー（登録した順）
 * @param {Record<string, { params: Record<string, string> }>} inputs フローごとの入力した値
 * @param {HTMLElement} notice 開けなかったときに知らせを出す場所
 * @returns {Promise<boolean>} 開いた場合は true
 */
async function openBatchPages(batch, contained, inputs, notice) {
  const pages = batchFirstPageUrls(contained, inputs, new Date());
  if (!pages.ok) {
    showNotice(notice, pages.error, 'error');
    return false;
  }
  // 1 件目のページを前面に、残りを背景のタブで開きます。
  for (const [index, url] of pages.urls.entries()) {
    await chrome.tabs.create({ url, active: index === 0 });
  }
  showToast(
    elements.toast,
    `まとめフロー「${batch.name}」の ${pages.urls.length} 件の最初のページを開きました。`,
  );
  return true;
}

/**
 * まとめフローの行の中に、フローごとの値の入力欄を開きます（［実行］と［すべて開く］で使います）。
 * 入力欄を開いている間は、行の［実行］［すべて開く］［削除］を隠します。押すボタンを入力欄の送信のボタンに絞るためです。
 * @param {StoredBatch} batch
 * @param {{ row: HTMLElement, buttons: HTMLElement }} parts 行の要素
 * @param {{
 *   title: string,
 *   description: string,
 *   submitLabel: string,
 *   fields: { stored: StoredFlow, params: import('../shared/params.js').Param[], secretSteps: number[] }[],
 *   onSubmit: (
 *     inputs: Record<string, { params: Record<string, string>, secrets: Record<string, string> }>,
 *     notice: HTMLElement,
 *   ) => Promise<boolean>,
 * }} options onSubmit は、成功したときに true を返します。true の場合は入力欄を閉じます
 */
function showBatchForm(
  batch,
  { row, buttons },
  { title, description, submitLabel, fields, onSubmit },
) {
  row.querySelector('form')?.remove();
  const now = new Date();
  const groups = fields.map(({ stored, params, secretSteps }, index) => {
    const element = document.createElement('div');
    element.className = 'lm-run-fields';
    const heading = document.createElement('h4');
    heading.className = 'lm-item-name';
    heading.textContent = stored.flow.name;
    element.append(
      heading,
      ...buildRunFields(document, stored.flow, {
        params,
        secretSteps,
        now,
        idPrefix: `batch-run-${batch.id}-${index}`,
      }),
    );
    return { flowId: stored.id, params, element };
  });
  const form = document.createElement('form');
  form.className = 'lm-block lm-run-form';
  form.noValidate = true;
  const heading = document.createElement('h3');
  heading.className = 'lm-block-title';
  heading.textContent = title;
  const text = document.createElement('p');
  text.className = 'lm-sub';
  text.textContent = description;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary';
  submit.textContent = submitLabel;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'キャンセル';
  const formButtons = document.createElement('div');
  formButtons.className = 'lm-buttons';
  formButtons.append(submit, cancel);
  const formNotice = document.createElement('p');
  formNotice.hidden = true;
  form.append(heading, text, ...groups.map(({ element }) => element), formButtons, formNotice);

  const close = () => {
    // 入力したパスワードなどを画面に残さないよう、入力欄ごと消します。
    form.remove();
    buttons.hidden = false;
  };
  cancel.addEventListener('click', close);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showNotice(formNotice, '');
    const invalid = groups
      .map(({ element, params }) => showRunFieldErrors(element, params, new Date(), false))
      .some(Boolean);
    if (invalid) {
      const first = form.querySelector('.is-invalid');
      if (first instanceof HTMLElement) {
        first.focus();
      }
      return;
    }
    const inputs = Object.fromEntries(
      groups.map(({ flowId, element }) => [flowId, readRunFields(fieldEntries(element))]),
    );
    onSubmit(inputs, formNotice)
      .then((done) => {
        if (done) {
          close();
        }
      })
      .catch((error) => showNotice(formNotice, String(error), 'error'));
  });
  buttons.hidden = true;
  row.append(form);
  const first = form.querySelector('input, select');
  if (first instanceof HTMLElement) {
    first.focus();
  }
}

/**
 * まとめフローの一括実行を始めます。始められた場合は、サイドパネルで状態を確かめられることを知らせます。
 * @param {StoredBatch} batch
 * @param {Record<string, { params: Record<string, string>, secrets: Record<string, string> }>} inputs
 * @param {HTMLElement} notice 始められなかったときに知らせを出す場所
 * @returns {Promise<boolean>} 始められた場合は true
 */
async function startBatch(batch, inputs, notice) {
  const response = await chrome.runtime.sendMessage({
    kind: 'batch/start',
    batchId: batch.id,
    inputs,
  });
  if (!response?.ok) {
    showNotice(notice, response?.error ?? 'まとめて実行を開始できません。', 'error');
    return false;
  }
  showToast(
    elements.toast,
    `まとめフロー「${batch.name}」の実行を始めました。進み具合はサイドパネルで確認できます。`,
  );
  return true;
}

onBatchesChanged(() => {
  renderBatches().catch(console.error);
});
renderBatches().catch(console.error);

/**
 * フローを JSON ファイルとして、Chrome のダウンロード先フォルダーに保存します。
 * @param {import('../shared/flow.js').Flow[]} flows
 */
function downloadFlows(flows) {
  downloadJson(flowFileText(flows), flowFileName(flows, new Date()));
  // パラメータの既定値に個人の情報を入れている場合に備え、ファイルに含まれることを知らせます。
  showToast(
    elements.toast,
    `${flows.length === 1 ? `「${flows[0].name}」` : `${flows.length} 件のフロー`}をファイルに書き出しました。実行時に入力する値の既定値も含まれます。`,
  );
}

/**
 * JSON の文字列をファイルとして、Chrome のダウンロード先フォルダーに保存します。
 * @param {string} text
 * @param {string} fileName
 */
function downloadJson(text, fileName) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
      hide: [elements.editorActions],
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
        ? `「${flows[0].name}」は ${flowOrigins(flows[0]).join('、')} を操作するフローです。` +
          '内容を確認し、信頼できるフローだけを追加してください。'
        : `次の ${flows.length} 件のフローを追加します。各フローは、括弧内のサイトを操作します。` +
          '内容を確認し、信頼できるフローだけを追加してください。\n' +
          flows.map((flow) => `・${flow.name}（${flowOrigins(flow).join('、')}）`).join('\n')) +
      duplicateText,
    confirmLabel: '追加する',
    hide: [elements.importButtons],
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
  // まとめフローの一覧に、フロー名と削除されたフローを反映します（#7）。
  renderBatches().catch(console.error);
});
render().catch(console.error);

// ---- 定期実行（#22） ----

elements.scheduleWeekday.replaceChildren(
  ...WEEKDAY_NAMES.map((name, index) => new Option(`${name}曜日`, String(index))),
);

/** 周期に合わせて、曜日と日の欄を表示し、周期が「なし」の場合は時刻などの欄を使えなくします。 */
function updateScheduleFields() {
  const frequency = elements.scheduleFrequency.value;
  elements.scheduleWeekday.hidden = frequency !== 'weekly';
  elements.scheduleDayField.hidden = frequency !== 'monthly';
  elements.scheduleTime.disabled = frequency === '';
  elements.scheduleCatchUp.disabled = frequency === '';
}

/** 定期実行の誤りを消します。日と時刻の欄で、行の直下の表示欄を共有しています。 */
function clearScheduleError() {
  showFieldError(elements.scheduleDay, elements.scheduleFeedback, '');
  showFieldError(elements.scheduleTime, elements.scheduleFeedback, '');
}

elements.scheduleFrequency.addEventListener('change', () => {
  clearScheduleError();
  updateScheduleFields();
});
elements.scheduleDay.addEventListener('input', clearScheduleError);
elements.scheduleTime.addEventListener('input', clearScheduleError);

/**
 * 定期実行の欄に、フローの予約を入れます。予約がない場合は「なし」にします。
 * @param {string} flowId
 */
async function fillScheduleFields(flowId) {
  const schedule = (await listSchedules())[flowId];
  elements.scheduleFrequency.value = schedule?.frequency ?? '';
  elements.scheduleWeekday.value = String(schedule?.weekday ?? 1);
  elements.scheduleDay.value = schedule?.day === undefined ? '' : String(schedule.day);
  elements.scheduleTime.value = schedule?.time ?? '09:00';
  elements.scheduleCatchUp.checked = schedule?.catchUp ?? true;
  clearScheduleError();
  updateScheduleFields();
}

/**
 * 定期実行の今の設定と次の予約の日時、定期実行できない理由を表示します。
 * 定期実行できないフローでは、予約がなければ欄を使えなくします。予約がある場合は、解除できるよう残します。
 * @param {StoredFlow} stored
 */
async function renderSchedule(stored) {
  const schedule = (await listSchedules())[stored.id];
  // 状態は、色だけで伝えないよう、印の文字（設定済み・未設定）でも示します。
  elements.scheduleState.textContent = schedule ? '設定済み' : '未設定';
  elements.scheduleState.classList.toggle('lm-status-success', Boolean(schedule));
  if (schedule) {
    const when = document.createElement('strong');
    when.textContent = describeSchedule(schedule);
    const next = document.createElement('span');
    next.className = 'lm-sub';
    next.textContent = `次回 ${formatRunAt(nextRunAt(schedule, new Date()))}`;
    elements.scheduleSummary.replaceChildren(when, ' ', next);
  } else {
    elements.scheduleSummary.replaceChildren('定期実行は設定していません。');
  }
  const problems = schedulingProblems(stored.flow);
  elements.scheduleReason.hidden = problems.length === 0;
  elements.scheduleReasonBody.replaceChildren(
    ...(problems.length === 0
      ? []
      : [
          paragraph('定期実行は人がいない間に動くため、実行のたびに入力する値を使えません。'),
          paragraph('理由', 'lm-guide-label'),
          list(problems),
          paragraph('定期実行するには', 'lm-guide-label'),
          list(schedulingRemedies(stored.flow)),
        ]),
  );
  const locked = problems.length > 0 && !schedule;
  elements.scheduleFrequency.disabled = locked;
  elements.scheduleSave.disabled = locked;
  if (locked) {
    elements.scheduleTime.disabled = true;
    elements.scheduleCatchUp.disabled = true;
  }
}

/**
 * @param {string} text
 * @param {string} [className]
 * @returns {HTMLParagraphElement}
 */
function paragraph(text, className) {
  const element = document.createElement('p');
  element.textContent = text;
  if (className) {
    element.className = className;
  }
  return element;
}

/**
 * @param {string[]} items
 * @returns {HTMLUListElement}
 */
function list(items) {
  const element = document.createElement('ul');
  element.append(
    ...items.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    }),
  );
  return element;
}

elements.scheduleForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotices();
  const stored = await getFlow(selectedId);
  if (!stored) {
    return;
  }
  const input = readScheduleInput({
    frequency: elements.scheduleFrequency.value,
    weekday: elements.scheduleWeekday.value,
    day: elements.scheduleDay.value,
    time: elements.scheduleTime.value,
    catchUp: elements.scheduleCatchUp.checked,
  });
  if (!input.ok) {
    const control = input.field === 'day' ? elements.scheduleDay : elements.scheduleTime;
    showFieldError(control, elements.scheduleFeedback, input.error);
    control.focus();
    return;
  }
  if (input.setting === null) {
    await removeSchedule(stored.id);
    await renderSchedule(stored);
    showToast(elements.toast, '定期実行を解除しました。');
    return;
  }
  const problems = schedulingProblems(stored.flow);
  if (problems.length > 0) {
    showNotice(
      elements.scheduleNotice,
      `定期実行できないフローです。\n${problems.join('\n')}`,
      'error',
    );
    return;
  }
  const result = await saveSchedule(stored.id, input.setting, new Date());
  if (!result.ok) {
    showNotice(elements.scheduleNotice, `保存できませんでした。\n${result.error}`, 'error');
    return;
  }
  await renderSchedule(stored);
  showToast(
    elements.toast,
    `定期実行を保存しました。次回は ${formatRunAt(nextRunAt(input.setting, new Date()))} です。`,
  );
});

// 予約の処理済みの日時は Service Worker が書き換えます。次の予約の日時の表示を合わせます。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SCHEDULES_KEY in changes && selectedId) {
    getFlow(selectedId)
      .then((stored) => (stored ? renderSchedule(stored) : undefined))
      .catch(console.error);
  }
});

// ---- 実行速度（#15） ----

/**
 * 実行速度の欄に、フローの手順の間隔を入れます。指定がない場合は空欄にします（既定の 1 秒）。
 * @param {import('../shared/flow.js').Flow} flow
 */
function fillSpeedFields(flow) {
  elements.intervalMin.value = flow.interval ? formatSeconds(flow.interval.min) : '';
  elements.intervalMax.value = flow.interval ? formatSeconds(flow.interval.max) : '';
  clearSpeedError();
}

/** 実行速度の誤りを消します。2 つの欄で、行の直下の表示欄を共有しています。 */
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
    // JSON の編集欄は別のタブにあるため、押したボタンのある［実行速度］のタブに出します（#132）。
    showNotice(
      elements.speedNotice,
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
      hide: [elements.historyButtons],
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
      status.className = 'lm-nowrap';
      // 結果は、サイドパネルの実行の状態と同じ状態の印で示します（#133）。
      const mark = document.createElement('span');
      mark.className = `lm-status lm-status-${STATUS_TONES[entry.status]}`;
      mark.textContent = STATUS_LABELS[entry.status];
      status.append(mark);
      if (entry.trigger === 'schedule') {
        const trigger = document.createElement('div');
        trigger.className = 'lm-sub';
        trigger.textContent = '定期実行';
        status.append(trigger);
      }

      // 幅が狭い画面では、表を行ごとの縦の並びにし、列の見出しの代わりにこの名前を表示します（#137）。
      const reason = document.createElement('td');
      reason.dataset.label = '止まった手順と理由';
      if (entry.stepNumber !== undefined) {
        const step = document.createElement('div');
        // 止まった手順の内容は、サイドパネルの実行の表示と同じく、番号の後に括弧で添えます（#93）。
        step.textContent = `手順 ${stepText(entry)}${entry.step ? `（${entry.step}）` : ''}`;
        reason.append(step);
      }
      if (entry.reason) {
        const text = document.createElement('div');
        text.className = 'lm-sub';
        text.textContent = entry.reason;
        reason.append(text);
      }
      // 行の中の要素が見つからず飛ばした行（#174）は、完了した実行でも示します。
      if (entry.skipped && entry.skipped.length > 0) {
        const skipped = document.createElement('div');
        skipped.className = 'lm-sub';
        skipped.textContent = skippedText(entry.skipped);
        reason.append(skipped);
      }
      // 実行の補足（#191）も、完了した実行で示します。
      for (const note of entry.notes ?? []) {
        const text = document.createElement('div');
        text.className = 'lm-sub';
        text.textContent = note;
        reason.append(text);
      }

      const files = document.createElement('td');
      files.className = 'lm-sub';
      files.dataset.label = '保存したファイル';
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
      // ［コピー］は成功以外の行にだけ置くため、右に寄せて「×」の位置を行の間でそろえます。
      actions.className = 'lm-nowrap text-end lm-history-actions';
      // 成功以外の履歴は、原因の調査を依頼するときに貼り付けられるよう、1 件ずつコピーできます（#93）。
      if (entry.status !== 'done') {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn btn-sm btn-ghost-secondary';
        copy.textContent = 'コピー';
        copy.setAttribute(
          'aria-label',
          `${formatDateTime(entry.startedAt)} の「${entry.flowName}」の履歴をコピー`,
        );
        copy.addEventListener('click', async () => {
          clearNotices();
          try {
            await navigator.clipboard.writeText(historyEntryText(entry));
            showToast(elements.toast, `「${entry.flowName}」の履歴をコピーしました。`);
          } catch (error) {
            showNotice(
              elements.historyNotice,
              `履歴をコピーできませんでした。${String(error)}`,
              'error',
            );
          }
        });
        actions.append(copy);
      }
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

// 一覧の画面と入力欄の画面を切り替えます（#9。［保存したフロー］のタブと同じ形）。入力欄を開くときに
// 履歴を 1 件積むため、ブラウザーの［戻る］でも一覧に戻れます。

const stopViews = byId('stop-views');
const stopBack = /** @type {HTMLButtonElement} */ (byId('stop-back'));
const stopHeading = byId('stop-form-heading');

/**
 * 指定したサイトの一覧の画面に戻ります。直前に開いていたサイトの行（新しいサイトの場合は［新しいサイト］）に
 * フォーカスを戻します。
 */
function showStopList() {
  const origin = stopViews.dataset.origin ?? '';
  stopViews.classList.replace('lm-view-detail', 'lm-view-list');
  delete stopViews.dataset.origin;
  clearNotices();
  const row = [...elements.stopList.querySelectorAll('button')].find(
    (button) => button.dataset.origin === origin,
  );
  (row ?? elements.stopClear).focus();
}

stopBack.addEventListener('click', () => {
  if (history.state?.lmStop) {
    history.back();
  } else {
    showStopList();
  }
});

window.addEventListener('popstate', () => {
  if (stopViews.classList.contains('lm-view-detail') && !history.state?.lmStop) {
    showStopList();
  }
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
      hide: [elements.stopButtons],
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
      hide: [elements.stopButtons],
    }))
  ) {
    return;
  }
  const result = await saveStopRule(origin, { selectors: [], paths: [] });
  if (!result.ok) {
    showNotice(elements.stopNotice, `削除できませんでした。\n${result.errors.join('\n')}`, 'error');
    return;
  }
  stopBack.click();
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
 * 指定を入力欄に表示し、一覧に替えて入力欄の画面を表示します。
 * @param {string} origin 空の文字列の場合は、新しいサイトの指定です
 * @param {{ selectors: string[], paths: string[] }} rule
 */
function editStopRule(origin, rule) {
  for (const [control, feedback] of fieldFeedbacks) {
    showFieldError(control, feedback, '');
  }
  stopHeading.textContent = origin ? `${origin} の指定` : '新しいサイトの指定';
  if (!stopViews.classList.contains('lm-view-detail')) {
    history.pushState({ ...history.state, lmStop: true }, '', location.href);
    stopViews.classList.replace('lm-view-list', 'lm-view-detail');
    window.scrollTo(0, 0);
  }
  stopViews.dataset.origin = origin;
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
      button.dataset.origin = origin;
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
 * 編集するフローを選びます。空の文字列の場合は、どれも選ばずに一覧の画面に戻ります。
 * @param {string} id
 * @param {{ history?: 'push' | 'replace' | 'none' }} [options] history：URL の履歴の扱い。
 *   一覧からフローを開くときは push にし、ブラウザーの［戻る］で一覧に戻れるようにします
 */
function select(id, { history: mode = 'replace' } = {}) {
  selectedId = id;
  const url = id ? `#${encodeURIComponent(id)}` : location.pathname;
  if (mode === 'push') {
    history.pushState({ lmDetail: true }, '', url);
  } else if (mode === 'replace') {
    history.replaceState(id ? history.state : null, '', url);
  }
  elements.importer.hidden = true;
  // 別のフローを選んだら、前のフローへの確認と誤りの表示を消します。
  for (const container of [elements.importConfirm, elements.editorConfirm]) {
    container.replaceChildren();
    container.hidden = true;
  }
  clearNotices();
  showRenameForm(false);
  hideRunForm();
  showParamsForm(null);
  // 別のフローを選んだら、JSON の編集欄ではなく内容の表示から見せます。ほかのタブは選んだままにし、
  // フローを見比べられるようにします（#132）。
  if (detailTab === 'json') {
    selectDetailTab('steps');
  }
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
  showDetailView(Boolean(stored) || !elements.importer.hidden);
  if (stored && elements.editor.dataset.id !== stored.id) {
    // 編集中の内容を上書きしないよう、別のフローを選んだときだけ JSON を入れ替えます。
    elements.editor.dataset.id = stored.id;
    setMoreOpen(false);
    elements.json.value = JSON.stringify(orderFlow(stored.flow), null, 2);
    jsonDirty = false;
    loadBlocks(stored.flow.steps);
    fillSpeedFields(stored.flow);
    await fillScheduleFields(stored.id);
  }
  if (stored) {
    // ほかの場所（［JSON］タブ、別の画面）で手順が変わった場合は、ブロックを保存済みの内容に合わせます。
    // ブロックに保存していない変更がある間は、その変更を消さないよう入れ替えません。
    if (!blockEditor.dirty && JSON.stringify(stored.flow.steps) !== loadedSteps) {
      loadBlocks(stored.flow.steps);
    }
    shownFlow = stored.flow;
    renderDetail(stored);
    await renderSchedule(stored);
    await renderRunButtons(stored.flow);
  } else {
    shownFlow = null;
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
  // 追加のサイト（#41）があれば、続けて表示します。
  elements.editorOrigin.textContent = flowOrigins(flow).join('、');
  elements.editor.dataset.origins = JSON.stringify(flowOrigins(flow));

  const params = flow.params ?? [];
  // 手順の番号と件数は、if と forEach の内側を展開した通し番号で数えます（#6）。
  const flattened = flattenSteps(flow.steps);
  const secrets = flattened.flatMap(({ step, number }) =>
    step.type === 'input' && step.secret ? [{ step, index: number }] : [],
  );
  const inputs = params.length + secrets.length;
  // 項目ごとに折り返さない範囲にし、日付と時刻が別の行に分かれないようにします（#137）。
  const metaParts = [
    `手順 ${flattened.length} 件`,
    inputs > 0 ? `実行時に入力 ${inputs} 項目` : '',
    `作成 ${formatDateTime(createdAt)}`,
    `更新 ${formatDateTime(updatedAt)}`,
  ].filter(Boolean);
  elements.editorMeta.replaceChildren(
    ...metaParts.flatMap((text, index) => {
      const part = document.createElement('span');
      part.className = 'lm-nowrap';
      part.textContent = text;
      return index === 0 ? [part] : ['・', part];
    }),
  );

  elements.params.hidden = inputs === 0;
  elements.paramsEmpty.hidden = inputs > 0;
  elements.paramsBody.replaceChildren(
    ...params.map((param) => {
      const { label, reference, type, defaultValue } = paramColumns(param);
      return paramTableRow([label, reference, type, defaultValue]);
    }),
    // パスワードなど、値を記録しない入力です。名前がないため、手順での書き方は空欄にします。
    ...secrets.map(({ step, index }) =>
      paramTableRow([
        `${step.type === 'input' ? step.target.label : ''}（手順 ${index + 1}）`,
        '―',
        '記録しない値（実行するときに入力）',
        'なし',
      ]),
    ),
  );

  elements.stepCount.textContent = String(flattened.length);
}

/**
 * 実行時に入力する値の表の 1 行です。2 列目（手順での書き方）は、コードの書式で表示します。
 * @param {string[]} cells 表示名、手順での書き方、種類、既定値
 * @returns {HTMLTableRowElement}
 */
function paramTableRow(cells) {
  const row = document.createElement('tr');
  for (const [index, text] of cells.entries()) {
    const cell = document.createElement('td');
    if (index === 1 && text.startsWith('{{')) {
      // 押すとコピーします。ブロックの欄に貼り付けて使うためです。ダブルクリックでも同じく動きます。
      const code = document.createElement('code');
      code.textContent = text;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn-sm btn-ghost-secondary lm-copy-ref';
      copy.title = '押すとコピーします';
      copy.setAttribute('aria-label', `${text} をコピー`);
      copy.append(code);
      copy.addEventListener('click', async () => {
        clearNotices();
        try {
          await navigator.clipboard.writeText(text);
          showToast(
            elements.toast,
            `${text} をコピーしました。手順のブロックの欄に貼り付けて使えます。`,
          );
        } catch (error) {
          showNotice(
            elements.paramsEditNotice,
            `コピーできませんでした。${String(error)}`,
            'error',
          );
        }
      });
      cell.append(copy);
    } else {
      cell.textContent = text;
    }
    row.append(cell);
  }
  return row;
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
  detail.textContent = `手順 ${flattenSteps(stored.flow.steps).length} 件・更新 ${formatDateTime(stored.updatedAt)}`;
  const button = listButton(stored.flow.name, detail);
  button.className = 'list-group-item-action lm-flow-open';
  button.addEventListener('click', async () => {
    if (stored.id !== selectedId && !(await confirmDiscardBlocks(row, '別のフローを開く'))) {
      return;
    }
    select(stored.id, { history: 'push' });
  });

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

// ---- 設定（#41） ----
// 「すべてのサイトを許可」は、Chrome のサイトの許可そのものを表示し、切り替えます。拡張機能には保存しません。
// Chrome の拡張機能の画面など、ほかの場所で許可を変えた場合も、表示を合わせます。

/** 「すべてのサイトを許可」の表示を、Chrome の許可に合わせます。 */
async function renderAllSites() {
  elements.allSites.checked = await hasAllSites();
}

elements.allSites.addEventListener('change', async () => {
  clearNotices();
  // 許可を求める処理は、操作の直後に呼び出す必要があります。この前に待ち時間を入れないでください。
  if (elements.allSites.checked) {
    const granted = await chrome.permissions.request({ origins: ALL_SITES }).catch(() => false);
    if (!granted) {
      showNotice(
        elements.allSitesNotice,
        '許可が得られなかったため、オンにできませんでした。もう一度押し、表示される画面で「許可」を選んでください。',
        'error',
      );
    } else {
      showToast(elements.toast, 'すべてのサイトを許可しました。');
    }
  } else {
    await chrome.permissions.remove({ origins: ALL_SITES }).catch(console.error);
    showToast(
      elements.toast,
      'すべてのサイトの許可を外しました。個別に許可したサイトは、そのまま残ります。',
    );
  }
  await renderAllSites();
});

chrome.permissions.onAdded.addListener(() => {
  renderAllSites().catch(console.error);
});
chrome.permissions.onRemoved.addListener(() => {
  renderAllSites().catch(console.error);
});
renderAllSites().catch(console.error);

// ---- バックアップ（#17） ----
// すべてのフロー、まとめフロー、必ず止まる場所を 1 つのファイルに書き出し、ファイルから追加します。
// 復元は追加だけを行い、既存のデータを消しません。

elements.backupExport.addEventListener('click', async () => {
  clearNotices();
  const backup = await exportBackup();
  downloadJson(`${JSON.stringify(backup, null, 2)}\n`, backupFileName(new Date()));
  // パラメータの既定値に個人の情報を入れている場合に備え、ファイルに含まれることを知らせます。
  showToast(
    elements.toast,
    `フロー ${backup.flows.length} 件、まとめフロー ${backup.batches.length} 件、` +
      `必ず止まる場所 ${Object.keys(backup.stopRules).length} サイトを書き出しました。` +
      '実行時に入力する値の既定値も含まれます。',
  );
});

elements.backupRestore.addEventListener('click', () => {
  clearNotices();
  elements.backupFile.click();
});

elements.backupFile.addEventListener('change', async () => {
  const file = elements.backupFile.files?.[0];
  if (!file) {
    return;
  }
  // 同じファイルを続けて選んだ場合も change が起きるよう、読み取る前に選択を消します。
  elements.backupFile.value = '';
  clearNotices();
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(await file.text());
  } catch (error) {
    showNotice(elements.backupNotice, `JSON として読み取れません。${String(error)}`, 'error');
    return;
  }
  const parsed = parseBackup(value);
  if (!parsed.ok) {
    showNotice(
      elements.backupNotice,
      `形式に誤りがあるため、復元しませんでした。\n${parsed.errors.join('\n')}`,
      'error',
    );
    return;
  }
  const plan = await previewRestore(parsed.backup);
  const skipped = restoreSkippedText(plan);
  const addedCount = plan.flows.length + plan.batches.length + Object.keys(plan.stopRules).length;
  if (addedCount === 0) {
    showNotice(
      elements.backupNotice,
      `このバックアップの内容はすべて保存済みです。何も追加しませんでした。\n${skipped}`,
      'info',
    );
    return;
  }
  // 他人から受け取ったファイルは、ログイン中のサイトで意図しない操作を行う可能性があります（#14）。
  const flowLines = plan.flows.map(
    (stored) => `・${stored.flow.name}（${flowOrigins(stored.flow).join('、')}）`,
  );
  const confirmed = await confirmInline(elements.backupConfirm, {
    message:
      `フロー ${plan.flows.length} 件、まとめフロー ${plan.batches.length} 件、` +
      `必ず止まる場所 ${Object.keys(plan.stopRules).length} サイトを追加します。` +
      '今あるデータは消しません。' +
      (flowLines.length > 0
        ? '各フローは、括弧内のサイトを操作します。自分で書き出したファイルか、信頼できるファイルだけを復元してください。\n' +
          flowLines.join('\n')
        : '') +
      (skipped ? `\n${skipped}` : ''),
    confirmLabel: '復元する',
    hide: [elements.backupButtons],
  });
  if (!confirmed) {
    return;
  }
  const result = await restoreBackup(parsed.backup);
  showToast(
    elements.toast,
    `フロー ${result.flows.length} 件、まとめフロー ${result.batches.length} 件、` +
      `必ず止まる場所 ${Object.keys(result.stopRules).length} サイトを復元しました。` +
      restoreSkippedText(result),
  );
});

/**
 * 復元で追加しないものの説明です。ない場合は空の文字列です。
 * @param {import('../shared/backup.js').RestorePlan} plan
 * @returns {string}
 */
function restoreSkippedText(plan) {
  const parts = [
    plan.duplicateFlows.length > 0 ? `同じ内容のフロー ${plan.duplicateFlows.length} 件` : '',
    plan.skippedBatches.length > 0 ? `同じまとめフロー ${plan.skippedBatches.length} 件` : '',
    plan.skippedStopOrigins.length > 0
      ? `必ず止まる場所が指定済みのサイト（${plan.skippedStopOrigins.join('、')}）`
      : '',
  ].filter(Boolean);
  return parts.length > 0 ? `保存済みのため追加しないもの：${parts.join('、')}。` : '';
}
