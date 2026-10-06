// サイドパネルです。記録の開始・停止、記録したフローの保存、保存したフローの一覧と実行、
// 実行の状態を表示します。Web ページを表示しているときはそのサイトのフローを、それ以外のページ
// （新しいタブなど）ではすべてのフローを、ホスト名ごとにまとめて検索できる形で表示します（#44）。
// 配置と、知らせを出す場所は docs/design-guidelines.md に従います。成功は画面の上部のトーストに出し、
// 誤り・警告・確認は押したボタンの直下（行の中の操作は、その行の中）に出します。

import { SCHEDULES_KEY, listSchedules } from '../common/schedule-store.js';
import {
  CONFIRM_DETECTION_KEY,
  CONFIRM_DETECTION_SCHEDULE_KEY,
  getConfirmDetectionSettings,
} from '../common/confirm-detection-store.js';
import { formatRunAt, nextRunAt } from '../shared/schedule.js';
import { confirmDetectionMarks } from '../shared/purchase-guard.js';
import {
  deleteFlow,
  getFlow,
  listFlows,
  onFlowsChanged,
  renameFlow,
  saveFlow,
} from '../common/flow-store.js';
import { listBatches, onBatchesChanged } from '../common/batch-store.js';
import { requestPermission } from '../common/permissions.js';
import {
  BATCH_RUN_KEY_PREFIX,
  batchItemLabel,
  batchItemTone,
  batchOverall,
  batchProblems,
  batchRunsFrom,
  batchSummary,
  hasWaitingFollower,
  isBatchFinished,
  needsAttention,
} from '../shared/batch.js';
import {
  describeStep,
  formatDateTime,
  runDetailText,
  runStatusLabel,
  runStatusTone,
} from '../shared/describe.js';
import { flattenSteps, stepAt } from '../shared/control-flow.js';
import { MAX_EXTRA_ORIGINS, flowOrigins, orderFlow } from '../shared/flow.js';
import { DECLINED_SITES_KEY, siteNotice, siteNoticeText } from '../shared/site-notice.js';
import { createLoopForm } from './loop-form.js';
import { pagerLoops } from '../shared/record-loop.js';
import {
  RUN_KEY_PREFIX,
  conflictMessage,
  findConflictingRun,
  flowsToShow,
  isActiveRun,
  pageOrigin,
  runStatesFrom,
} from '../shared/flow-list.js';
import { attachCombobox } from '../shared/combobox.js';
import { buildFlowGroups } from '../shared/flow-groups.js';
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
  confirmInline,
  followColorScheme,
  showFieldError,
  showNotice,
  showToast,
} from '../shared/ui.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('../background/recording.js').Recording} Recording */
/** @typedef {import('../background/recording.js').RecordingPage} RecordingPage */
/** @typedef {import('../shared/record-loop.js').RowHint} RowHint */
/** @typedef {import('../shared/record-loop.js').PagerHint} PagerHint */
/** @typedef {import('../background/runner.js').RunState} RunState */
/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */
/** @typedef {import('../common/batch-store.js').StoredBatch} StoredBatch */
/** @typedef {import('../shared/batch.js').BatchRun} BatchRun */
/** @typedef {import('../shared/ui.js').NoticeKind} NoticeKind */

const elements = {
  pageOrigin: byId('page-origin'),
  runSection: byId('run-section'),
  runs: byId('runs'),
  batchEmpty: byId('batch-empty'),
  batchNoMatch: byId('batch-no-match'),
  batchSearchArea: byId('batch-search-area'),
  batchSearch: /** @type {HTMLInputElement} */ (byId('batch-search')),
  batchSearchSuggestions: byId('batch-search-suggestions'),
  batchSearchMode: /** @type {HTMLSelectElement} */ (byId('batch-search-mode')),
  tabFlows: byId('tab-flows'),
  batchList: byId('batch-list'),
  formSection: byId('form-section'),
  formHeading: byId('form-heading'),
  formDescription: byId('form-description'),
  formSubmit: byId('form-submit'),
  form: /** @type {HTMLFormElement} */ (byId('run-form')),
  formFields: byId('form-fields'),
  formCancel: byId('form-cancel'),
  formNotice: byId('form-notice'),
  recordingSection: byId('recording-section'),
  recordingOrigin: byId('recording-origin'),
  recordingSite: byId('recording-site'),
  siteNotice: byId('site-notice'),
  siteNoticeFull: byId('site-notice-full'),
  siteNoticeTitle: byId('site-notice-title'),
  siteNoticeBody: byId('site-notice-body'),
  siteNoticeAllow: /** @type {HTMLButtonElement} */ (byId('site-notice-allow')),
  siteNoticeSkip: /** @type {HTMLButtonElement} */ (byId('site-notice-skip')),
  siteNoticeNotice: byId('site-notice-notice'),
  siteNoticeCollapsed: byId('site-notice-collapsed'),
  siteNoticeCollapsedText: byId('site-notice-collapsed-text'),
  siteNoticeExpand: /** @type {HTMLButtonElement} */ (byId('site-notice-expand')),
  recordingNotice: byId('recording-notice'),
  stepCount: byId('step-count'),
  steps: byId('steps'),
  stop: /** @type {HTMLButtonElement} */ (byId('stop')),
  recordingDiscard: /** @type {HTMLButtonElement} */ (byId('recording-discard')),
  recordingLoop: /** @type {HTMLButtonElement} */ (byId('recording-loop')),
  recordingLoopForm: byId('recording-loop-form'),
  resultLoop: /** @type {HTMLButtonElement} */ (byId('result-loop')),
  resultLoopForm: byId('result-loop-form'),
  recordingButtons: byId('recording-buttons'),
  resultButtons: byId('result-buttons'),
  main: byId('main'),
  recordingConfirm: byId('recording-confirm'),
  recordingDiscardNotice: byId('recording-discard-notice'),
  resultSection: byId('result-section'),
  resultNotice: byId('result-notice'),
  flowName: /** @type {HTMLInputElement} */ (byId('flow-name')),
  flowNameFeedback: byId('flow-name-feedback'),
  saveFlow: byId('save-flow'),
  discard: /** @type {HTMLButtonElement} */ (byId('discard')),
  resultConfirm: byId('result-confirm'),
  saveNotice: byId('save-notice'),
  resultStepCount: byId('result-step-count'),
  resultSteps: byId('result-steps'),
  result: /** @type {HTMLTextAreaElement} */ (byId('result')),
  copy: byId('copy'),
  save: byId('save'),
  jsonNotice: byId('json-notice'),
  start: /** @type {HTMLButtonElement} */ (byId('start')),
  flowsNotice: byId('flows-notice'),
  flows: byId('flows'),
  flowsEmpty: byId('flows-empty'),
  flowsReason: byId('flows-reason'),
  batchReason: byId('batch-reason'),
  toast: byId('toast'),
  flowsHeading: byId('flows-heading'),
  flowsAsideScope: byId('flows-aside-scope'),
  searchArea: byId('search-area'),
  search: /** @type {HTMLInputElement} */ (byId('search')),
  searchSuggestions: byId('search-suggestions'),
  searchMode: /** @type {HTMLSelectElement} */ (byId('search-mode')),
};

/** 記録した手順を、一覧の各行で繰り返す手順に変える欄です（#167）。記録中と保存前の区画に 1 つずつ置きます。 */
const recordingLoopForm = createLoopForm({
  open: elements.recordingLoop,
  container: elements.recordingLoopForm,
  list: elements.steps,
  toast: elements.toast,
  pick: true,
});
const resultLoopForm = createLoopForm({
  open: elements.resultLoop,
  container: elements.resultLoopForm,
  list: elements.resultSteps,
  toast: elements.toast,
});

/** 区画に固定で置いた知らせの表示欄です。次の操作を始めるときに、まとめて消します。 */
const notices = [
  elements.formNotice,
  elements.recordingNotice,
  elements.recordingDiscardNotice,
  elements.siteNoticeNotice,
  elements.resultNotice,
  elements.saveNotice,
  elements.jsonNotice,
  elements.flowsNotice,
];

/**
 * 表示中のタブです。記録開始のボタンを押したときに、許可を求める画面を待たせずに出せるよう、
 * あらかじめ調べておきます。Chrome は、ボタンを押した直後にしか許可を求める画面を出さないためです。
 * @type {{ tabId: number, origin: string | null } | null}
 */
let currentPage = null;

/** 入力フォームを表示しているフローの id です。 */
let formFlowId = '';

/** 入力フォームで行う操作です。実行する（run）か、最初のページを開く（open）か、まとめて実行する（batch、#7）かです。 */
/** @type {'run' | 'open' | 'batch'} */
let formMode = 'run';

/**
 * まとめフローの入力フォームの内容です（#7）。値の入力が必要なフローごとに、欄をまとめた要素を持ちます。
 * mode は、まとめて実行する（run）か、各フローの最初のページを開く（open）かです。
 * flows は、まとめフローに含めたすべてのフロー（登録した順）です。開くときに使います。
 * @type {{ batch: StoredBatch, mode: 'run' | 'open', flows: StoredFlow[], groups: { flowId: string, params: import('../shared/params.js').Param[], element: HTMLElement }[] } | null}
 */
let formBatch = null;

/** 入力フォームを作ったときのパラメータです。送信時の検証に使います。 */
/** @type {import('../shared/params.js').Param[]} */
let formParams = [];

/**
 * 一覧で名前を変更している、または削除の確認を表示しているフローです。
 * 実行中は状態が頻繁に変わるため、一覧を作り直しても入力中の名前が消えないよう、ここに保持します。
 * error は、名前の入力欄の直下に出す誤りです。
 * @type {{ id: string, mode: 'rename' | 'delete', name: string, error: string } | null}
 */
let editing = null;

/** 「その他」の操作を開いている行のフローの id です。一覧を作り直しても開いたままにします。 */
let menuOpenId = '';

