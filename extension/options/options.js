// フローの管理画面です。保存したフローの JSON の編集、書き出し、削除と、JSON からの追加を行います。
// ビジュアルエディタ（#9）ができるまでは、JSON を直接編集します。
// 配置と、知らせを出す場所は docs/design-guidelines.md に従います。知らせは画面の上部にまとめず、
// 操作した区画の中に出します。

import { deleteFlow, getFlow, listFlows, onFlowsChanged, saveFlow } from '../common/flow-store.js';
import {
  getStopRule,
  listStopRules,
  onStopRulesChanged,
  saveStopRule,
} from '../common/stop-rules-store.js';
import { isWebOrigin, orderFlow, validateFlow } from '../shared/flow.js';
import { parseLines, validateStopRule } from '../shared/stop-rules.js';
import { confirmInline, followColorScheme, showFieldError, showNotice } from '../shared/ui.js';

/** @typedef {import('../common/flow-store.js').StoredFlow} StoredFlow */

const elements = {
  version: byId('version'),
  listNotice: byId('list-notice'),
  flows: byId('flows'),
  empty: byId('empty'),
  newFlow: byId('new'),
  placeholder: byId('placeholder'),
  editor: byId('editor'),
  editorHeading: byId('editor-heading'),
  editorOrigin: byId('editor-origin'),
  editorConfirm: byId('editor-confirm'),
  editorNotice: byId('editor-notice'),
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
};

/** 区画に置いた知らせの表示欄です。次の操作を始めるときに、まとめて消します。 */
const notices = [
  elements.listNotice,
  elements.editorNotice,
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

elements.newFlow.addEventListener('click', () => {
  select('');
  elements.importer.hidden = false;
  elements.placeholder.hidden = true;
  elements.importJson.focus();
});

elements.save.addEventListener('click', async () => {
  clearNotices();
  const flow = parse(elements.json, elements.editorNotice);
  if (!flow) {
    return;
  }
  const result = await saveFlow(flow, selectedId);
  if (!result.ok) {
    showJsonErrors(
      elements.json,
      elements.editorNotice,
      `形式に誤りがあるため、保存しませんでした。\n${result.errors.join('\n')}`,
    );
    return;
  }
  const { name } = /** @type {{ name: string }} */ (flow);
  if (result.name === name) {
    showNotice(elements.editorNotice, '保存しました。', 'success');
    return;
  }
  // 同じサイトに同じ名前のフローがあり、番号を付けて保存した場合は、編集欄の名前も合わせます。
  elements.json.value = JSON.stringify(
    orderFlow(/** @type {import('../shared/flow.js').Flow} */ ({ ...flow, name: result.name })),
    null,
    2,
  );
  showNotice(
    elements.editorNotice,
    `同じサイトに「${name}」があるため、「${result.name}」として保存しました。`,
    'success',
  );
});

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
  // 詳細の区画は閉じるため、一覧の区画に知らせます。
  showNotice(elements.listNotice, `「${stored.flow.name}」を削除しました。`, 'success');
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
  // 追加したフローは詳細の区画で開くため、その区画に知らせます。
  showNotice(
    elements.editorNotice,
    result.name === name
      ? `「${name}」を追加しました。`
      : `同じサイトに「${name}」があるため、「${result.name}」として追加しました。`,
    'success',
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
  onSaveStopRule().catch((error) => showStopNotice(String(error), 'error'));
});

elements.stopClear.addEventListener('click', () => {
  clearNotices();
  editStopRule('', { selectors: [], paths: [] });
});

elements.stopDelete.addEventListener('click', () => {
  clearNotices();
  onDeleteStopRule().catch((error) => showStopNotice(String(error), 'error'));
});

elements.stopOrigin.addEventListener('input', () => {
  showFieldError(elements.stopOrigin, elements.stopOriginFeedback, '');
});

onStopRulesChanged(() => {
  renderStopRules().catch(console.error);
});
renderStopRules().catch(console.error);

/**
 * 「必ず止まる場所」の結果と誤りを、保存のボタンの下に表示します。
 * 画面の上部の表示欄では、下部の入力欄を操作している間に見えないためです。
 * @param {string} text
 * @param {import('../shared/ui.js').NoticeKind} kind
 */
function showStopNotice(text, kind) {
  showNotice(elements.stopNotice, text, kind);
  if (text) {
    // 保存のボタンが画面の下端にある場合も、表示が見える位置まで移動します。
    elements.stopNotice.scrollIntoView({ block: 'nearest' });
  }
}

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
    showStopNotice(`指定に誤りがあるため、保存しませんでした。\n${errors.join('\n')}`, 'error');
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
    showStopNotice(`保存できませんでした。\n${result.errors.join('\n')}`, 'error');
    return;
  }
  elements.stopOrigin.value = origin;
  showStopNotice(
    removing ? `${origin} の指定を削除しました。` : `${origin} の指定を保存しました。`,
    'success',
  );
}

/** 入力欄のサイトの指定を削除します。削除の前に確認を表示します。 */
async function onDeleteStopRule() {
  const origin = elements.stopOrigin.value.trim().replace(/\/+$/, '');
  const exists = (await listStopRules()).some((entry) => entry.origin === origin);
  if (!exists) {
    showStopNotice(
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
    showStopNotice(`削除できませんでした。\n${result.errors.join('\n')}`, 'error');
    return;
  }
  editStopRule('', { selectors: [], paths: [] });
  showStopNotice(`${origin} の指定を削除しました。`, 'success');
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
  render().catch(console.error);
}

/** 一覧と編集欄を表示し直します。 */
async function render() {
  const flows = await listFlows();
  elements.empty.hidden = flows.length > 0;
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
    elements.editorHeading.textContent = stored.flow.name;
    elements.editorOrigin.textContent = stored.flow.origin;
  } else {
    delete elements.editor.dataset.id;
  }
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
    const heading = document.createElement('div');
    heading.className = 'list-group-item lm-list-heading';
    heading.textContent = origin;
    const items = (byOrigin.get(origin) ?? []).map((stored) => {
      const detail = document.createElement('div');
      detail.className = 'lm-sub';
      detail.textContent = `手順 ${stored.flow.steps.length} 件`;
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
 * JSON の誤りを、編集欄の上の表示欄に一覧で表示し、編集欄に誤りの印を付けます。
 * JSON の誤りは入力欄の一部を指せないため、入力欄の直下ではなく、編集欄の上にまとめます。
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
