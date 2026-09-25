// フローの管理画面です。保存したフローの JSON の編集、書き出し、削除と、JSON からの追加を行います。
// ビジュアルエディタ（#9）ができるまでは、JSON を直接編集します。

import { deleteFlow, getFlow, listFlows, onFlowsChanged, saveFlow } from '../common/flow-store.js';
import {
  getStopRule,
  listStopRules,
  onStopRulesChanged,
  saveStopRule,
} from '../common/stop-rules-store.js';
import { isWebOrigin, orderFlow, validateFlow } from '../shared/flow.js';
import { parseLines, validateStopRule } from '../shared/stop-rules.js';

const elements = {
  message: byId('message'),
  flows: byId('flows'),
  empty: byId('empty'),
  newFlow: byId('new'),
  editor: byId('editor'),
  editorHeading: byId('editor-heading'),
  json: /** @type {HTMLTextAreaElement} */ (byId('json')),
  save: byId('save'),
  exportFlow: byId('export'),
  deleteFlow: byId('delete'),
  importer: byId('importer'),
  file: /** @type {HTMLInputElement} */ (byId('file')),
  importJson: /** @type {HTMLTextAreaElement} */ (byId('import-json')),
  importFlow: byId('import'),
  stopList: byId('stop-list'),
  stopEmpty: byId('stop-empty'),
  stopForm: /** @type {HTMLFormElement} */ (byId('stop-form')),
  stopOrigin: /** @type {HTMLInputElement} */ (byId('stop-origin')),
  stopOrigins: byId('stop-origins'),
  stopSelectors: /** @type {HTMLTextAreaElement} */ (byId('stop-selectors')),
  stopPaths: /** @type {HTMLTextAreaElement} */ (byId('stop-paths')),
  stopClear: byId('stop-clear'),
};

/** 編集中のフローの id です。URL の # 以降にも書き、再読み込みしても同じフローを開きます。 */
let selectedId = decodeURIComponent(location.hash.slice(1));

elements.newFlow.addEventListener('click', () => {
  select('');
  elements.importer.hidden = false;
});

elements.save.addEventListener('click', async () => {
  const flow = parse(elements.json.value);
  if (!flow) {
    return;
  }
  const result = await saveFlow(flow, selectedId);
  if (!result.ok) {
    showMessage(`形式に誤りがあるため、保存しませんでした。\n${result.errors.join('\n')}`, true);
    return;
  }
  const { name } = /** @type {{ name: string }} */ (flow);
  if (result.name === name) {
    showMessage('保存しました。', false);
    return;
  }
  // 同じサイトに同じ名前のフローがあり、番号を付けて保存した場合は、編集欄の名前も合わせます。
  elements.json.value = JSON.stringify(
    orderFlow(/** @type {import('../shared/flow.js').Flow} */ ({ ...flow, name: result.name })),
    null,
    2,
  );
  showMessage(`同じサイトに「${name}」があるため、「${result.name}」として保存しました。`, false);
});

elements.exportFlow.addEventListener('click', async () => {
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
  const stored = await getFlow(selectedId);
  if (
    !stored ||
    !confirm(`「${stored.flow.name}」を削除します。元に戻せません。よろしいですか？`)
  ) {
    return;
  }
  await deleteFlow(selectedId);
  select('');
  showMessage(`「${stored.flow.name}」を削除しました。`, false);
});

elements.file.addEventListener('change', async () => {
  const file = elements.file.files?.[0];
  if (file) {
    elements.importJson.value = await file.text();
  }
});