/**
 * 一覧の行の中に出す知らせです。キーはフローの id です。一覧を作り直しても消えないよう、ここに保持します。
 * @type {Map<string, { text: string, kind: NoticeKind }>}
 */
const rowNotices = new Map();

followColorScheme(document.documentElement, matchMedia('(prefers-color-scheme: dark)'));

/** 前の操作の知らせを消します。操作を始めるときに呼びます。 */
function clearNotices() {
  for (const notice of notices) {
    showNotice(notice, '');
  }
  rowNotices.clear();
  batchRowNotices.clear();
  batchRunNotices.clear();
  menuOpenId = '';
}

// ---- タブ（#7） ----
// ［このサイトのフロー］と［まとめフロー］を切り替えます。WAI-ARIA の Tabs パターンに従います
// （https://www.w3.org/WAI/ARIA/apg/patterns/tabs/）。進行中の作業はタブの上に置くため、切り替えても見えます。
// 選んだタブは保存しません。サイドパネルを開き直すと［このサイトのフロー］に戻ります。

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

selectTab('flows');

// ---- 記録 ----

elements.start.addEventListener('click', async () => {
  if (!currentPage?.origin) {
    return;
  }
  clearNotices();
  const { tabId, origin } = currentPage;
  const denied = await requestPermission(origin);
  if (denied) {
    showNotice(elements.flowsNotice, denied, 'error');
    return;
  }
  const response = await chrome.runtime.sendMessage({ kind: 'recording/start', tabId });
  if (!response?.ok) {
    showNotice(elements.flowsNotice, response?.error ?? '記録を開始できません。', 'error');
  }
});

// 記録中に、許可がないサイトへ移動したときと、許可がない画面に見える枠があるときの、サイドパネルの最上部の知らせの
// ボタンです（#209、#230）。
// ［このサイトを許可して記録を続ける］で許可を得てから、そのページでも記録を続けます。
// Chrome は利用者の操作を起点にしか許可を求められないため、ボタンで求めます。
elements.siteNoticeAllow.addEventListener('click', async () => {
  clearNotices();
  const origin = elements.siteNotice.dataset.origin ?? '';
  if (!origin) {
    return;
  }
  // 許可を求める処理は、ボタンを押した直後に呼び出す必要があります。この前に待ち時間を入れないでください。
  const denied = await requestPermission(origin);
  if (denied) {
    showNotice(elements.siteNoticeNotice, denied, 'error');
    return;
  }
  const response = await chrome.runtime.sendMessage({ kind: 'recording/allowOrigin', origin });
  if (!response?.ok) {
    showNotice(
      elements.siteNoticeNotice,
      response?.error ?? 'このサイトでは記録できません。',
      'error',
    );
  }
});

// ［このサイトは記録しない］では、同じ記録の間、そのサイトの知らせを 1 行に畳みます。サイドパネルを開き直しても
// 畳んだままにするため、chrome.storage.session に保存します。記録を始める・止めるときに Service Worker が消します。
elements.siteNoticeSkip.addEventListener('click', async () => {
  clearNotices();
  const origin = elements.siteNotice.dataset.origin ?? '';
  if (!origin) {
    return;
  }
  const stored = await chrome.storage.session.get(DECLINED_SITES_KEY);
  const declined = /** @type {string[]} */ (stored[DECLINED_SITES_KEY] ?? []);
  await chrome.storage.session.set({ [DECLINED_SITES_KEY]: [...new Set([...declined, origin])] });
});

// 畳んだ知らせの［許可する］です。説明とボタンを開き直します。
elements.siteNoticeExpand.addEventListener('click', async () => {
  clearNotices();
  const origin = elements.siteNotice.dataset.origin ?? '';
  const stored = await chrome.storage.session.get(DECLINED_SITES_KEY);
  const declined = /** @type {string[]} */ (stored[DECLINED_SITES_KEY] ?? []);
  await chrome.storage.session.set({
    [DECLINED_SITES_KEY]: declined.filter((site) => site !== origin),
  });
});

elements.stop.addEventListener('click', async () => {
  clearNotices();
  const response = await chrome.runtime.sendMessage({ kind: 'recording/stop' });
  if (!response?.ok) {
    showNotice(elements.recordingNotice, response?.error ?? '記録を停止できません。', 'error');
    return;
  }
  if (!response.flow) {
    // 手順をすべて削除していた場合は、保存するものがないため、記録を破棄しています。
    showToast(elements.toast, '記録した手順がないため、記録を破棄しました。', { kind: 'info' });
    return;
  }
  elements.flowName.value = response.flow.name;
  showFieldError(elements.flowName, elements.flowNameFeedback, '');
  if (response.errors.length > 0) {
    showNotice(
      elements.resultNotice,
      `記録した内容の形式に誤りがあります。\n${response.errors.join('\n')}`,
      'error',
    );
  }
});

elements.saveFlow.addEventListener('click', async () => {
  clearNotices();
  const lastFlow = await getLastFlow();
  if (!lastFlow) {
    return;
  }
  const name = elements.flowName.value.trim();
  if (!name) {
    showFieldError(elements.flowName, elements.flowNameFeedback, 'フロー名を入力してください。');
    elements.flowName.focus();
    return;
  }
  showFieldError(elements.flowName, elements.flowNameFeedback, '');
  const result = await saveFlow({ ...lastFlow, name });
  if (!result.ok) {
    showNotice(elements.saveNotice, `保存できませんでした。\n${result.errors.join('\n')}`, 'error');
    return;
  }
  await chrome.storage.session.remove(['lastFlow', 'lastFlowRowHints', 'lastFlowPagerHints']);
  showSaved(result.id, name, result.name);
});

elements.discard.addEventListener('click', async () => {
  clearNotices();
  const confirmed = await confirmInline(elements.resultConfirm, {
    message: '記録した手順を破棄します。元に戻せません。',
    confirmLabel: '破棄する',
    danger: true,
    hide: [elements.resultButtons],
  });
  if (!confirmed) {
    return;
  }
  await resetRecording(elements.saveNotice, '記録した手順を破棄しました。');
});

elements.recordingDiscard.addEventListener('click', async () => {
  clearNotices();
  const confirmed = await confirmInline(elements.recordingConfirm, {
    message: '記録を停止し、記録した手順を破棄します。元に戻せません。',
    confirmLabel: '破棄する',
    danger: true,
    hide: [elements.recordingButtons, elements.stop],
  });
  if (!confirmed) {
    return;
  }
  await resetRecording(
    elements.recordingDiscardNotice,
    '記録を停止し、記録した手順を破棄しました。',
  );
});

/**
 * 記録した手順を破棄します。記録中の場合は、記録を停止してから破棄します。
 * 破棄すると区画が閉じるため、成功の知らせは画面の上部のトーストに出します。
 * @param {HTMLElement} errorNotice 失敗したときに知らせを出す場所
 * @param {string} doneMessage
 */
async function resetRecording(errorNotice, doneMessage) {
  const response = await chrome.runtime.sendMessage({ kind: 'recording/reset' });
  if (!response?.ok) {
    showNotice(errorNotice, response?.error ?? '記録を破棄できません。', 'error');
    return;
  }
  showToast(elements.toast, doneMessage, { kind: 'info' });
}

/**
 * 記録中、または保存前の手順を 1 件削除します。
 * @param {number} index 削除する手順の番号（0 から数えます）
 * @param {number} count 表示している手順の件数。表示が古い場合に別の手順を消さないよう、一緒に送ります
 * @param {HTMLElement} errorNotice 失敗したときに知らせを出す場所
 */
async function removeStep(index, count, errorNotice) {
  clearNotices();
  const response = await chrome.runtime.sendMessage({ kind: 'recording/removeStep', index, count });
  if (!response?.ok) {
    showNotice(errorNotice, response?.error ?? '手順を削除できません。', 'error');
    await render();
  }
}

/**
 * 繰り返しを作った後に記録した「次へ」のクリックを、その繰り返しのページ送りにします（#237）。
 * @param {number} index 「次へ」のクリックの番号（0 から数えます）
 * @param {number} count 表示している手順の件数
 * @param {HTMLElement} errorNotice 失敗したときに知らせを出す場所
 */
async function attachStepPager(index, count, errorNotice) {
  clearNotices();
  const response = await chrome.runtime.sendMessage({
    kind: 'recording/attachPager',
    index,
    count,
  });
  if (!response?.ok) {
    showNotice(errorNotice, response?.error ?? 'ページ送りにできません。', 'error');
    await render();
    return;
  }
  showToast(elements.toast, '次のページの注文も、最後のページまで続けて処理するようにしました。');
}

elements.flowName.addEventListener('input', () => {
  if (elements.flowName.value.trim()) {
    showFieldError(elements.flowName, elements.flowNameFeedback, '');
  }
});

elements.copy.addEventListener('click', async () => {
  clearNotices();
  try {
    await navigator.clipboard.writeText(elements.result.value);
    showToast(elements.toast, 'JSON をコピーしました。');
  } catch (error) {
    showNotice(elements.jsonNotice, `コピーできませんでした。${String(error)}`, 'error');
  }
});

elements.save.addEventListener('click', () => {
  downloadJson(elements.result.value, `lightomate-${timestamp()}.json`);
});

// ---- 実行 ----

/**
 * 実行のボタンを押したときの処理です。誤りは、そのフローの行の中に表示します。
 * @param {StoredFlow} stored
 */
async function onRunClick(stored) {
  clearNotices();
  // 許可を求める処理は、ボタンを押した直後に呼び出す必要があります。この前に待ち時間を入れないでください。
  // フローが操作するすべてのサイト（#41）の許可を、1 回の確認でまとめて求めます。
  const denied = await requestPermission(flowOrigins(stored.flow));
  if (denied) {
    setRowNotice(stored.id, denied, 'error');
    return;
  }
  const params = stored.flow.params ?? [];
  const secretSteps = secretStepIndexes(stored.flow);
  if (params.length === 0 && secretSteps.length === 0) {
    const error = await startRun(stored.id, {}, {});
    if (error) {
      setRowNotice(stored.id, error, 'error');
    }
    return;
  }
  showForm(stored, 'run');
}

