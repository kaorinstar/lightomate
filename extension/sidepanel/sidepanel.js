// サイドパネルです。記録の開始・停止、記録したフローの保存、保存したフローの一覧と実行、
// 実行の状態を表示します。

import {
  deleteFlow,
  getFlow,
  listFlows,
  onFlowsChanged,
  renameFlow,
  saveFlow,
} from '../common/flow-store.js';
import { describeStep } from '../shared/describe.js';
import { isWebUrl, orderFlow } from '../shared/flow.js';
import {
  RUN_KEY_PREFIX,
  conflictMessage,
  findConflictingRun,
  flowsForOrigin,
  isActiveRun,
  runStatesFrom,
} from '../shared/flow-list.js';
import { defaultValue } from '../shared/params.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('../background/recording.js').Recording} Recording */
/** @typedef {import('../background/runner.js').RunState} RunState */
/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */

const elements = {
  version: byId('version'),
  message: byId('message'),
  runSection: byId('run-section'),
  runs: byId('runs'),
  formSection: byId('form-section'),
  formFlowName: byId('form-flow-name'),
  form: /** @type {HTMLFormElement} */ (byId('run-form')),
  formFields: byId('form-fields'),
  formCancel: byId('form-cancel'),
  pageOrigin: byId('page-origin'),
  start: /** @type {HTMLButtonElement} */ (byId('start')),
  stop: /** @type {HTMLButtonElement} */ (byId('stop')),
  stepsSection: byId('steps-section'),
  stepCount: byId('step-count'),
  steps: byId('steps'),
  resultSection: byId('result-section'),
  flowName: /** @type {HTMLInputElement} */ (byId('flow-name')),
  saveFlow: byId('save-flow'),
  result: /** @type {HTMLTextAreaElement} */ (byId('result')),
  copy: byId('copy'),
  save: byId('save'),
  flows: byId('flows'),
  flowsEmpty: byId('flows-empty'),
};

/**
 * 表示中のタブです。記録開始のボタンを押したときに、許可を求める画面を待たせずに出せるよう、
 * あらかじめ調べておきます。Chrome は、ボタンを押した直後にしか許可を求める画面を出さないためです。
 * @type {{ tabId: number, origin: string | null } | null}
 */
let currentPage = null;

/** 入力フォームを表示しているフローの id です。 */
let formFlowId = '';

/**
 * 一覧で名前を変更している、または削除の確認を表示しているフローです。
 * 実行中は状態が頻繁に変わるため、一覧を作り直しても入力中の名前が消えないよう、ここに保持します。
 * @type {{ id: string, mode: 'rename' | 'delete', name: string } | null}
 */
let editing = null;

elements.version.textContent = chrome.runtime.getManifest().version;

// ---- 記録 ----

elements.start.addEventListener('click', async () => {
  if (!currentPage?.origin) {
    return;
  }
  const { tabId, origin } = currentPage;
  if (!(await requestPermission(origin))) {
    return;
  }
  const response = await chrome.runtime.sendMessage({ kind: 'recording/start', tabId });
  showMessage(
    response?.ok ? '記録を開始しました。' : (response?.error ?? '記録を開始できません。'),
    !response?.ok,
  );
});

elements.stop.addEventListener('click', async () => {
  const response = await chrome.runtime.sendMessage({ kind: 'recording/stop' });
  if (!response?.ok) {
    showMessage(response?.error ?? '記録を停止できません。', true);
    return;
  }
  elements.flowName.value = response.flow.name;
  showMessage(
    response.errors.length === 0
      ? '記録を停止しました。フロー名を付けて保存できます。'
      : `記録を停止しました。形式に誤りがあります：${response.errors.join(' ')}`,
    response.errors.length > 0,
  );
});

