// フローの管理画面です。保存したフローの JSON の編集、書き出し、削除と、JSON からの追加を行います。
// ビジュアルエディタ（#9）ができるまでは、JSON を直接編集します。

import { deleteFlow, getFlow, listFlows, onFlowsChanged, saveFlow } from '../common/flow-store.js';
import { orderFlow, validateFlow } from '../shared/flow.js';

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
  showMessage('保存しました。', false);
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
  showMessage(`「${name}」を追加しました。`, false);
});

onFlowsChanged(() => {
  render().catch(console.error);
});
render().catch(console.error);

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