/**
 * ［開く］のボタンを押したときの処理です。最初の手順の URL を新しいタブで開き、手順は実行しません。
 * URL がパラメータを参照する場合は、先に値を尋ねます。
 * @param {StoredFlow} stored
 */
async function onOpenClick(stored) {
  clearNotices();
  if (firstPageParams(stored.flow).length > 0) {
    showForm(stored, 'open');
    return;
  }
  const error = await openFirstPage(stored, {});
  if (error) {
    setRowNotice(stored.id, error, 'error');
  }
}

/**
 * @param {StoredFlow} stored
 * @param {Record<string, string>} params
 * @returns {Promise<string>} 開けなかった理由。開いた場合は空の文字列
 */
async function openFirstPage(stored, params) {
  const result = firstPageUrl(stored.flow, params, new Date());
  if (!result.ok) {
    return result.error;
  }
  await chrome.tabs.create({ url: result.url, active: true });
  return '';
}

/**
 * 値の入力フォームを表示します。
 * 実行する場合は、パラメータごとの入力欄と、値を記録していない入力欄（パスワードなど）ごとの入力欄を作ります。
 * 最初のページを開く場合は、その URL が参照するパラメータの入力欄だけを作ります。
 * @param {StoredFlow} stored
 * @param {'run' | 'open'} mode
 */
function showForm(stored, mode) {
  formFlowId = stored.id;
  formMode = mode;
  const open = mode === 'open';
  elements.formHeading.textContent = open ? '開くページの値の入力' : '実行する値の入力';
  elements.formDescription.textContent = open
    ? `「${stored.flow.name}」の最初のページを開きます。入力した値は保存しません。`
    : `「${stored.flow.name}」を実行します。入力した値は保存しません。`;
  elements.formSubmit.textContent = open ? 'この値で開く' : 'この値で実行';
  const params = open ? firstPageParams(stored.flow) : (stored.flow.params ?? []);
  formParams = params;
  const fields = buildRunFields(document, stored.flow, {
    params,
    secretSteps: open ? [] : secretStepIndexes(stored.flow),
    now: new Date(),
  });

  elements.formFields.replaceChildren(...fields);
  showNotice(elements.formNotice, '');
  elements.formSection.hidden = false;
  // 入力フォームを開いている間は、一覧の［実行］などを隠します。押すボタンをフォームの中に絞るためです（#112）。
  elements.main.classList.add('lm-form-open');
  elements.formSection.scrollIntoView({ block: 'start' });
  const first = elements.formFields.querySelector('input, select');
  if (first instanceof HTMLElement) {
    first.focus();
  }
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotices();
  if (formMode === 'batch') {
    await submitBatchForm();
    return;
  }
  if (showRunFieldErrors(elements.form, formParams, new Date())) {
    return;
  }
  const { params, secrets } = readRunFields(new FormData(elements.form));
  const stored = formMode === 'open' ? await getFlow(formFlowId) : undefined;
  const error =
    formMode === 'open'
      ? stored
        ? await openFirstPage(stored, params)
        : 'フローが見つかりません。'
      : await startRun(formFlowId, params, secrets);
  if (error) {
    showNotice(elements.formNotice, error, 'error');
    return;
  }
  hideForm();
});

elements.formCancel.addEventListener('click', hideForm);

/**
 * @param {string} flowId
 * @param {Record<string, string>} params
 * @param {Record<string, string>} secrets
 * @returns {Promise<string>} 実行を始められなかった理由。始められた場合は空の文字列
 */
async function startRun(flowId, params, secrets) {
  const response = await chrome.runtime.sendMessage({
    kind: 'runner/start',
    flowId,
    params,
    secrets,
  });
  return response?.ok ? '' : (response?.error ?? '実行を開始できません。');
}

function hideForm() {
  elements.formSection.hidden = true;
  elements.main.classList.remove('lm-form-open');
  formParams = [];
  formBatch = null;
  // 入力したパスワードなどを画面に残さないよう、入力欄ごと消します。
  elements.formFields.replaceChildren();
  showNotice(elements.formNotice, '');
  formFlowId = '';
}

// ---- 表示の更新 ----

// 記録と実行の状態は Service Worker が chrome.storage.session に書き込みます。
chrome.storage.session.onChanged.addListener(() => {
  render().catch(console.error);
});
onFlowsChanged(() => {
  renderFlows().catch(console.error);
});
onBatchesChanged(() => {
  renderFlows().catch(console.error);
});
/**
 * 確定ボタンの自動検出（#47）が無効の間だけ、見出しの横に状態の印を表示します（#222）。
 * 定期実行でも無効にしている場合は、その印を加えます。印の説明は、マウスを重ねたときと読み上げで伝えます。
 */
async function renderConfirmDetection() {
  const marks = confirmDetectionMarks(await getConfirmDetectionSettings());
  const container = /** @type {HTMLElement} */ (document.getElementById('confirm-detection-off'));
  container.replaceChildren(
    ...marks.map(({ label, description }) => {
      const mark = document.createElement('span');
      mark.className = 'lm-status lm-status-warning';
      mark.title = description;
      const detail = document.createElement('span');
      detail.className = 'visually-hidden';
      detail.textContent = `：${description}`;
      mark.append(label, detail);
      return mark;
    }),
  );
  container.hidden = marks.length === 0;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === 'local' &&
    (CONFIRM_DETECTION_KEY in changes || CONFIRM_DETECTION_SCHEDULE_KEY in changes)
  ) {
    renderConfirmDetection().catch(console.error);
  }
});
renderConfirmDetection().catch(console.error);

// 定期実行（#22）の予約を変えたとき、または予約の日時を処理したときに、次の予約の日時を表示し直します。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SCHEDULES_KEY in changes) {
    renderFlows().catch(console.error);
  }
});

// 表示中のタブや、そのタブのページが変わったときに、記録するページとフローの一覧を更新します。
chrome.tabs.onActivated.addListener(() => {
  refreshCurrentPage().catch(console.error);
});
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && details.tabId === currentPage?.tabId) {
    refreshCurrentPage().catch(console.error);
  }
});

refreshCurrentPage().catch(console.error);

/** 表示中のタブと、そのページのオリジンを調べ直します。 */
async function refreshCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    currentPage = null;
  } else {
    // chrome:// のページなど、拡張機能から調べられないページでは失敗することがあります。
    const frame = await chrome.webNavigation
      .getFrame({ tabId: tab.id, frameId: 0 })
      .catch(() => null);
    currentPage = { tabId: tab.id, origin: pageOrigin(frame?.url) };
  }
  await renderFlows();
}

/**
 * 記録中のタブが、記録を始めたサイト以外の、許可があるサイトのページを表示しているときに、確認を出さずに
 * 記録していることを知らせます（#41）。許可がないサイトと、許可がない画面に見える枠の知らせは、サイドパネルの
 * 最上部に出します（#209、#230、renderSiteNotice）。
 * @param {Recording} recording
 * @param {RecordingPage | undefined} page
 */
function renderRecordingSite(recording, page) {
  const other = page && page.origin !== recording.origin && page.allowed ? page : undefined;
  elements.recordingSite.hidden = !other;
  elements.recordingSite.textContent = other ? `${other.origin} でも記録しています。` : '';
}

/**
 * 記録中に、許可がないサイトへ移動したときと、表示中のページに許可がない画面に見える枠（iframe）があるときの
 * 知らせを、サイドパネルの最上部に表示します（#209、#230）。どちらも同じ見せ方にし、文言だけ変えます。
 * 知らせが要らない場合は隠します。［このサイトは記録しない］を選んだサイトでは、1 行に畳みます。
 * @param {Recording | undefined} recording
 * @param {RecordingPage | undefined} page
 * @param {string[]} declined 同じ記録の間に、記録しないと選んだサイト
 */
function renderSiteNotice(recording, page, declined) {
  const notice = recording
    ? siteNotice({
        recordingOrigin: recording.origin,
        page,
        extraOrigins: recording.extraOrigins ?? [],
        declined,
        maxExtraOrigins: MAX_EXTRA_ORIGINS,
      })
    : null;
  const wasHidden = elements.siteNotice.hidden;
  const previous = elements.siteNotice.dataset.origin;
  elements.siteNotice.hidden = !notice;
  elements.siteNotice.dataset.origin = notice?.origin ?? '';
  if (!notice) {
    return;
  }
  const text = siteNoticeText(notice, MAX_EXTRA_ORIGINS);
  elements.siteNoticeFull.hidden = notice.mode !== 'full';
  elements.siteNoticeCollapsed.hidden = notice.mode !== 'collapsed';
  elements.siteNoticeTitle.textContent = text.title;
  elements.siteNoticeBody.textContent = text.body;
  elements.siteNoticeCollapsedText.textContent = text.collapsed;
  elements.siteNoticeAllow.hidden = notice.limitReached;
  if (previous !== notice.origin) {
    showNotice(elements.siteNoticeNotice, '');
  }
  // 新しく出したときは、知らせが見えるよう画面の先頭へ戻します。
  if (wasHidden || previous !== notice.origin) {
    window.scrollTo({ top: 0 });
  }
}