elements.importFlow.addEventListener('click', async () => {
  const flow = parse(elements.importJson.value);
  if (!flow) {
    return;
  }
  const errors = validateFlow(flow);
  if (errors.length > 0) {
    showMessage(`形式に誤りがあるため、追加しませんでした。\n${errors.join('\n')}`, true);
    return;
  }
  const { name, origin } = /** @type {{ name: string, origin: string }} */ (flow);
  // 他人から受け取ったフローは、ログイン中のサイトで意図しない操作を行う可能性があります（#14）。
  if (
    !confirm(
      `「${name}」は ${origin} を操作するフローです。\n` +
        '内容を確認し、信頼できるフローだけを追加してください。追加しますか？',
    )
  ) {
    return;
  }
  const result = await saveFlow(flow);
  if (!result.ok) {
    showMessage(result.errors.join('\n'), true);
    return;
  }
  elements.importJson.value = '';
  elements.file.value = '';
  select(result.id);
  showMessage(
    result.name === name
      ? `「${name}」を追加しました。`
      : `同じサイトに「${name}」があるため、「${result.name}」として追加しました。`,
    false,
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
  onSaveStopRule().catch((error) => showMessage(String(error), true));
});

elements.stopClear.addEventListener('click', () => {
  editStopRule('', { selectors: [], paths: [] });
});

onStopRulesChanged(() => {
  renderStopRules().catch(console.error);
});
renderStopRules().catch(console.error);

/** 入力欄の指定を検証し、保存します。 */
async function onSaveStopRule() {
  const origin = elements.stopOrigin.value.trim().replace(/\/+$/, '');
  if (!isWebOrigin(origin)) {
    showMessage(
      'サイトは https:// または http:// で始まるオリジン（例：https://www.amazon.co.jp）で入力してください。',
      true,
    );
    return;
  }
  const rule = {
    selectors: parseLines(elements.stopSelectors.value),
    paths: parseLines(elements.stopPaths.value),
  };
  const errors = [...validateStopRule(rule), ...selectorSyntaxErrors(rule.selectors)];
  if (errors.length > 0) {
    showMessage(`指定に誤りがあるため、保存しませんでした。\n${errors.join('\n')}`, true);
    return;
  }
  const removing = rule.selectors.length === 0 && rule.paths.length === 0;
  if (removing && !confirm(`${origin} の指定を削除します。よろしいですか？`)) {
    return;
  }
  const result = await saveStopRule(origin, rule);
  if (!result.ok) {
    showMessage(`保存できませんでした。\n${result.errors.join('\n')}`, true);
    return;
  }
  elements.stopOrigin.value = origin;
  showMessage(
    removing ? `${origin} の指定を削除しました。` : `${origin} の指定を保存しました。`,
    false,
  );
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
      const button = document.createElement('button');
      button.type = 'button';
      const count = document.createElement('small');
      count.textContent = `要素 ${rule.selectors.length} 件・画面 ${rule.paths.length} 件`;
      button.append(origin, count);
      button.addEventListener('click', () => {
        getStopRule(origin)
          .then((current) => editStopRule(origin, current))
          .catch(console.error);
      });
      const item = document.createElement('li');
      item.append(button);
      return item;
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
  showMessage('', false);
  render().catch(console.error);
}

/** 一覧と編集欄を表示し直します。 */
async function render() {
  const flows = await listFlows();
  elements.empty.hidden = flows.length > 0;
  elements.flows.replaceChildren(
    ...flows.map((stored) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-current', String(stored.id === selectedId));
      const origin = document.createElement('small');
      origin.textContent = stored.flow.origin;
      button.append(stored.flow.name, origin);
      button.addEventListener('click', () => select(stored.id));
      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );

  const stored = selectedId ? await getFlow(selectedId) : undefined;
  elements.editor.hidden = !stored;
  if (stored && elements.editor.dataset.id !== stored.id) {
    // 編集中の内容を上書きしないよう、別のフローを選んだときだけ JSON を入れ替えます。
    elements.editor.dataset.id = stored.id;
    elements.json.value = JSON.stringify(orderFlow(stored.flow), null, 2);
  }
  if (stored) {
    elements.editorHeading.textContent = stored.flow.name;
  } else {
    delete elements.editor.dataset.id;
  }
}

/**
 * JSON を読み取ります。誤りがある場合は、その内容を表示して null を返します。
 * @param {string} text
 * @returns {unknown}
 */
function parse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    showMessage(`JSON として読み取れません：${String(error)}`, true);
    return null;
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
