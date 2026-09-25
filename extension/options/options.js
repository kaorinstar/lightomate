// フローの管理画面です。保存したフローの内容の表示、名前の変更、書き出し、削除、JSON の編集と、
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
import {
  getStopRule,
  listStopRules,
  onStopRulesChanged,
  saveStopRule,
} from '../common/stop-rules-store.js';
import { describeParam, describeStep, formatDateTime, stepKindLabel } from '../shared/describe.js';
import { isWebOrigin, orderFlow, validateFlow } from '../shared/flow.js';
import { parseLines, validateStopRule } from '../shared/stop-rules.js';
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
  json: /** @type {HTMLTextAreaElement} */ (byId('json')),
  save: byId('save'),
  exportFlow: byId('export'),
  deleteFlow: byId('delete'),
  importer: byId('importer'),
  importNotice: byId('import-notice'),
  importConfirm: byId('import-confirm'),
  file: /** @type {HTMLInputElement} */ (byId('file')),
  importJson: /** @type {HTMLTextAreaElement} */ (byId('import-json')),
  importFlow: byId('import'),
  stopList: byId('stop-list'),
  stopEmpty: byId('stop-empty'),
  stopForm: /** @type {HTMLFormElement} */ (byId('stop-form')),
  stopOrigin: /** @type {HTMLInputElement} */ (byId('stop-origin')),
  stopOriginFeedback: byId('stop-origin-feedback'),
  stopOrigins: byId('stop-origins'),
  stopSelectors: /** @type {HTMLTextAreaElement} */ (byId('stop-selectors')),
  stopPaths: /** @type {HTMLTextAreaElement} */ (byId('stop-paths')),
  stopClear: byId('stop-clear'),
  stopDelete: byId('stop-delete'),
  stopConfirm: byId('stop-confirm'),
  stopNotice: byId('stop-notice'),
  toast: byId('toast'),
};

/** 区画に置いた知らせの表示欄です。次の操作を始めるときに、まとめて消します。 */
const notices = [
  elements.editorNotice,
  elements.jsonNotice,
  elements.importNotice,
  elements.stopNotice,
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
  // JSON の誤りの説明は知らせの欄にあるため、知らせと同時に編集欄の誤りの印も消します。
  for (const textarea of [elements.json, elements.importJson]) {
    textarea.classList.remove('is-invalid');
    textarea.removeAttribute('aria-invalid');
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
  const flow = parse(elements.json, elements.jsonNotice);
  if (!flow) {
    return;
  }
  const result = await saveFlow(flow, selectedId);
  if (!result.ok) {
    showJsonErrors(
      elements.json,
      elements.jsonNotice,
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
  // JSON の編集欄の名前も新しい名前にするため、次の表示で編集欄を読み込み直します。
  delete elements.editor.dataset.id;
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
  const flow = parse(elements.importJson, elements.importNotice);
  if (!flow) {
    return;
  }
  const errors = validateFlow(flow);
  if (errors.length > 0) {
    showJsonErrors(
      elements.importJson,
      elements.importNotice,
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
    showNotice(elements.importNotice, result.errors.join('\n'), 'error');
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

onFlowsChanged(() => {
  render().catch(console.error);
  renderStopRules().catch(console.error);
});
render().catch(console.error);

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

elements.stopOrigin.addEventListener('input', () => {
  showFieldError(elements.stopOrigin, elements.stopOriginFeedback, '');
});

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
  const errors = [...validateStopRule(rule), ...selectorSyntaxErrors(rule.selectors)];
  if (errors.length > 0) {
    showNotice(
      elements.stopNotice,
      `指定に誤りがあるため、保存しませんでした。\n${errors.join('\n')}`,
      'error',
    );
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
    showNotice(
      elements.stopNotice,
      origin
        ? `${origin} の指定はありません。削除するサイトを一覧から選んでください。`
        : '削除するサイトを一覧から選んでください。',
      'error',
    );
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
  showFieldError(elements.stopOrigin, elements.stopOriginFeedback, '');
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
  // 別のフローを選んだら、JSON の編集欄は閉じ、内容の表示から見せます。
  elements.jsonDetails.open = false;
  render().catch(console.error);
}

/** 一覧と詳細を表示し直します。 */
async function render() {
  const flows = await listFlows();
  elements.empty.hidden = flows.length > 0;
  elements.flowCount.textContent = flows.length > 0 ? String(flows.length) : '';
  elements.flows.replaceChildren(...flowListItems(flows));

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
 * フローの一覧を、サイトごとに見出しを付けて作ります。
 * @param {StoredFlow[]} flows
 * @returns {HTMLElement[]}
 */
function flowListItems(flows) {
  /** @type {Map<string, StoredFlow[]>} */
  const byOrigin = new Map();
  for (const stored of flows) {
    byOrigin.set(stored.flow.origin, [...(byOrigin.get(stored.flow.origin) ?? []), stored]);
  }
  return [...byOrigin.keys()].sort().flatMap((origin) => {
    const group = byOrigin.get(origin) ?? [];
    const heading = document.createElement('div');
    heading.className = 'list-group-item lm-list-heading';
    heading.textContent = `${origin}（${group.length}）`;
    const items = group.map((stored) => {
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
    });
    return [heading, ...items];
  });
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
 * JSON を読み取ります。誤りがある場合は、その内容を区画の中に表示して null を返します。
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} notice 誤りを表示する欄
 * @returns {unknown}
 */
function parse(textarea, notice) {
  try {
    const value = JSON.parse(textarea.value);
    textarea.classList.remove('is-invalid');
    textarea.removeAttribute('aria-invalid');
    return value;
  } catch (error) {
    showJsonErrors(textarea, notice, `JSON として読み取れません。${String(error)}`);
    return null;
  }
}

/**
 * JSON の誤りを、保存や追加のボタンの直下の表示欄に一覧で表示し、編集欄に誤りの印を付けます。
 * 編集欄は長く、編集欄の上に出すと、下端のボタンを押したときに画面の外に出るためです。
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} notice
 * @param {string} text
 */
function showJsonErrors(textarea, notice, text) {
  showNotice(notice, text, 'error');
  textarea.classList.add('is-invalid');
  textarea.setAttribute('aria-invalid', 'true');
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