/** 記録と実行の状態に合わせて、画面を表示し直します。 */
async function render() {
  const stored = await chrome.storage.session.get(null);
  const recording = /** @type {Recording | undefined} */ (stored.recording);
  const lastFlow = /** @type {Flow | undefined} */ (stored.lastFlow);
  const runs = /** @type {RunState[]} */ (runStatesFrom(stored));
  const batchRuns = batchRunsFrom(stored);
  // フローの実行中は、記録した手順の削除と破棄をできないようにします。
  const running = runs.some(isActiveRun);

  // Web ページ以外では記録できませんが、すべてのフローの一覧から開く・実行することはできます（#44）。
  elements.pageOrigin.textContent = currentPage?.origin ?? 'Web ページ以外を表示しています';

  // 同じサイトのフローを実行中のタブと、記録の操作が干渉しないよう、そのサイトでは記録を始めません。
  elements.start.disabled =
    !currentPage?.origin ||
    Boolean(recording) ||
    Boolean(findConflictingRun(currentPage.origin, runs));

  renderSiteNotice(
    recording,
    /** @type {RecordingPage | undefined} */ (stored.recordingPage),
    /** @type {string[]} */ (stored[DECLINED_SITES_KEY] ?? []),
  );
  elements.recordingSection.hidden = !recording;
  if (recording) {
    elements.recordingOrigin.textContent = `記録するページ：${[recording.origin, ...(recording.extraOrigins ?? [])].join('、')}`;
    renderRecordingSite(recording, /** @type {RecordingPage | undefined} */ (stored.recordingPage));
    elements.stepCount.textContent = String(recording.steps.length);
    elements.steps.replaceChildren(
      ...stepItems(recording.steps, running, elements.recordingNotice, {
        hints: recording.rowHints,
        pagers: recording.pagerHints,
      }),
    );
    elements.recordingDiscard.disabled = running || recording.steps.length === 0;
    recordingLoopForm.update(
      recording.steps,
      recording.rowHints,
      running,
      recording.pagerHints,
      recording.picking === true,
    );
    // 最後に記録した手順が見えるよう、一覧の末尾まで移動します。
    elements.steps.scrollTop = elements.steps.scrollHeight;
  }

  const showResult = !recording && Boolean(lastFlow);
  if (!showResult && !elements.resultSection.hidden) {
    // 保存の区画を閉じるときは、入力欄の誤りも消します。次に開いたときに残らないようにするためです。
    showFieldError(elements.flowName, elements.flowNameFeedback, '');
    elements.flowName.value = '';
  }
  elements.resultSection.hidden = !showResult;
  elements.result.value = lastFlow ? JSON.stringify(orderFlow(lastFlow), null, 2) : '';
  elements.resultStepCount.textContent = String(lastFlow?.steps.length ?? 0);
  elements.resultSteps.replaceChildren(
    ...stepItems(lastFlow?.steps ?? [], running, elements.saveNotice, {
      hints: /** @type {RowHint[] | undefined} */ (stored.lastFlowRowHints),
      pagers: /** @type {PagerHint[] | undefined} */ (stored.lastFlowPagerHints),
    }),
  );
  elements.discard.disabled = running || !lastFlow?.steps.length;
  resultLoopForm.update(
    lastFlow?.steps ?? [],
    /** @type {RowHint[] | undefined} */ (stored.lastFlowRowHints),
    running,
    /** @type {PagerHint[] | undefined} */ (stored.lastFlowPagerHints),
  );
  if (lastFlow && !elements.flowName.value) {
    elements.flowName.value = lastFlow.name;
  }

  await renderActivity(runs, batchRuns);

  // 記録中は、まとめフローも実行できないようにします（#7）。理由は一覧の先頭に 1 回だけ示します（#136）。
  const batchRunButtons = elements.batchList.querySelectorAll('button[data-batch-run]');
  for (const item of batchRunButtons) {
    /** @type {HTMLButtonElement} */ (item).disabled = Boolean(recording);
  }
  showListReasons(
    elements.batchReason,
    recording && batchRunButtons.length > 0 ? ['記録中は実行できません。'] : [],
  );

  // 記録中と、同じサイトのフローを実行中は、実行のボタンを押せなくします。
  // すべてのフローを表示しているとき（Web ページ以外）は、最初の手順がページを開く手順でないフローも
  // 押せなくします。開くページが決まらず、実行するタブもないためです。
  // 記録中と実行中の理由は、多くの行で同じ文になるため、一覧の先頭に 1 回だけ示します（#136）。
  // 最初のページがない理由は、行ごとに異なるため、その行の中に示します。
  /** @type {Set<string>} */
  const shared = new Set();
  for (const item of elements.flows.querySelectorAll('[data-origin]')) {
    const row = /** @type {HTMLElement} */ (item);
    const conflict = findConflictingRun(row.dataset.origin ?? '', runs);
    const noFirstPage = row.dataset.noFirstPage === 'true';
    const common = recording
      ? '記録中は実行できません。'
      : conflict
        ? conflictMessage(conflict.origin, conflict.flowName)
        : '';
    if (common) {
      shared.add(common);
    }
    const run = row.querySelector('button[data-run]');
    if (run instanceof HTMLButtonElement) {
      run.disabled = noFirstPage || Boolean(common);
    }
    const reason = row.querySelector('.lm-flow-reason');
    const reasonText = reason?.querySelector('.lm-guide-title');
    if (reason instanceof HTMLElement && reasonText) {
      reasonText.textContent = noFirstPage ? NO_FIRST_PAGE : '';
      reason.hidden = !noFirstPage;
    }
  }
  showListReasons(elements.flowsReason, [...shared]);
}

/**
 * 一覧の先頭の案内に、実行できない理由を示します（#136）。理由がなければ案内を隠します。
 * 理由が 1 つなら 1 文だけ、複数なら見出しと箇条書きにします（docs/design-guidelines.md の案内の規則）。
 * @param {HTMLElement} guide 案内（class="alert alert-info lm-guide"）
 * @param {string[]} reasons
 */
function showListReasons(guide, reasons) {
  guide.hidden = reasons.length === 0;
  if (reasons.length === 0) {
    guide.replaceChildren();
    return;
  }
  const title = document.createElement('p');
  title.className = 'lm-guide-title';
  if (reasons.length === 1) {
    title.textContent = reasons[0];
    guide.replaceChildren(title);
    return;
  }
  title.textContent = '次の理由で、実行できないフローがあります。';
  const list = document.createElement('ul');
  list.append(
    ...reasons.map((reason) => {
      const item = document.createElement('li');
      item.textContent = reason;
      return item;
    }),
  );
  guide.replaceChildren(title, list);
}

/**
 * 手順の一覧の項目を作ります。各行の右端に、その手順を削除する「×」を置きます。
 * 繰り返しを作った後に記録した「次へ」のクリックには、その繰り返しのページ送りにするボタンを置きます（#237）。
 * @param {import('../shared/flow.js').Step[]} steps
 * @param {boolean} locked 削除できない状態（フローの実行中）か
 * @param {HTMLElement} errorNotice 削除できなかったときに知らせを出す場所
 * @param {{ hints?: (RowHint | null)[], pagers?: (PagerHint | null)[] }} [recorded] 手順に添えた、一覧の行の候補と
 *   ページ送りに使う場合の指定
 * @returns {HTMLLIElement[]}
 */
function stepItems(steps, locked, errorNotice, recorded = {}) {
  const loops = pagerLoops(
    steps,
    steps.map((_, index) => recorded.hints?.[index] ?? null),
    steps.map((_, index) => recorded.pagers?.[index] ?? null),
  );
  return steps.map((step, index) => {
    const item = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = describeStep(step);
    const remove = button('×', 'btn btn-sm btn-ghost-secondary lm-step-remove', () => {
      removeStep(index, steps.length, errorNotice).catch((error) =>
        showNotice(errorNotice, String(error), 'error'),
      );
    });
    remove.title = 'この手順を削除';
    remove.setAttribute('aria-label', `${index + 1} 番目の手順を削除`);
    remove.disabled = locked;
    // 「×」は float で右端に寄せるため、説明より先に置きます。
    item.append(remove, text);
    // ボタンの文言には手順の番号を使いません。利用者には、どの手順を指すかがわからないためです。
    if (loops[index] !== null) {
      const attach = button(
        'この「次へ」で、次のページの注文も続けて処理する',
        'btn btn-sm d-block mt-1',
        () => {
          attachStepPager(index, steps.length, errorNotice).catch((error) =>
            showNotice(errorNotice, String(error), 'error'),
          );
        },
      );
      attach.disabled = locked;
      item.append(attach);
    }
    // 繰り返しにした手順（#167）は、内側の手順を字下げして続けます。削除は繰り返しの単位で行います。
    if (step.type === 'forEach') {
      const inner = document.createElement('ol');
      inner.className = 'lm-steps-inner';
      inner.append(
        ...step.steps.map((child) => {
          const line = document.createElement('li');
          line.textContent = describeStep(child);
          return line;
        }),
      );
      item.append(inner);
    }
    return item;
  });
}

/**
 * 進行中の作業のうち、実行のカード（個別の実行と、まとめフローの一括実行、#7）を表示します。
 * 個別とまとめフローの区別なく、始めた日時の新しい順に上から並べます。新しく始めた実行は一番上に入ります。
 * まとめフローに含まれる実行は、個別のカードにはせず、まとめフローのカードの中に表示します。
 * @param {RunState[]} runs
 * @param {BatchRun[]} batchRuns
 */
