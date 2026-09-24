// サイドパネルです。記録の開始・停止、記録した手順の一覧、記録した内容（JSON）を表示します。

import { isWebUrl, orderFlow } from '../shared/flow.js';

/** @typedef {import('../shared/flow.js').Flow} Flow */
/** @typedef {import('../shared/flow.js').Step} Step */
/** @typedef {import('../background/recording.js').Recording} Recording */

const elements = {
  version: byId('version'),
  pageOrigin: byId('page-origin'),
  start: /** @type {HTMLButtonElement} */ (byId('start')),
  stop: /** @type {HTMLButtonElement} */ (byId('stop')),
  message: byId('message'),
  stepsSection: byId('steps-section'),
  stepCount: byId('step-count'),
  steps: byId('steps'),
  resultSection: byId('result-section'),
  result: /** @type {HTMLTextAreaElement} */ (byId('result')),
  copy: byId('copy'),
  save: byId('save'),
};

/**
 * 表示中のタブです。記録開始のボタンを押したときに、許可を求める画面を待たせずに出せるよう、
 * あらかじめ調べておきます。Chrome は、ボタンを押した直後にしか許可を求める画面を出さないためです。
 * @type {{ tabId: number, origin: string | null } | null}
 */
let currentPage = null;

elements.version.textContent = chrome.runtime.getManifest().version;

elements.start.addEventListener('click', async () => {
  if (!currentPage?.origin) {
    return;
  }
  const { tabId, origin } = currentPage;

  // 許可を求める処理は、ボタンを押した直後に呼び出す必要があります。この前に待ち時間を入れないでください。
  let granted;
  try {
    granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch (error) {
    showMessage(`許可を求められませんでした：${String(error)}`, true);
    return;
  }
  if (!granted) {
    showMessage(`${origin} を操作する許可が得られなかったため、記録を開始できません。`, true);
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
  showMessage(
    response.errors.length === 0
      ? '記録を停止しました。'
      : `記録を停止しました。形式に誤りがあります：${response.errors.join(' ')}`,
    response.errors.length > 0,
  );
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
  const blob = new Blob([elements.result.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `lightomate-${timestamp()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

// 記録の状態は Service Worker が chrome.storage.session に書き込みます。変更のたびに表示を更新します。
chrome.storage.session.onChanged.addListener(() => {
  render().catch(console.error);
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

/** 記録の状態に合わせて、画面全体を表示し直します。 */
async function render() {
  const stored = await chrome.storage.session.get(['recording', 'lastFlow']);
  const recording = /** @type {Recording | undefined} */ (stored.recording);
  const lastFlow = /** @type {Flow | undefined} */ (stored.lastFlow);

  if (recording) {
    elements.pageOrigin.textContent = recording.origin;
  } else if (currentPage?.origin) {
    elements.pageOrigin.textContent = currentPage.origin;
  } else {
    elements.pageOrigin.textContent =
      'このページは記録できません（https:// または http:// で始まるページで使えます）';
  }

  elements.start.hidden = Boolean(recording);
  elements.start.disabled = !currentPage?.origin;
  elements.stop.hidden = !recording;

  const steps = recording?.steps ?? lastFlow?.steps;
  elements.stepsSection.hidden = !steps;
  elements.stepCount.textContent = String(steps?.length ?? 0);
  elements.steps.replaceChildren(
    ...(steps ?? []).map((step) => {
      const item = document.createElement('li');
      item.textContent = describe(step);
      return item;
    }),
  );

  elements.resultSection.hidden = Boolean(recording) || !lastFlow;
  elements.result.value = lastFlow ? JSON.stringify(orderFlow(lastFlow), null, 2) : '';
}

/**
 * 手順を 1 行の説明にします。
 * @param {Step} step
 * @returns {string}
 */
function describe(step) {
  switch (step.type) {
    case 'navigate':
      return `${step.cause === 'user' ? 'ページを開く' : 'ページが移動'}：${step.url}`;
    case 'click':
      return `クリック：${step.target.label}`;
    case 'input':
      return step.secret
        ? `入力：${step.target.label}（値は記録していません）`
        : `入力：${step.target.label} ← ${step.value}`;
    case 'select':
      return `選択：${step.target.label} ← ${step.labels.join('、')}`;
  }
}

/**
 * @param {string} text
 * @param {boolean} isError
 */
function showMessage(text, isError) {
  elements.message.textContent = text;
  elements.message.classList.toggle('error', isError);
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