elements.saveFlow.addEventListener('click', async () => {
  const lastFlow = await getLastFlow();
  if (!lastFlow) {
    return;
  }
  const name = elements.flowName.value.trim();
  if (!name) {
    showMessage('フロー名を入力してください。', true);
    return;
  }
  const result = await saveFlow({ ...lastFlow, name });
  if (!result.ok) {
    showMessage(`保存できませんでした：${result.errors.join(' ')}`, true);
    return;
  }
  await chrome.storage.session.remove('lastFlow');
  showMessage(savedMessage(name, result.name), false);
});

elements.copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(elements.result.value);
    showMessage('JSON をコピーしました。', false);
  } catch (error) {
    showMessage(`コピーできませんでした：${String(error)}`, true);
  }
});

elements.save.addEventListener('click', () => {
  downloadJson(elements.result.value, `lightomate-${timestamp()}.json`);
});

// ---- 実行 ----

/**
 * 実行のボタンを押したときの処理です。
 * @param {StoredFlow} stored
 */
async function onRunClick(stored) {
  // 許可を求める処理は、ボタンを押した直後に呼び出す必要があります。この前に待ち時間を入れないでください。
  if (!(await requestPermission(stored.flow.origin))) {
    return;
  }
  const params = stored.flow.params ?? [];
  const secretSteps = secretStepIndexes(stored.flow);
  if (params.length === 0 && secretSteps.length === 0) {
    await startRun(stored.id, {}, {});
    return;
  }
  showForm(stored);
}

/**
 * 実行時の入力フォームを表示します。
 * パラメータごとの入力欄と、値を記録していない入力欄（パスワードなど）ごとの入力欄を作ります。
 * @param {StoredFlow} stored
 */
function showForm(stored) {
  formFlowId = stored.id;
  elements.formFlowName.textContent = `「${stored.flow.name}」`;
  const now = new Date();

  const fields = (stored.flow.params ?? []).map((param) => {
    /** @type {HTMLInputElement | HTMLSelectElement} */
    let control;
    if (param.type === 'select') {
      control = document.createElement('select');
      for (const option of param.options ?? []) {
        control.append(new Option(option, option));
      }
    } else {
      control = document.createElement('input');
      control.type = param.type === 'month' ? 'month' : 'text';
      if (param.type === 'number') {
        control.inputMode = 'decimal';
      }
    }
    control.name = `param:${param.name}`;
    control.value = defaultValue(param, now);
    control.required = true;
    return labeled(param.label, control);
  });

  for (const index of secretStepIndexes(stored.flow)) {
    const step = stored.flow.steps[index];
    const control = document.createElement('input');
    control.type = 'password';
    control.name = `secret:${index}`;
    control.autocomplete = 'off';
    control.required = true;
    const label = step.type === 'input' ? step.target.label : '';
    fields.push(labeled(`${label}（手順 ${index + 1}）`, control));
  }

  elements.formFields.replaceChildren(...fields);
  elements.formSection.hidden = false;
  elements.formSection.scrollIntoView({ block: 'start' });
  const first = elements.formFields.querySelector('input, select');
  if (first instanceof HTMLElement) {
    first.focus();
  }
}

elements.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  /** @type {Record<string, string>} */
  const params = {};
  /** @type {Record<string, string>} */
  const secrets = {};
  for (const [key, value] of new FormData(elements.form)) {
    if (typeof value !== 'string') {
      continue;
    }
    if (key.startsWith('param:')) {
      params[key.slice('param:'.length)] = value;
    } else if (key.startsWith('secret:')) {
      secrets[key.slice('secret:'.length)] = value;
    }
  }
  const started = await startRun(formFlowId, params, secrets);
  if (started) {
    hideForm();
  }
});

elements.formCancel.addEventListener('click', hideForm);

/**
 * @param {string} flowId
 * @param {Record<string, string>} params
 * @param {Record<string, string>} secrets
 * @returns {Promise<boolean>} 実行を始められたか
 */
async function startRun(flowId, params, secrets) {
  const response = await chrome.runtime.sendMessage({
    kind: 'runner/start',
    flowId,
    params,
    secrets,
  });
  if (!response?.ok) {
    showMessage(response?.error ?? '実行を開始できません。', true);
    return false;
  }
  showMessage('', false);
  return true;
}

