// サイドパネルです。記録の開始・停止、記録したフローの保存、保存したフローの一覧と実行、
// 実行の状態を表示します。

import { listFlows, getFlow, onFlowsChanged, saveFlow } from '../common/flow-store.js';
import { describeStep } from '../shared/describe.js';
import { isWebUrl, orderFlow } from '../shared/flow.js';
import { defaultValue } from '../shared/params.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('../background/recording.js').Recording} Recording */
/** @typedef {import('../background/runner.js').RunState} RunState */
/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */

const elements = {
  version: byId('version'),
  message: byId('message'),
  runSection: byId('run-section'),
  runStatus: byId('run-status'),
  runStop: /** @type {HTMLButtonElement} */ (byId('run-stop')),
  runClose: /** @type {HTMLButtonElement} */ (byId('run-close')),
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
  showMessage(`「${name}」を保存しました。`, false);
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

elements.runStop.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ kind: 'runner/stop' });
});

elements.runClose.addEventListener('click', async () => {
  await chrome.storage.session.remove('run');
});

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

// 表示中のタブや、そのタブのページが変わったときに、記録するページの表示を更新します。
chrome.tabs.onActivated.addListener(() => {
  refreshCurrentPage().catch(console.error);
});
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && details.tabId === currentPage?.tabId) {
    refreshCurrentPage().catch(console.error);
  }
});

refreshCurrentPage().catch(console.error);
renderFlows().catch(console.error);

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
  await render();
}

/** 記録と実行の状態に合わせて、画面を表示し直します。 */
async function render() {
  const stored = await chrome.storage.session.get(['recording', 'lastFlow', 'run']);
  const recording = /** @type {Recording | undefined} */ (stored.recording);
  const lastFlow = /** @type {Flow | undefined} */ (stored.lastFlow);
  const run = /** @type {RunState | undefined} */ (stored.run);
  const running = run?.status === 'running' || run?.status === 'stopping';

  if (recording) {
    elements.pageOrigin.textContent = recording.origin;
  } else if (currentPage?.origin) {
    elements.pageOrigin.textContent = currentPage.origin;
  } else {
    elements.pageOrigin.textContent =
      'このページは記録できません（https:// または http:// で始まるページで使えます）';
  }

  elements.start.hidden = Boolean(recording);
  elements.start.disabled = !currentPage?.origin || running;
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

  await renderRun(run);
  for (const button of elements.flows.querySelectorAll('button[data-run]')) {
    /** @type {HTMLButtonElement} */ (button).disabled = running || Boolean(recording);
  }
}

/**
 * 実行の状態を表示します。
 * @param {RunState | undefined} run
 */
async function renderRun(run) {
  elements.runSection.hidden = !run;
  if (!run) {
    return;
  }
  const running = run.status === 'running' || run.status === 'stopping';
  elements.runStop.hidden = !running;
  elements.runStop.disabled = run.status === 'stopping';
  elements.runClose.hidden = running;

  const stored = await getFlow(run.flowId);
  const step = stored?.flow.steps[run.stepIndex];
  const where = `手順 ${run.stepIndex + 1} / ${run.total}${step ? `（${describeStep(step)}）` : ''}`;

  elements.runStatus.classList.toggle('error', run.status === 'failed');
  switch (run.status) {
    case 'running':
      elements.runStatus.textContent = `「${run.flowName}」を実行中です。${where}`;
      break;
    case 'stopping':
      elements.runStatus.textContent = `「${run.flowName}」を停止しています。${where}`;
      break;
    case 'done':
      elements.runStatus.textContent = `「${run.flowName}」の実行が完了しました。`;
      break;
    case 'stopped':
      elements.runStatus.textContent = `「${run.flowName}」の実行を停止しました。${where} まで実行しました。`;
      break;
    case 'failed':
      elements.runStatus.textContent = `「${run.flowName}」の実行は ${where} で止まりました。${run.error ?? ''}`;
      break;
  }
}

/** 保存したフローの一覧を表示します。 */
async function renderFlows() {
  const flows = await listFlows();
  elements.flowsEmpty.hidden = flows.length > 0;
  elements.flows.replaceChildren(
    ...flows.map((stored) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'flow-name';
      name.textContent = stored.flow.name;
      const origin = document.createElement('span');
      origin.className = 'flow-origin';
      origin.textContent = stored.flow.origin;

      const run = document.createElement('button');
      run.type = 'button';
      run.textContent = '実行';
      run.dataset.run = stored.id;
      run.addEventListener('click', () => {
        onRunClick(stored).catch((error) => showMessage(String(error), true));
      });
      const edit = document.createElement('a');
      edit.href = `../options/options.html#${encodeURIComponent(stored.id)}`;
      edit.target = '_blank';
      edit.textContent = '編集';

      const buttons = document.createElement('div');
      buttons.className = 'buttons';
      buttons.append(run, edit);
      item.append(name, origin, buttons);
      return item;
    }),
  );
  await render();
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