async function renderActivity(runs, batchRuns) {
  const inBatch = new Set(
    batchRuns.flatMap((batchRun) => batchRun.items.flatMap((item) => item.runId ?? [])),
  );
  const entries = [
    ...runs
      .filter((run) => !inBatch.has(run.runId))
      .map((run) => ({ startedAt: run.startedAt, build: () => runCard(run) })),
    ...batchRuns.map((batchRun) => ({
      startedAt: batchRun.startedAt,
      build: () => batchRunCard(batchRun, runs),
    })),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const cards = await Promise.all(entries.map((entry) => entry.build()));
  elements.runs.replaceChildren(...cards);
  elements.runSection.hidden = cards.length === 0;
}

/**
 * 個別の実行のカードです。まとめフローのカードと同じ形にします。
 * 1 行目にフロー名、状態の印、右端に［実行停止］（実行中）か［閉じる］（終了後）。
 * その下に操作のボタン、進み具合（止まった理由）の文の順です。完了した場合は 1 行目だけです。
 * @param {RunState} run
 * @returns {Promise<HTMLDivElement>}
 */
async function runCard(run) {
  const stored = await getFlow(run.flowId);
  const { card, body } = activityCard();
  if (run.status === 'failed') {
    card.classList.add('lm-card-failed');
  }
  const notice = document.createElement('p');
  notice.hidden = true;
  /** @param {string} text */
  const showError = (text) => showNotice(notice, text, 'error');

  const end = isActiveRun(run)
    ? button('実行停止', 'btn btn-sm btn-danger', () => {
        chrome.runtime.sendMessage({ kind: 'runner/stop', runId: run.runId }).catch(console.error);
      })
    : button('閉じる', 'btn btn-sm', () => {
        chrome.storage.session.remove(RUN_KEY_PREFIX + run.runId).catch(console.error);
      });
  end.disabled = run.status === 'stopping';
  body.append(
    headLine(
      run.flowName,
      'lm-flow-name',
      statusMark(runStatusLabel(run.status), runStatusTone(run.status)),
      end,
    ),
  );

  const actions = runActions(run, run.flowName, showError);
  if (run.status === 'failed' && stored) {
    actions.append(editLink(stored, 'フローを編集'));
  }
  if (actions.childElementCount > 0) {
    body.append(actions);
  }
  const detail = detailLine(run, stored);
  if (detail) {
    body.append(detail);
  }
  body.append(notice);
  return card;
}

/**
 * 実行中のフローの［一時停止］または［再開］と、［タブを開く］です。個別の実行とまとめフローの行で使います。
 * @param {RunState} run
 * @param {string} flowName
 * @param {(text: string) => void} showError 操作できなかったときに知らせを出す処理
 * @returns {HTMLDivElement}
 */
function runActions(run, flowName, showError) {
  const actions = document.createElement('div');
  actions.className = 'lm-buttons mt-2';
  if (isActiveRun(run)) {
    // 一時停止中は［再開］、それ以外は［一時停止］を置きます（#37）。
    const paused = run.status === 'paused';
    const toggle = button(paused ? '再開' : '一時停止', 'btn btn-sm', () => {
      clearNotices();
      chrome.runtime
        .sendMessage({ kind: paused ? 'runner/resume' : 'runner/pause', runId: run.runId })
        .then((response) => {
          if (!response?.ok) {
            showError(response?.error ?? '再開できませんでした。');
          }
        })
        .catch((error) => showError(String(error)));
    });
    toggle.disabled = run.status !== 'running' && !paused;
    actions.append(toggle);
  }
  if (isActiveRun(run) || run.status === 'halted') {
    actions.append(
      button('タブを開く', 'btn btn-sm', () => {
        focusTab(run.tabId).catch(() => showError(`「${flowName}」のタブは閉じられています。`));
      }),
    );
  }
  return actions;
}

/**
 * 進み具合と止まった理由の 1 行です。フロー名は 1 行目にあるため含めません。
 * 長い場合は 3 行までに省略し、マウスを重ねると全体を表示します。完了した場合は作りません。
 * @param {RunState} run
 * @param {StoredFlow | undefined} stored
 * @returns {HTMLParagraphElement | null}
 */
function detailLine(run, stored) {
  // stepIndex は、if と forEach の内側を展開した通し番号です（#6）。
  const text = runDetailText(run, stored && stepAt(stored.flow.steps, run.stepIndex));
  if (!text) {
    return null;
  }
  const detail = document.createElement('p');
  detail.className = 'lm-run-detail';
  if (run.status === 'failed') {
    detail.classList.add('lm-text-danger');
  }
  if (isActiveRun(run) && run.status !== 'paused') {
    // 実行中の文は手順ごとに長さが変わるため、高さを固定し、下のカードが動かないようにします（#98）。
    detail.classList.add('lm-run-progress');
    detail.setAttribute('role', 'status');
  }
  detail.textContent = text;
  detail.title = text;
  return detail;
}

/**
 * 実行のカードの枠です。
 * @returns {{ card: HTMLDivElement, body: HTMLDivElement }}
 */
function activityCard() {
  const card = document.createElement('div');
  card.className = 'card';
  const body = document.createElement('div');
  body.className = 'card-body';
  card.append(body);
  return { card, body };
}

/**
 * カードと行の 1 行目です。名前、状態の印、右端の操作の順に並べます。個別の実行とまとめフローで同じ形にします。
 * @param {string} name
 * @param {string} nameClass 名前の文字の段階（lm-flow-name など）
 * @param {HTMLElement} mark 状態の印
 * @param {HTMLButtonElement | null} action 右端の操作
 * @returns {HTMLDivElement}
 */
function headLine(name, nameClass, mark, action) {
  const line = document.createElement('div');
  line.className = 'lm-row lm-head-line';
  const text = document.createElement('span');
  text.className = `${nameClass} lm-row-text`;
  text.textContent = name;
  line.append(text, mark);
  if (action) {
    action.classList.add('ms-auto');
    line.append(action);
  }
  return line;
}

/**
 * 状態の印です。色だけで伝えないよう、状態は文字で示します。
 * @param {string} text
 * @param {'success' | 'primary' | 'warning' | 'danger' | 'muted'} tone
 * @returns {HTMLSpanElement}
 */
function statusMark(text, tone) {
  const mark = document.createElement('span');
  mark.className = `lm-status lm-status-${tone}`;
  mark.textContent = text;
  return mark;
}

/**
 * フローの一覧を表示します。Web ページを表示しているときは、そのサイトのフローだけを表示します。
 * フローは、そのサイトのページでだけ実行する仕様のためです。Web ページ以外（新しいタブなど）では、
 * すべてのフローをホスト名ごとにまとめ、検索欄で絞り込めるようにします（#44）。
 */
async function renderFlows() {
  const origin = currentPage?.origin;
  const all = await listFlows();
  schedules = await listSchedules();
  const shown = flowsToShow(all, origin);
  const everything = shown.scope === 'all';
  allScope = everything;
  searchable = everything ? all : [];
  if (editing && !shown.flows.some((stored) => stored.id === editing?.id)) {
    editing = null;
  }

  elements.flowsHeading.textContent = everything ? 'すべてのフロー' : 'このサイトのフロー';
  elements.tabFlows.textContent = elements.flowsHeading.textContent;
  // すべてのフローを表示しているときは、ほかのサイトのフローもこの画面で確認できるため、案内から外します（#108）。
  elements.flowsAsideScope.hidden = everything;
  elements.searchArea.hidden = !everything || all.length === 0;
  if (elements.searchArea.hidden) {
    searchBox.close();
  }
  const query = everything ? elements.search.value : '';
  const flows = everything ? filterFlows(shown.flows, query, searchMode()) : shown.flows;

  elements.flowsEmpty.hidden = flows.length > 0;
  elements.flowsEmpty.textContent = !everything
    ? `${origin} のフローはまだありません。「記録開始」を押し、このページで操作を記録してください。`
    : all.length > 0
      ? '該当するフローはありません。'
      : '保存したフローはまだありません。記録するサイトを開き、「記録開始」を押してください。';
  elements.flows.replaceChildren(
    ...(everything
      ? buildFlowGroups(document, groupByHost(flows), {
          renderItem: flowItem,
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
        })
      : flows.map(flowItem)),
  );
  renderBatches(all, await listBatches());
  await render();
}

/**
 * 定期実行（#22）の予約です。キーはフローの ID です。一覧の行に次の予約の日時を表示するために使います。
 * @type {Record<string, import('../shared/schedule.js').Schedule>}
 */
let schedules = {};

// ---- すべてのフローの検索（#44） ----
// 検索欄の入力と一致方法は保存しません。サイドパネルを開き直すと、空欄と「部分一致」に戻ります。

/** すべてのフローを表示しているか（Web ページ以外を表示しているか）です。 */
let allScope = false;

/** 候補を作るための、すべてのフローです。すべてのフローを表示しているときだけ入れます。 */
/** @type {StoredFlow[]} */
let searchable = [];

/** 折りたたんだまとまりのホスト名です。一覧を作り直しても閉じたままにします。 */
const collapsedHosts = new Set();

elements.searchMode.append(...MATCH_MODES.map(({ value, label }) => new Option(label, value)));

/** @returns {import('../shared/flow-search.js').MatchMode} */
function searchMode() {
  return /** @type {import('../shared/flow-search.js').MatchMode} */ (elements.searchMode.value);
}

const searchBox = attachCombobox(elements.search, elements.searchSuggestions, {
  getOptions: () =>
    suggestions(searchable, elements.search.value, searchMode()).map(({ value, kind }) => ({
      value,
      note: kind === 'flow' ? 'フロー' : 'サイト',
    })),
  onSelect: () => renderFlows().catch(console.error),
});

elements.search.addEventListener('input', () => {
  renderFlows().catch(console.error);
});

elements.searchMode.addEventListener('change', () => {
  renderFlows().catch(console.error);
});

/**
 * フローの一覧の 1 行を作ります。
 * 主な操作の「実行」だけを行に出し、名前の変更・編集・削除は「その他」の中に置きます。
 * @param {StoredFlow} stored
 * @returns {HTMLDivElement}
 */
function flowItem(stored) {
  const item = document.createElement('div');
  item.className = 'list-group-item';
  item.dataset.origin = stored.flow.origin;
  // 最初の手順がページを開く手順でないフローは、表示中のタブで実行します。そのため、すべてのフローを
  // 表示しているときと、フローの origin 以外のサイトのページで表示しているとき（#41）は、押せなくします。
  item.dataset.noFirstPage = String(
    stored.flow.steps[0]?.type !== 'navigate' &&
      (allScope || currentPage?.origin !== stored.flow.origin),
  );

  if (editing?.id === stored.id && editing.mode === 'rename') {
    item.append(renameForm(stored, editing));
    return item;
  }

  const name = document.createElement('div');
  name.className = 'lm-flow-name';
  name.textContent = stored.flow.name;
  const detail = document.createElement('div');
  detail.className = 'lm-sub';
  detail.append(
    `手順 ${flattenSteps(stored.flow.steps).length} 件・更新 `,
    nowrap(formatDateTime(stored.updatedAt)),
  );
  const text = document.createElement('div');
  text.className = 'lm-flow-text';
  text.append(name, detail);
  const schedule = schedules[stored.id];
  if (schedule) {
    const next = document.createElement('div');
    next.className = 'lm-sub';
    next.append('定期実行・次回 ', nowrap(formatRunAt(nextRunAt(schedule, new Date()))));
    text.append(next);
  }

  const main = document.createElement('div');
  main.className = 'lm-flow-main';
  main.append(text);
  item.append(main);

  if (editing?.id === stored.id && editing.mode === 'delete') {
    const question = document.createElement('div');
    question.className = 'lm-confirm alert alert-danger';
    question.setAttribute('role', 'alertdialog');
    const message = document.createElement('p');
    message.className = 'mb-2';
    message.textContent = `「${stored.flow.name}」を削除します。元に戻せません。`;
    const buttons = document.createElement('div');
    buttons.className = 'lm-buttons';
    const cancel = button('キャンセル', 'btn btn-sm', () => setEditing(null));
    buttons.append(
      button('削除する', 'btn btn-sm btn-danger', () => {
        onDelete(stored).catch((error) => setRowNotice(stored.id, String(error), 'error'));
      }),
      cancel,
    );
    question.append(message, buttons);
    item.append(question);
    queueMicrotask(() => cancel.focus());
    return item;
  }

  const run = button('実行', 'btn btn-sm btn-outline-primary', () => {
    onRunClick(stored).catch((error) => setRowNotice(stored.id, String(error), 'error'));
  });
  run.dataset.run = stored.id;
  const menuOpen = menuOpenId === stored.id;
  const more = button('…', 'btn btn-sm btn-ghost-secondary', () => {
    menuOpenId = menuOpen ? '' : stored.id;
    renderFlows().catch(console.error);
  });
  more.title = 'その他の操作';
  more.setAttribute('aria-label', `「${stored.flow.name}」のその他の操作`);
  more.setAttribute('aria-expanded', String(menuOpen));
  // 並びは、主な操作（［実行］）、そのほかの操作（［開く］）、「…」の順です（#112）。
  const actions = document.createElement('div');
  actions.className = 'lm-flow-actions';
  actions.append(run);
  if (allScope) {
    // Web ページ以外を表示しているときは、対象のサイトを開く手段として［開く］を置きます（#44）。
    // 幅が狭いため、ボタンの文字は短くし、読み上げと説明には「最初のページを開く」を使います。
    const open = button('開く', 'btn btn-sm', () => {
      onOpenClick(stored).catch((error) => setRowNotice(stored.id, String(error), 'error'));
    });
    open.title = '最初のページを開く';
    open.setAttribute('aria-label', `「${stored.flow.name}」の最初のページを開く`);
    open.disabled = item.dataset.noFirstPage === 'true';
    actions.append(open);
  }
  actions.append(more);
  main.append(actions);

  // ［実行］を押せない理由です。フローの説明と区別できるよう、注意の案内（黄）として別の行に出します（#141）。
  const reason = document.createElement('div');
  reason.className = 'alert alert-warning lm-guide lm-flow-reason';
  reason.hidden = true;
  const reasonText = document.createElement('p');
  reasonText.className = 'lm-guide-title';
  reason.append(reasonText);
  item.append(reason);

  if (menuOpen) {
    const menu = document.createElement('div');
    menu.className = 'lm-more-menu';
    menu.append(
      button('名前の変更', 'btn btn-sm', () =>
        setEditing({ id: stored.id, mode: 'rename', name: stored.flow.name, error: '' }),
      ),
      editLink(stored, '編集'),
      button('削除', 'btn btn-sm btn-ghost-danger', () =>
        setEditing({ id: stored.id, mode: 'delete', name: '', error: '' }),
      ),
    );
    item.append(menu);
  }

  const notice = rowNotices.get(stored.id);
  if (notice) {
    const element = document.createElement('p');
    showNotice(element, notice.text, notice.kind);
    item.append(element);
  }
  return item;
}

/**
 * 管理画面で、そのフローを開くリンクです。
 * @param {StoredFlow} stored
 * @param {string} text
 * @returns {HTMLAnchorElement}
 */
function editLink(stored, text) {
  const link = document.createElement('a');
  link.className = 'btn btn-sm';
  link.href = `../options/options.html#${encodeURIComponent(stored.id)}`;
  link.target = '_blank';
  link.textContent = text;
  return link;
}

/**
 * 名前を変更する入力欄です。誤りは入力欄の直下に表示します。
 * @param {StoredFlow} stored
 * @param {{ name: string, error: string }} state 入力中の名前と、その誤り
 * @returns {HTMLFormElement}
 */
function renameForm(stored, state) {
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-control';
  input.id = `rename-${stored.id}`;
  input.maxLength = 200;
  input.value = state.name;
  input.addEventListener('input', () => {
    state.name = input.value;
  });
  const feedback = document.createElement('div');
  feedback.className = 'invalid-feedback';
  feedback.id = `rename-feedback-${stored.id}`;
  showFieldError(input, feedback, state.error);

  const label = document.createElement('label');
  label.className = 'form-label';
  label.htmlFor = input.id;
  label.textContent = 'フロー名';
  const field = document.createElement('div');
  field.className = 'mb-2';
  field.append(label, input, feedback);

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn-sm btn-primary';
  save.textContent = '保存';
  const buttons = document.createElement('div');
  buttons.className = 'lm-buttons';
  buttons.append(
    save,
    button('キャンセル', 'btn btn-sm', () => setEditing(null)),
  );
  form.append(field, buttons);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onRename(stored, input.value.trim()).catch((error) => {
      state.error = String(error);
      renderFlows().catch(console.error);
    });
  });
  queueMicrotask(() => input.focus());
  return form;
}