function hideForm() {
  elements.formSection.hidden = true;
  // 入力したパスワードなどを画面に残さないよう、入力欄ごと消します。
  elements.formFields.replaceChildren();
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
    currentPage = {
      tabId: tab.id,
      origin: frame && isWebUrl(frame.url) ? new URL(frame.url).origin : null,
    };
  }
  await renderFlows();
}

/** 記録と実行の状態に合わせて、画面を表示し直します。 */
async function render() {
  const stored = await chrome.storage.session.get(null);
  const recording = /** @type {Recording | undefined} */ (stored.recording);
  const lastFlow = /** @type {Flow | undefined} */ (stored.lastFlow);
  const runs = /** @type {RunState[]} */ (runStatesFrom(stored));

  if (recording) {
    elements.pageOrigin.textContent = recording.origin;
  } else if (currentPage?.origin) {
    elements.pageOrigin.textContent = currentPage.origin;
  } else {
    elements.pageOrigin.textContent =
      'このページは記録できません（https:// または http:// で始まるページで使えます）';
  }

  elements.start.hidden = Boolean(recording);
  // 同じサイトのフローを実行中のタブと、記録の操作が干渉しないよう、そのサイトでは記録を始めません。
  elements.start.disabled =
    !currentPage?.origin || Boolean(findConflictingRun(currentPage.origin, runs));
  elements.stop.hidden = !recording;

  const steps = recording?.steps ?? lastFlow?.steps;
  elements.stepsSection.hidden = !steps;
  elements.stepCount.textContent = String(steps?.length ?? 0);
  elements.steps.replaceChildren(
    ...(steps ?? []).map((step) => {
      const item = document.createElement('li');
      item.textContent = describeStep(step);
      return item;
    }),
  );

  elements.resultSection.hidden = Boolean(recording) || !lastFlow;
  elements.result.value = lastFlow ? JSON.stringify(orderFlow(lastFlow), null, 2) : '';
  if (lastFlow && !elements.flowName.value) {
    elements.flowName.value = lastFlow.name;
  }

  await renderRuns(runs);

  // 記録中と、同じサイトのフローを実行中は、実行のボタンを押せなくし、理由を表示します。
  for (const item of elements.flows.querySelectorAll('li[data-origin]')) {
    const row = /** @type {HTMLElement} */ (item);
    const conflict = findConflictingRun(row.dataset.origin ?? '', runs);
    const run = row.querySelector('button[data-run]');
    if (run instanceof HTMLButtonElement) {
      run.disabled = Boolean(recording) || Boolean(conflict);
    }
    const blocked = row.querySelector('.flow-blocked');
    if (blocked instanceof HTMLElement) {
      blocked.textContent = conflict ? conflictMessage(conflict.origin, conflict.flowName) : '';
      blocked.hidden = !conflict;
    }
  }
}

/**
 * 実行の状態を、実行ごとに表示します。
 * @param {RunState[]} runs
 */
async function renderRuns(runs) {
  elements.runSection.hidden = runs.length === 0;
  const items = await Promise.all(
    runs.map(async (run) => {
      const stored = await getFlow(run.flowId);
      const item = document.createElement('li');
      const status = document.createElement('p');
      status.className = 'run-status';
      status.classList.toggle('error', run.status === 'failed');
      status.textContent = runStatusText(run, stored?.flow.steps[run.stepIndex]);

      const buttons = document.createElement('div');
      buttons.className = 'buttons';
      if (isActiveRun(run)) {
        const stop = document.createElement('button');
        stop.type = 'button';
        stop.className = 'danger';
        stop.textContent = '実行停止';
        stop.disabled = run.status === 'stopping';
        stop.addEventListener('click', () => {
          chrome.runtime
            .sendMessage({ kind: 'runner/stop', runId: run.runId })
            .catch(console.error);
        });
        buttons.append(stop);
      } else {
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '閉じる';
        close.addEventListener('click', () => {
          chrome.storage.session.remove(RUN_KEY_PREFIX + run.runId).catch(console.error);
        });
        buttons.append(close);
      }
      item.append(status, buttons);
      return item;
    }),
  );
  elements.runs.replaceChildren(...items);
}

