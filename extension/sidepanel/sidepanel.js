// サイドパネルです。記録の開始・停止、記録したフローの保存、保存したフローの一覧と実行、
// 実行の状態を表示します。Web ページを表示しているときはそのサイトのフローを、それ以外のページ
// （新しいタブなど）ではすべてのフローを、ホスト名ごとにまとめて検索できる形で表示します（#44）。
// 配置と、知らせを出す場所は docs/design-guidelines.md に従います。成功は画面の上部のトーストに出し、
// 誤り・警告・確認は押したボタンの直下（行の中の操作は、その行の中）に出します。

import {
  deleteFlow,
  getFlow,
  listFlows,
  onFlowsChanged,
  renameFlow,
  saveFlow,
} from '../common/flow-store.js';
import { requestPermission } from '../common/permissions.js';
import { describeStep, formatDateTime, runStatusText } from '../shared/describe.js';
import { flattenSteps, stepAt } from '../shared/control-flow.js';
import { flowOrigins, orderFlow } from '../shared/flow.js';
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
/** @typedef {import('../background/runner.js').RunState} RunState */
/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */
/** @typedef {import('../shared/ui.js').NoticeKind} NoticeKind */

const elements = {
  pageOrigin: byId('page-origin'),
  runSection: byId('run-section'),
  runs: byId('runs'),
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
  recordingSiteText: byId('recording-site-text'),
  recordingAllow: /** @type {HTMLButtonElement} */ (byId('recording-allow')),
  recordingAllowNotice: byId('recording-allow-notice'),
  recordingNotice: byId('recording-notice'),
  stepCount: byId('step-count'),
  steps: byId('steps'),
  stop: /** @type {HTMLButtonElement} */ (byId('stop')),
  recordingDiscard: /** @type {HTMLButtonElement} */ (byId('recording-discard')),
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
  toast: byId('toast'),
  flowsHeading: byId('flows-heading'),
  searchArea: byId('search-area'),
  search: /** @type {HTMLInputElement} */ (byId('search')),
  searchSuggestions: byId('search-suggestions'),
  searchMode: /** @type {HTMLSelectElement} */ (byId('search-mode')),
};

/** 区画に固定で置いた知らせの表示欄です。次の操作を始めるときに、まとめて消します。 */
const notices = [
  elements.formNotice,
  elements.recordingNotice,
  elements.recordingDiscardNotice,
  elements.recordingAllowNotice,
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

/** 入力フォームで行う操作です。実行する（run）か、最初のページを開く（open）かです。 */
/** @type {'run' | 'open'} */
let formMode = 'run';

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
  menuOpenId = '';
}

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

// 記録中に、許可がないサイトへ移動したときのボタンです（#41）。許可を得てから、そのページでも記録を続けます。
// Chrome は利用者の操作を起点にしか許可を求められないため、ボタンで求めます。
elements.recordingAllow.addEventListener('click', async () => {
  clearNotices();
  const origin = elements.recordingAllow.dataset.origin ?? '';
  if (!origin) {
    return;
  }
  const denied = await requestPermission(origin);
  if (denied) {
    showNotice(elements.recordingAllowNotice, denied, 'error');
    return;
  }
  const response = await chrome.runtime.sendMessage({ kind: 'recording/allowOrigin', origin });
  if (!response?.ok) {
    showNotice(
      elements.recordingAllowNotice,
      response?.error ?? 'このサイトでは記録できません。',
      'error',
    );
  }
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
  await chrome.storage.session.remove('lastFlow');
  showSaved(result.id, name, result.name);
});