/**
 * @param {StoredFlow} stored
 * @param {string} name
 */
async function onRename(stored, name) {
  clearNotices();
  if (!editing) {
    return;
  }
  if (!name) {
    editing.error = 'フロー名を入力してください。';
    await renderFlows();
    return;
  }
  const result = await renameFlow(stored.id, name);
  if (!result.ok) {
    editing.error = `名前を変更できませんでした。${result.errors.join(' ')}`;
    await renderFlows();
    return;
  }
  editing = null;
  menuOpenId = '';
  showSaved(stored.id, name, result.name);
}

/** @param {StoredFlow} stored */
async function onDelete(stored) {
  clearNotices();
  await deleteFlow(stored.id);
  editing = null;
  menuOpenId = '';
  showToast(elements.toast, `「${stored.flow.name}」を削除しました。`);
  await renderFlows();
}

/**
 * 名前の変更と削除の確認を始める、または終えます。
 * @param {{ id: string, mode: 'rename' | 'delete', name: string, error: string } | null} state
 */
function setEditing(state) {
  clearNotices();
  editing = state;
  renderFlows().catch(console.error);
}

/**
 * フローの行の中に知らせを出します。
 * @param {string} flowId
 * @param {string} text
 * @param {NoticeKind} kind
 */
function setRowNotice(flowId, text, kind) {
  rowNotices.set(flowId, { text, kind });
  renderFlows().catch(console.error);
}

// ---- まとめフロー（#7） ----
// まとめフローの登録と削除は管理画面で行い、サイドパネルでは実行と、実行中の状態の表示だけを行います。

/**
 * まとめフローの行の中に出す知らせです。キーはまとめフローの id です。
 * @type {Map<string, { text: string, kind: NoticeKind }>}
 */
const batchRowNotices = new Map();

/** 終わった一括実行のカードで、［詳細］を開いているものの id です。表示を作り直しても開いたままにします。 */
const expandedBatchRuns = new Set();

/**
 * 一括実行のカードの中に出す知らせです。キーは一括実行の id です。
 * @type {Map<string, { text: string, kind: NoticeKind }>}
 */
const batchRunNotices = new Map();

/**
 * まとめフローの一覧を表示します。検索欄の語と一致方法で絞り込みます（#113）。
 * まとめフローがない場合は、検索欄を出さず、登録の方法を案内します。
 * ［実行］で許可を求める前に待たないよう、含めるフローもここで読んでおきます。
 * @param {StoredFlow[]} flows 保存したすべてのフロー
 * @param {StoredBatch[]} batches
 */
function renderBatches(flows, batches) {
  batchSearchData = { batches, flows };
  const shown = filterBatches(batches, flows, elements.batchSearch.value, batchSearchMode());
  elements.batchEmpty.hidden = batches.length > 0;
  elements.batchSearchArea.hidden = batches.length === 0;
  if (elements.batchSearchArea.hidden) {
    batchSearchBox.close();
  }
  elements.batchNoMatch.hidden = batches.length === 0 || shown.length > 0;
  elements.batchList.replaceChildren(...shown.map((batch) => batchItem(batch, flows)));
}

// ---- まとめフローの検索（#113） ----
// まとめフローの名前、含めたフローの名前、そのサイトで絞り込みます。検索語と一致方法は保存しません。

/**
 * 候補を作るための、まとめフローと保存したフローです。一覧を表示するたびに更新します。
 * @type {{ batches: StoredBatch[], flows: StoredFlow[] }}
 */
let batchSearchData = { batches: [], flows: [] };

/** 検索欄の候補に添える、種類の説明です。 */
const BATCH_SUGGESTION_NOTES = { batch: 'まとめフロー', flow: 'フロー', site: 'サイト' };

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
  onSelect: () => renderFlows().catch(console.error),
});

elements.batchSearch.addEventListener('input', () => {
  renderFlows().catch(console.error);
});