/**
 * 実行の状態の説明です。
 * @param {RunState} run
 * @param {import('../shared/flow.js').Step | undefined} step 実行中、または止まった手順
 * @returns {string}
 */
function runStatusText(run, step) {
  const where = `手順 ${run.stepIndex + 1} / ${run.total}${step ? `（${describeStep(step)}）` : ''}`;
  switch (run.status) {
    case 'running':
      return `「${run.flowName}」を実行中です。${where}`;
    case 'stopping':
      return `「${run.flowName}」を停止しています。${where}`;
    case 'done':
      return `「${run.flowName}」の実行が完了しました。`;
    case 'stopped':
      return `「${run.flowName}」の実行を停止しました。完了した手順は ${run.total} 件中 ${run.stepIndex} 件です。`;
    case 'failed':
      return `「${run.flowName}」の実行は ${where} で止まりました。${run.error ?? ''}`;
    case 'halted':
      // 止まった理由（error）に手順の説明が含まれるため、手順の番号だけを示します。
      return `「${run.flowName}」の実行は 手順 ${run.stepIndex + 1} / ${run.total} で止まりました。${run.error ?? ''}`;
  }
}

/**
 * 表示中のサイトのフローの一覧を表示します。ほかのサイトのフローは表示しません。
 * フローは、そのサイトのページでだけ実行する仕様のためです。
 */
async function renderFlows() {
  const origin = currentPage?.origin;
  const flows = flowsForOrigin(await listFlows(), origin);
  if (editing && !flows.some((stored) => stored.id === editing?.id)) {
    editing = null;
  }

  elements.flowsEmpty.hidden = flows.length > 0;
  elements.flowsEmpty.textContent = origin
    ? `${origin} のフローはまだありません。`
    : 'このページでは、フローを表示できません（https:// または http:// で始まるページで使えます）。';
  elements.flows.replaceChildren(...flows.map(flowItem));
  await render();
}

/**
 * フローの一覧の 1 行を作ります。
 * @param {StoredFlow} stored
 * @returns {HTMLLIElement}
 */
function flowItem(stored) {
  const item = document.createElement('li');
  item.dataset.origin = stored.flow.origin;

  if (editing?.id === stored.id && editing.mode === 'rename') {
    item.append(renameForm(stored, editing));
    return item;
  }

  const name = document.createElement('span');
  name.className = 'flow-name';
  name.textContent = stored.flow.name;
  const detail = document.createElement('span');
  detail.className = 'flow-detail';
  detail.textContent = `手順 ${stored.flow.steps.length} 件・更新 ${formatDate(stored.updatedAt)}`;
  const blocked = document.createElement('p');
  blocked.className = 'flow-blocked';
  blocked.hidden = true;

  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  if (editing?.id === stored.id && editing.mode === 'delete') {
    const question = document.createElement('p');
    question.className = 'flow-confirm';
    question.textContent = `「${stored.flow.name}」を削除します。元に戻せません。`;
    buttons.append(
      button('削除する', 'danger', () => {
        onDelete(stored).catch((error) => showMessage(String(error), true));
      }),
      button('キャンセル', '', () => setEditing(null)),
    );
    item.append(name, detail, question, buttons);
    return item;
  }

  const run = button('実行', '', () => {
    onRunClick(stored).catch((error) => showMessage(String(error), true));
  });
  run.dataset.run = stored.id;
  const edit = document.createElement('a');
  edit.href = `../options/options.html#${encodeURIComponent(stored.id)}`;
  edit.target = '_blank';
  edit.textContent = '編集';
  buttons.append(
    run,
    button('名前の変更', '', () =>
      setEditing({ id: stored.id, mode: 'rename', name: stored.flow.name }),
    ),
    button('削除', '', () => setEditing({ id: stored.id, mode: 'delete', name: '' })),
    edit,
  );
  item.append(name, detail, blocked, buttons);
  return item;
}