elements.discard.addEventListener('click', async () => {
  clearNotices();
  const confirmed = await confirmInline(elements.resultConfirm, {
    message: '記録した手順を破棄します。元に戻せません。',
    confirmLabel: '破棄する',
    danger: true,
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
  elements.formSection.scrollIntoView({ block: 'start' });
  const first = elements.formFields.querySelector('input, select');
  if (first instanceof HTMLElement) {
    first.focus();
  }
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearNotices();
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
  formParams = [];
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
 * 記録中のタブが、記録を始めたサイト以外のページを表示しているときの知らせです（#41）。
 * 許可があるサイトでは、確認を出さずに記録していることを知らせます。許可がないサイトでは、
 * 記録していないことと［このサイトを許可して記録］を表示します。
 * @param {Recording} recording
 * @param {RecordingPage | undefined} page
 */
function renderRecordingSite(recording, page) {
  const other = page && page.origin !== recording.origin ? page : undefined;
  elements.recordingSite.hidden = !other;
  elements.recordingAllow.hidden = !other || other.allowed;
  elements.recordingAllow.dataset.origin = other && !other.allowed ? other.origin : '';
  elements.recordingSiteText.textContent = !other
    ? ''
    : other.allowed
      ? `${other.origin} でも記録しています。`
      : `${other.origin} は許可していないため、記録していません。このサイトでの操作も記録する場合は、アドレスバーのサイト名が利用しているサービスのものか確かめてから、下のボタンを押してください。`;
}

/** 記録と実行の状態に合わせて、画面を表示し直します。 */
async function render() {
  const stored = await chrome.storage.session.get(null);
  const recording = /** @type {Recording | undefined} */ (stored.recording);
  const lastFlow = /** @type {Flow | undefined} */ (stored.lastFlow);
  const runs = /** @type {RunState[]} */ (runStatesFrom(stored));
  // フローの実行中は、記録した手順の削除と破棄をできないようにします。
  const running = runs.some(isActiveRun);

  // Web ページ以外では記録できませんが、すべてのフローの一覧から開く・実行することはできます（#44）。
  elements.pageOrigin.textContent = currentPage?.origin ?? 'Web ページ以外を表示しています';

  // 同じサイトのフローを実行中のタブと、記録の操作が干渉しないよう、そのサイトでは記録を始めません。
  elements.start.disabled =
    !currentPage?.origin ||
    Boolean(recording) ||
    Boolean(findConflictingRun(currentPage.origin, runs));

  elements.recordingSection.hidden = !recording;
  if (recording) {
    elements.recordingOrigin.textContent = `記録するページ：${[recording.origin, ...(recording.extraOrigins ?? [])].join('、')}`;
    renderRecordingSite(recording, /** @type {RecordingPage | undefined} */ (stored.recordingPage));
    elements.stepCount.textContent = String(recording.steps.length);
    elements.steps.replaceChildren(
      ...stepItems(recording.steps, running, elements.recordingNotice),
    );
    elements.recordingDiscard.disabled = running || recording.steps.length === 0;
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
    ...stepItems(lastFlow?.steps ?? [], running, elements.saveNotice),
  );
  elements.discard.disabled = running || !lastFlow?.steps.length;
  if (lastFlow && !elements.flowName.value) {
    elements.flowName.value = lastFlow.name;
  }

  await renderRuns(runs);

  // 記録中と、同じサイトのフローを実行中は、実行のボタンを押せなくし、理由を行の中に表示します。
  // すべてのフローを表示しているとき（Web ページ以外）は、最初の手順がページを開く手順でないフローも
  // 押せなくします。開くページが決まらず、実行するタブもないためです。
  for (const item of elements.flows.querySelectorAll('[data-origin]')) {
    const row = /** @type {HTMLElement} */ (item);
    const conflict = findConflictingRun(row.dataset.origin ?? '', runs);
    const noFirstPage = row.dataset.noFirstPage === 'true';
    const text = noFirstPage
      ? NO_FIRST_PAGE
      : recording
        ? '記録中は実行できません。'
        : conflict
          ? conflictMessage(conflict.origin, conflict.flowName)
          : '';
    const run = row.querySelector('button[data-run]');
    if (run instanceof HTMLButtonElement) {
      run.disabled = Boolean(text);
    }
    const reason = row.querySelector('.lm-flow-reason');
    if (reason instanceof HTMLElement) {
      reason.textContent = text;
      reason.hidden = !text;
    }
  }
}

/**
 * 手順の一覧の項目を作ります。各行の右端に、その手順を削除する「×」を置きます。
 * @param {import('../shared/flow.js').Step[]} steps
 * @param {boolean} locked 削除できない状態（フローの実行中）か
 * @param {HTMLElement} errorNotice 削除できなかったときに知らせを出す場所
 * @returns {HTMLLIElement[]}
 */
function stepItems(steps, locked, errorNotice) {
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
    return item;
  });
}

/**
 * 実行の状態を、実行ごとに 1 枚ずつ表示します。止まった理由は、その実行の区画の中に表示します。
 * @param {RunState[]} runs
 */
async function renderRuns(runs) {
  elements.runSection.hidden = runs.length === 0;
  const cards = await Promise.all(
    runs.map(async (run) => {
      const stored = await getFlow(run.flowId);
      const card = document.createElement('div');
      card.className = 'card';
      const body = document.createElement('div');
      body.className = 'card-body';
      card.append(body);

      const status = document.createElement('p');
      // stepIndex は、if と forEach の内側を展開した通し番号です（#6）。
      const text = runStatusText(run, stored && stepAt(stored.flow.steps, run.stepIndex));
      if (run.status === 'failed') {
        card.classList.add('lm-card-failed');
        showNotice(status, text, 'error');
      } else if (run.status === 'halted' || run.status === 'paused') {
        showNotice(status, text, 'warning');
      } else if (run.status === 'done') {
        showNotice(status, text, 'success');
      } else {
        // 実行中の文は手順ごとに長さが変わるため、高さを固定し、はみ出す分は省略します（#98）。
        // 省略した部分は、マウスを重ねると表示します。
        status.className = 'm-0 lm-run-progress';
        status.setAttribute('role', 'status');
        status.textContent = text;
        status.title = text;
      }

      // ボタンは状態の文より上に置きます。文の行数が変わっても、ボタンの位置が動かないようにするためです（#98）。
      const buttons = document.createElement('div');
      buttons.className = 'lm-buttons mb-3';
      if (isActiveRun(run)) {
        // 一時停止中は［再開］、それ以外は［一時停止］を置きます（#37）。
        const paused = run.status === 'paused';
        const toggle = button(paused ? '再開' : '一時停止', 'btn btn-sm', () => {
          chrome.runtime
            .sendMessage({ kind: paused ? 'runner/resume' : 'runner/pause', runId: run.runId })
            .then((response) => {
              if (!response?.ok) {
                showNotice(status, response?.error ?? '再開できませんでした。', 'error');
              }
            })
            .catch((error) => showNotice(status, String(error), 'error'));
        });
        toggle.disabled = run.status !== 'running' && !paused;
        const stop = button('実行停止', 'btn btn-sm btn-danger', () => {
          chrome.runtime
            .sendMessage({ kind: 'runner/stop', runId: run.runId })
            .catch(console.error);
        });
        stop.disabled = run.status === 'stopping';
        buttons.append(toggle, stop);
      } else {
        buttons.append(
          button('閉じる', 'btn btn-sm', () => {
            chrome.storage.session.remove(RUN_KEY_PREFIX + run.runId).catch(console.error);
          }),
        );
        if (run.status === 'failed' && stored) {
          buttons.append(editLink(stored, 'フローを編集'));
        }
      }
      body.append(buttons, status);
      return card;
    }),
  );
  elements.runs.replaceChildren(...cards);
}

/**
 * フローの一覧を表示します。Web ページを表示しているときは、そのサイトのフローだけを表示します。
 * フローは、そのサイトのページでだけ実行する仕様のためです。Web ページ以外（新しいタブなど）では、
 * すべてのフローをホスト名ごとにまとめ、検索欄で絞り込めるようにします（#44）。
 */
async function renderFlows() {
  const origin = currentPage?.origin;
  const all = await listFlows();
  const shown = flowsToShow(all, origin);
  const everything = shown.scope === 'all';
  allScope = everything;
  searchable = everything ? all : [];
  if (editing && !shown.flows.some((stored) => stored.id === editing?.id)) {
    editing = null;
  }

  elements.flowsHeading.textContent = everything ? 'すべてのフロー' : 'このサイトのフロー';
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
  await render();
}

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
  detail.textContent = `手順 ${flattenSteps(stored.flow.steps).length} 件・更新 ${formatDateTime(stored.updatedAt)}`;
  const text = document.createElement('div');
  text.className = 'lm-flow-text';
  text.append(name, detail);

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

  const run = button('実行', 'btn btn-sm btn-primary', () => {
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
  const actions = document.createElement('div');
  actions.className = 'lm-flow-actions';
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
  actions.append(run, more);
  main.append(actions);

  const reason = document.createElement('p');
  reason.className = 'lm-flow-reason lm-sub';
  reason.hidden = true;
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