elements.batchSearchMode.addEventListener('change', () => {
  renderFlows().catch(console.error);
});

/**
 * まとめフローの一覧の 1 行を作ります。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} flows 保存したすべてのフロー
 * @returns {HTMLDivElement}
 */
function batchItem(batch, flows) {
  const item = document.createElement('div');
  item.className = 'list-group-item';
  const contained = batchFlows(batch, flows);
  const sites = [...new Set(contained.map((stored) => stored.flow.origin))];

  const name = document.createElement('div');
  name.className = 'lm-flow-name';
  name.textContent = batch.name;
  const detail = document.createElement('div');
  detail.className = 'lm-sub';
  detail.textContent = `フロー ${batch.flowIds.length} 件・${sites.join('、')}`;
  const text = document.createElement('div');
  text.className = 'lm-flow-text';
  text.append(name, detail);

  const run = button('実行', 'btn btn-sm btn-outline-primary', () => {
    onBatchRunClick(batch, flows).catch((error) =>
      setBatchRowNotice(batch.id, String(error), 'error'),
    );
  });
  run.dataset.batchRun = batch.id;
  run.setAttribute('aria-label', `まとめフロー「${batch.name}」を実行`);
  // 含めた各フローの最初のページを開きます。手順は実行しません。管理画面の［すべて開く］と同じです。
  const open = button('すべて開く', 'btn btn-sm', () => {
    onBatchOpenClick(batch, flows).catch((error) =>
      setBatchRowNotice(batch.id, String(error), 'error'),
    );
  });
  open.setAttribute(
    'aria-label',
    `まとめフロー「${batch.name}」の各フローの最初のページをすべて開く`,
  );
  open.disabled = batchProblems(batch.flowIds, flows).length > 0;
  // 並びは、主な操作（［実行］）、そのほかの操作（［すべて開く］）の順です。
  const actions = document.createElement('div');
  actions.className = 'lm-flow-actions';
  actions.append(run, open);

  const main = document.createElement('div');
  main.className = 'lm-flow-main';
  main.append(text, actions);
  item.append(main);

  const notice = batchRowNotices.get(batch.id);
  if (notice) {
    const element = document.createElement('p');
    showNotice(element, notice.text, notice.kind);
    item.append(element);
  }
  return item;
}

/**
 * まとめフローに含めるフローを、登録した順に返します。削除されたフローは含めません。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} flows
 * @returns {StoredFlow[]}
 */
function batchFlows(batch, flows) {
  return batch.flowIds.flatMap((id) => flows.filter((stored) => stored.id === id));
}

/**
 * まとめフローの［実行］を押したときの処理です。誤りは、そのまとめフローの行の中に表示します。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} flows 保存したすべてのフロー
 */
async function onBatchRunClick(batch, flows) {
  clearNotices();
  const problems = batchProblems(batch.flowIds, flows);
  if (problems.length > 0) {
    setBatchRowNotice(batch.id, problems.join('\n'), 'error');
    return;
  }
  const contained = batchFlows(batch, flows);
  // 許可を求める処理は、ボタンを押した直後に呼び出す必要があります。この前に待ち時間を入れないでください。
  // すべてのフローが操作するサイトの許可を、1 回の確認でまとめて求めます。
  const denied = await requestPermission([
    ...new Set(contained.flatMap((stored) => flowOrigins(stored.flow))),
  ]);
  if (denied) {
    setBatchRowNotice(batch.id, denied, 'error');
    return;
  }
  const needInput = contained.filter(
    (stored) => (stored.flow.params ?? []).length > 0 || secretStepIndexes(stored.flow).length > 0,
  );
  if (needInput.length === 0) {
    const error = await startBatch(batch.id, {});
    if (error) {
      setBatchRowNotice(batch.id, error, 'error');
    }
    return;
  }
  showBatchForm(batch, 'run', contained, needInput);
}

/**
 * まとめフローの［すべて開く］を押したときの処理です。含めた各フローの最初のページを新しいタブで開きます。
 * 最初のページの URL が値を使うフローがあれば、先に値を尋ねます。誤りは、そのまとめフローの行の中に表示します。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} flows 保存したすべてのフロー
 */
async function onBatchOpenClick(batch, flows) {
  clearNotices();
  const problems = batchProblems(batch.flowIds, flows);
  if (problems.length > 0) {
    setBatchRowNotice(batch.id, problems.join('\n'), 'error');
    return;
  }
  const contained = batchFlows(batch, flows);
  const needInput = contained.filter((stored) => firstPageParams(stored.flow).length > 0);
  if (needInput.length === 0) {
    const error = await openBatchPages(batch, contained, {});
    if (error) {
      setBatchRowNotice(batch.id, error, 'error');
    }
    return;
  }
  showBatchForm(batch, 'open', contained, needInput);
}

/**
 * 含めた各フローの最初のページを、新しいタブで開きます。1 件目を前面に、残りを背景のタブで開きます。
 * @param {StoredBatch} batch
 * @param {StoredFlow[]} contained まとめフローに含めたフロー（登録した順）
 * @param {Record<string, { params: Record<string, string> }>} inputs フローごとの入力した値
 * @returns {Promise<string>} 開けなかった理由。開いた場合は空の文字列
 */
async function openBatchPages(batch, contained, inputs) {
  const pages = batchFirstPageUrls(contained, inputs, new Date());
  if (!pages.ok) {
    return pages.error;
  }
  for (const [index, url] of pages.urls.entries()) {
    await chrome.tabs.create({ url, active: index === 0 });
  }
  showToast(
    elements.toast,
    `まとめフロー「${batch.name}」の ${pages.urls.length} 件の最初のページを開きました。`,
  );
  return '';
}

/**
 * まとめフローの値の入力フォームを表示します。値の入力が必要なフローだけを、フロー名の見出しの下に並べます。
 * 開く場合は、最初の手順の URL が参照するパラメータだけを尋ねます。
 * @param {StoredBatch} batch
 * @param {'run' | 'open'} mode
 * @param {StoredFlow[]} contained まとめフローに含めたフロー（登録した順）
 * @param {StoredFlow[]} flows 値の入力が必要なフロー
 */
function showBatchForm(batch, mode, contained, flows) {
  const open = mode === 'open';
  formMode = 'batch';
  formFlowId = '';
  formParams = [];
  elements.formHeading.textContent = open ? '開くページの値の入力' : '実行する値の入力';
  elements.formDescription.textContent = open
    ? `まとめフロー「${batch.name}」の各フローの最初のページを開きます。値の入力が必要なフローだけを表示しています。入力した値は保存しません。`
    : `まとめフロー「${batch.name}」を実行します。値の入力が必要なフローだけを表示しています。入力した値は保存しません。`;
  elements.formSubmit.textContent = open ? 'この値で開く' : 'この値でまとめて実行';
  const now = new Date();
  const groups = flows.map((stored, index) => {
    const params = open ? firstPageParams(stored.flow) : (stored.flow.params ?? []);
    const element = document.createElement('div');
    element.className = 'lm-stack';
    const heading = document.createElement('h3');
    heading.className = 'lm-flow-name m-0';
    heading.textContent = stored.flow.name;
    element.append(
      heading,
      ...buildRunFields(document, stored.flow, {
        params,
        secretSteps: open ? [] : secretStepIndexes(stored.flow),
        now,
        idPrefix: `batch-field-${index}`,
      }),
    );
    return { flowId: stored.id, params, element };
  });
  formBatch = { batch, mode, flows: contained, groups };
  elements.formFields.replaceChildren(...groups.map(({ element }) => element));
  showNotice(elements.formNotice, '');
  elements.formSection.hidden = false;
  // 入力フォームを開いている間は、一覧の［実行］などを隠します。押すボタンをフォームの中に絞るためです（#112）。
  elements.main.classList.add('lm-form-open');
  elements.formSection.scrollIntoView({ block: 'start' });
  const first = elements.formFields.querySelector('input, select');
  if (first instanceof HTMLElement) {
    first.focus();
  }
}

/** まとめフローの入力フォームの送信です。1 件でも誤りがあれば、どのフローも始めません。 */
async function submitBatchForm() {
  if (!formBatch) {
    return;
  }
  const now = new Date();
  // 誤りはすべてのフローの欄に表示してから、最初の誤りの欄にフォーカスを移します。
  const invalid = formBatch.groups
    .map(({ element, params }) => showRunFieldErrors(element, params, now, false))
    .some(Boolean);
  if (invalid) {
    const first = elements.formFields.querySelector('.is-invalid');
    if (first instanceof HTMLElement) {
      first.focus();
    }
    return;
  }
  const inputs = Object.fromEntries(
    formBatch.groups.map(({ flowId, element }) => [flowId, readRunFields(fieldEntries(element))]),
  );
  const error =
    formBatch.mode === 'open'
      ? await openBatchPages(formBatch.batch, formBatch.flows, inputs)
      : await startBatch(formBatch.batch.id, inputs);
  if (error) {
    showNotice(elements.formNotice, error, 'error');
    return;
  }
  hideForm();
}

/**
 * @param {string} batchId
 * @param {Record<string, { params: Record<string, string>, secrets: Record<string, string> }>} inputs
 * @returns {Promise<string>} 実行を始められなかった理由。始められた場合は空の文字列
 */
async function startBatch(batchId, inputs) {
  const response = await chrome.runtime.sendMessage({ kind: 'batch/start', batchId, inputs });
  return response?.ok ? '' : (response?.error ?? 'まとめて実行を開始できません。');
}

/**
 * まとめフローの一括実行のカードです。個別の実行のカードと同じ形にします。
 * 1 行目にまとめフローの名前、全体の状態の印、右端に［すべて中止］（実行中）か［閉じる］（終了後）。
 * その下に「まとめフロー・3 件中 1 件が終了」と進行のバー、フローごとの行の順です。
 * 終わった後は、フローごとの行を［各フローの結果］（details）の中に畳みます。自動では消しません。
 * @param {BatchRun} batchRun
 * @param {RunState[]} runs
 * @returns {Promise<HTMLDivElement>}
 */