/**
 * 名前を変更する入力欄です。
 * @param {StoredFlow} stored
 * @param {{ name: string }} state 入力中の名前
 * @returns {HTMLFormElement}
 */
function renameForm(stored, state) {
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 200;
  input.required = true;
  input.value = state.name;
  input.addEventListener('input', () => {
    state.name = input.value;
  });
  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = '保存';
  buttons.append(
    save,
    button('キャンセル', '', () => setEditing(null)),
  );
  form.append(labeled('フロー名', input), buttons);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onRename(stored, input.value.trim()).catch((error) => showMessage(String(error), true));
  });
  queueMicrotask(() => input.focus());
  return form;
}

/**
 * @param {StoredFlow} stored
 * @param {string} name
 */
async function onRename(stored, name) {
  if (!name) {
    showMessage('フロー名を入力してください。', true);
    return;
  }
  const result = await renameFlow(stored.id, name);
  if (!result.ok) {
    showMessage(`名前を変更できませんでした：${result.errors.join(' ')}`, true);
    return;
  }
  editing = null;
  showMessage(savedMessage(name, result.name), false);
  await renderFlows();
}

/** @param {StoredFlow} stored */
async function onDelete(stored) {
  await deleteFlow(stored.id);
  editing = null;
  showMessage(`「${stored.flow.name}」を削除しました。`, false);
  await renderFlows();
}

/**
 * 名前の変更と削除の確認を始める、または終えます。
 * @param {{ id: string, mode: 'rename' | 'delete', name: string } | null} state
 */
function setEditing(state) {
  editing = state;
  renderFlows().catch(console.error);
}

// ---- 補助 ----

/**
 * サイトを操作する許可を求めます。許可済みの場合、画面は表示されません。
 * @param {string} origin
 * @returns {Promise<boolean>}
 */
async function requestPermission(origin) {
  try {
    if (await chrome.permissions.request({ origins: [`${origin}/*`] })) {
      return true;
    }
  } catch (error) {
    showMessage(`許可を求められませんでした：${String(error)}`, true);
    return false;
  }
  showMessage(`${origin} を操作する許可が得られなかったため、続けられません。`, true);
  return false;
}

/**
 * 値を記録していない入力欄（パスワードなど）の手順の番号を返します。
 * @param {Flow} flow
 * @returns {number[]}
 */
function secretStepIndexes(flow) {
  return flow.steps.flatMap((step, index) => (step.type === 'input' && step.secret ? [index] : []));
}

/**
 * 保存したことの知らせです。同じサイトに同じ名前のフローがあり、番号を付けた場合はその旨を加えます。
 * @param {string} requested 付けようとした名前
 * @param {string} saved 保存した名前
 * @returns {string}
 */
function savedMessage(requested, saved) {
  return requested === saved
    ? `「${saved}」を保存しました。`
    : `同じサイトに「${requested}」があるため、「${saved}」として保存しました。`;
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
  if (className) {
    element.className = className;
  }
  element.addEventListener('click', onClick);
  return element;
}

/**
 * 日時を「2026/9/25 10:05」の形式にします。
 * @param {string} iso
 * @returns {string}
 */
function formatDate(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** @returns {Promise<Flow | undefined>} */
async function getLastFlow() {
  const stored = await chrome.storage.session.get('lastFlow');
  return /** @type {Flow | undefined} */ (stored.lastFlow);
}

/**
 * @param {string} text
 * @param {HTMLElement} control
 * @returns {HTMLLabelElement}
 */
function labeled(text, control) {
  const label = document.createElement('label');
  label.className = 'field';
  label.append(text, control);
  return label;
}

/**
 * @param {string} text
 * @param {boolean} isError
 */
function showMessage(text, isError) {
  elements.message.textContent = text;
  elements.message.classList.toggle('error', isError);
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