async function batchRunCard(batchRun, runs) {
  const { card, body } = activityCard();
  const finished = isBatchFinished(batchRun.items);
  const overall = batchOverall(batchRun.items, runs);
  const summary = batchSummary(batchRun.items);

  const end = finished
    ? button('閉じる', 'btn btn-sm', () => {
        // 含まれる実行の状態も消します。個別の実行のカードとして残らないようにするためです。
        chrome.storage.session
          .remove([
            BATCH_RUN_KEY_PREFIX + batchRun.batchRunId,
            ...batchRun.items.flatMap((item) => (item.runId ? [RUN_KEY_PREFIX + item.runId] : [])),
          ])
          .catch(console.error);
        expandedBatchRuns.delete(batchRun.batchRunId);
      })
    : button('すべて中止', 'btn btn-sm btn-danger', () => {
        abortAll(batchRun).catch((error) =>
          setBatchRunNotice(batchRun.batchRunId, String(error), 'error'),
        );
      });
  body.append(
    headLine(batchRun.name, 'lm-flow-name', statusMark(overall.label, overall.tone), end),
  );

  const text = document.createElement('p');
  text.className = 'lm-run-detail';
  text.textContent = `まとめフロー・${summary.text}`;
  const bar = document.createElement('div');
  bar.className = 'progress progress-sm lm-batch-bar';
  const fill = document.createElement('div');
  fill.className = 'progress-bar';
  fill.style.width = `${Math.round((summary.ended / summary.total) * 100)}%`;
  fill.setAttribute('role', 'progressbar');
  fill.setAttribute('aria-valuemin', '0');
  fill.setAttribute('aria-valuemax', String(summary.total));
  fill.setAttribute('aria-valuenow', String(summary.ended));
  fill.setAttribute('aria-label', '終了したフローの数');
  bar.append(fill);
  body.append(text, bar);

  const notice = batchRunNotices.get(batchRun.batchRunId);
  if (notice) {
    const element = document.createElement('p');
    showNotice(element, notice.text, notice.kind);
    body.append(element);
  }

  const list = document.createElement('ol');
  list.className = 'lm-batch-items';
  list.append(
    ...(await Promise.all(
      batchRun.items.map((item, index) => batchItemRow(batchRun, item, index, runs)),
    )),
  );
  if (finished) {
    const details = document.createElement('details');
    details.className = 'lm-batch-details';
    details.open = expandedBatchRuns.has(batchRun.batchRunId);
    const toggle = document.createElement('summary');
    toggle.className = 'lm-sub';
    toggle.textContent = '各フローの結果';
    details.append(toggle, list);
    details.addEventListener('toggle', () => {
      if (details.open) {
        expandedBatchRuns.add(batchRun.batchRunId);
      } else {
        expandedBatchRuns.delete(batchRun.batchRunId);
      }
    });
    body.append(details);
  } else {
    body.append(list);
  }
  return card;
}

/**
 * まとめフローの中のフロー 1 件の行です。1 行目は個別の実行のカードと同じく、フロー名、状態の印、右端の操作です。
 * まだ始めていないフローの［中止］は、1 行に収まるよう、右端の「×」にします。
 * 操作が必要な行（実行中・確定の手前・失敗）だけ、その下に操作のボタンと、進み具合（止まった理由）の文を出します。
 * サイトと、始めなかった理由は、フロー名にマウスを重ねると表示します。
 * @param {BatchRun} batchRun
 * @param {import('../shared/batch.js').BatchItem} item
 * @param {number} index
 * @param {RunState[]} runs
 * @returns {Promise<HTMLLIElement>}
 */
async function batchItemRow(batchRun, item, index, runs) {
  const run = runs.find((state) => state.runId === item.runId);
  const row = document.createElement('li');
  /** @type {HTMLButtonElement | null} */
  let end = null;
  if (item.status === 'waiting') {
    end = button('×', 'btn btn-sm btn-ghost-secondary lm-step-remove', () => {
      sendBatchAction('batch/abort', batchRun.batchRunId, index);
    });
    end.title = '中止';
    end.setAttribute('aria-label', `「${item.flowName}」を中止`);
  }
  const line = headLine(
    item.flowName,
    'lm-batch-item-name',
    statusMark(batchItemLabel(item, run), batchItemTone(item, run)),
    end,
  );
  const name = line.querySelector('.lm-row-text');
  if (name instanceof HTMLElement) {
    name.title = [item.origin, needsAttention(item) ? '' : (item.note ?? '')]
      .filter(Boolean)
      .join('\n');
  }
  row.append(line);
  if (!needsAttention(item)) {
    return row;
  }

  /** @param {string} text */
  const showError = (text) =>
    setBatchRunNotice(batchRun.batchRunId, `「${item.flowName}」：${text}`, 'error');
  // 並びは、主な操作（［確認済み・次へ］）、そのほかの操作、元に戻せない操作（［中止］）の順です。
  const actions = run ? runActions(run, item.flowName, showError) : document.createElement('div');
  actions.className = 'lm-buttons mt-1';
  const follower = hasWaitingFollower(batchRun.items, index);
  if (item.status === 'held' && follower) {
    actions.prepend(
      button('確認済み・次へ', 'btn btn-sm btn-primary', () => {
        sendBatchAction('batch/acknowledge', batchRun.batchRunId, index);
      }),
    );
  }
  if (item.status === 'running' || (item.status === 'held' && follower)) {
    const abort = button('中止', 'btn btn-sm btn-ghost-danger', () => {
      sendBatchAction('batch/abort', batchRun.batchRunId, index);
    });
    abort.disabled = run?.status === 'stopping';
    actions.append(abort);
  }
  if (actions.childElementCount > 0) {
    row.append(actions);
  }

  if (run) {
    const detail = detailLine(run, await getFlow(run.flowId));
    if (detail) {
      row.append(detail);
    }
  } else if (item.note) {
    // 実行を始められなかった理由です。
    const detail = document.createElement('p');
    detail.className = 'lm-run-detail lm-text-danger';
    detail.textContent = item.note;
    row.append(detail);
  }
  return row;
}

/**
 * 一括実行の中のフロー 1 件の［確認済み・次へ］と［中止］を、Service Worker に送ります。
 * @param {'batch/acknowledge' | 'batch/abort'} kind
 * @param {string} batchRunId
 * @param {number} index
 */
function sendBatchAction(kind, batchRunId, index) {
  clearNotices();
  chrome.runtime
    .sendMessage({ kind, batchRunId, index })
    .then((response) => {
      if (!response?.ok) {
        setBatchRunNotice(batchRunId, response?.error ?? '操作できませんでした。', 'error');
      }
    })
    .catch((error) => setBatchRunNotice(batchRunId, String(error), 'error'));
}

/**
 * 一括実行のすべてのフローを中止します。実行中のフローは停止し、まだ始めていないフローは始めません。
 * @param {BatchRun} batchRun
 */
async function abortAll(batchRun) {
  clearNotices();
  const response = await chrome.runtime.sendMessage({
    kind: 'batch/abortAll',
    batchRunId: batchRun.batchRunId,
  });
  if (!response?.ok) {
    setBatchRunNotice(batchRun.batchRunId, response?.error ?? '中止できませんでした。', 'error');
  }
}

/**
 * タブを前面に表示します。タブのあるウィンドウも前面に出します。
 * @param {number} tabId
 * @returns {Promise<void>}
 */
async function focusTab(tabId) {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

/**
 * まとめフローの行の中に知らせを出します。
 * @param {string} batchId
 * @param {string} text
 * @param {NoticeKind} kind
 */
function setBatchRowNotice(batchId, text, kind) {
  batchRowNotices.set(batchId, { text, kind });
  renderFlows().catch(console.error);
}

/**
 * 一括実行のカードの中に知らせを出します。
 * @param {string} batchRunId
 * @param {string} text
 * @param {NoticeKind} kind
 */
function setBatchRunNotice(batchRunId, text, kind) {
  batchRunNotices.set(batchRunId, { text, kind });
  render().catch(console.error);
}

// ---- 補助 ----

/**
 * 保存したことを知らせます。成功は画面の上部のトーストに出します。
 * 同じサイトに同じ名前のフローがあり、番号を付けた場合は、見落とすと困るため、
 * 自動で消えるトーストではなく、そのフローの行の中に警告として残します。
 * @param {string} flowId
 * @param {string} requested 付けようとした名前
 * @param {string} saved 保存した名前
 */
function showSaved(flowId, requested, saved) {
  if (requested === saved) {
    showToast(elements.toast, `「${saved}」を保存しました。`);
    renderFlows().catch(console.error);
    return;
  }
  setRowNotice(
    flowId,
    `同じサイトに「${requested}」があるため、「${saved}」として保存しました。`,
    'warning',
  );
}

/**
 * @param {string} text
 * @param {string} className
 * @param {() => void} onClick
 * @returns {HTMLButtonElement}
 */
function button(text, className, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.className = className;
  element.addEventListener('click', onClick);
  return element;
}

/**
 * 途中で折り返さない文字（日時など）を作ります。幅が狭いときに、日付と時刻が別の行に分かれないようにします。
 * @param {string} text
 * @returns {HTMLSpanElement}
 */
function nowrap(text) {
  const element = document.createElement('span');
  element.className = 'lm-nowrap';
  element.textContent = text;
  return element;
}

/** @returns {Promise<Flow | undefined>} */
async function getLastFlow() {
  const stored = await chrome.storage.session.get('lastFlow');
  return /** @type {Flow | undefined} */ (stored.lastFlow);
}

/**
 * @param {string} json
 * @param {string} filename
 */
function downloadJson(json, filename) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** @returns {string} ファイル名に使う日時（例：20260924-153000） */
function timestamp() {
  const now = new Date();
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
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
