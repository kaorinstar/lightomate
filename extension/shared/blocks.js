// ブロックの編集画面（#9）で使う、手順とブロックの対応です。
// 手順の一覧（Flow の steps）と、Blockly の配置の保存形式（JSON）を相互に変換します。
// Blockly も chrome.* も使わないため、Node.js の単体テストから読み込めます。
//
// 各ブロックは、元の手順を extraState.step に持ちます。ブロックで編集できる項目（URL、値、秒数など）だけを
// ブロックの欄（fields）に出し、手順に戻すときは、元の手順に欄の値を重ねます。要素の指定（target）など、
// ブロックに出さない項目を失わないためです。入れ子の手順（then、else、steps）は、ブロックの中に入れた
// ブロックの並びから作り直します。

import { DEFAULT_FOREACH_MAX, DEFAULT_MAX_PAGES, DEFAULT_WHILE_MAX } from './control-flow.js';

/** @typedef {import('./flow.js').Step} Step */
/** @typedef {import('./flow.js').Condition} Condition */

/**
 * Blockly の保存形式のブロックです。使う項目だけを定めます。
 * @typedef {object} BlockState
 * @property {string} type
 * @property {string} [id]
 * @property {number} [x]
 * @property {number} [y]
 * @property {{ step?: Record<string, unknown> }} [extraState]
 * @property {Record<string, unknown>} [fields]
 * @property {Record<string, { block?: BlockState }>} [inputs]
 * @property {{ block?: BlockState }} [next]
 */

/**
 * Blockly の保存形式の配置です。
 * @typedef {{ blocks?: { languageVersion?: number, blocks?: BlockState[] } }} WorkspaceState
 */

/**
 * ブロックの色です。手順の種類のまとまりごとに分けます。白い文字に対して 4.5:1 以上の濃さにします
 * （WCAG 2.2 の 1.4.3。docs/design-guidelines.md の「ブロックの色」）。
 */
export const BLOCK_COLOURS = {
  page: '#1d5fa6',
  action: '#6a3fb0',
  output: '#0f6b64',
  wait: '#7a5500',
  control: '#a2470d',
};

/** 条件の種類です。if と while の「条件」の欄の選択肢の値です。 */
export const CONDITION_KINDS = /** @type {const} */ ([
  'exists',
  'notExists',
  'contains',
  'equals',
  'month',
  'range',
]);

/** @type {Record<(typeof CONDITION_KINDS)[number], string>} */
const CONDITION_LABELS = {
  exists: 'がある',
  notExists: 'がない',
  contains: 'の文字が次を含む',
  equals: 'の文字が次と同じ',
  month: 'の日付が次の月',
  range: 'の日付が次の期間',
};

/** 条件の欄です。if と while で同じものを使います。 */
const CONDITION_ARGS = [
  { type: 'field_label_serializable', name: 'TARGET', text: '' },
  {
    type: 'field_dropdown',
    name: 'COND',
    options: CONDITION_KINDS.map((kind) => [CONDITION_LABELS[kind], kind]),
  },
  { type: 'field_input', name: 'VALUE', text: '' },
  { type: 'field_label', name: 'TILDE', text: '〜' },
  { type: 'field_input', name: 'VALUE2', text: '' },
];

/**
 * ブロックの定義です（Blockly の JSON 形式）。type は、手順の type に lm_ を付けたものです。
 * 入力欄の値を持たない入力（secret）と、ページ送りのある繰り返しは、欄が異なるため別の種類にします。
 * mutator の lm_step は、元の手順（extraState）を保存するための仕組みで、画面側で登録します。
 * extensions の lm_condition は、条件の種類に合わせて値の欄を出し分ける仕組みで、画面側で登録します。
 * @returns {object[]}
 */
export function blockDefinitions() {
  const statement = { previousStatement: null, nextStatement: null, mutator: 'lm_step' };
  return [
    {
      type: 'lm_navigate',
      message0: 'ページを開く %1',
      args0: [{ type: 'field_input', name: 'URL', text: 'https://' }],
      colour: BLOCK_COLOURS.page,
      ...statement,
    },
    {
      type: 'lm_closeTab',
      message0: 'タブを閉じて元のタブに戻る',
      colour: BLOCK_COLOURS.page,
      ...statement,
    },
    {
      type: 'lm_click',
      message0: 'クリック：%1',
      args0: [{ type: 'field_label_serializable', name: 'TARGET', text: '' }],
      message1: '新しいタブで開く %1 ダウンロードの保存先 %2',
      args1: [
        { type: 'field_checkbox', name: 'NEW_TAB', checked: false },
        { type: 'field_input', name: 'DOWNLOAD', text: '' },
      ],
      colour: BLOCK_COLOURS.action,
      ...statement,
    },
    {
      type: 'lm_input',
      message0: '入力：%1 に %2',
      args0: [
        { type: 'field_label_serializable', name: 'TARGET', text: '' },
        { type: 'field_input', name: 'VALUE', text: '' },
      ],
      colour: BLOCK_COLOURS.action,
      ...statement,
    },
    {
      type: 'lm_input_secret',
      message0: '入力：%1 に（実行のたびに入力）',
      args0: [{ type: 'field_label_serializable', name: 'TARGET', text: '' }],
      colour: BLOCK_COLOURS.action,
      ...statement,
    },
    {
      type: 'lm_select',
      message0: '選択：%1 で %2',
      args0: [
        { type: 'field_label_serializable', name: 'TARGET', text: '' },
        { type: 'field_label_serializable', name: 'LABELS', text: '' },
      ],
      colour: BLOCK_COLOURS.action,
      ...statement,
    },
    {
      type: 'lm_extract',
      message0: '読み取り：%1 を %2 として覚える',
      args0: [
        { type: 'field_label_serializable', name: 'TARGET', text: '' },
        { type: 'field_input', name: 'NAME', text: '' },
      ],
      colour: BLOCK_COLOURS.output,
      ...statement,
    },
    {
      type: 'lm_savePdf',
      message0: 'PDF を保存 %1',
      args0: [{ type: 'field_input', name: 'PATH', text: '' }],
      colour: BLOCK_COLOURS.output,
      ...statement,
    },
    {
      type: 'lm_wait',
      message0: '%1 秒待つ',
      args0: [
        { type: 'field_number', name: 'SECONDS', value: 1, min: 0.001, max: 300, precision: 0.001 },
      ],
      colour: BLOCK_COLOURS.wait,
      ...statement,
    },
    {
      type: 'lm_pause',
      message0: '一時停止（人が操作する） %1',
      args0: [{ type: 'field_input', name: 'NOTE', text: '' }],
      colour: BLOCK_COLOURS.wait,
      ...statement,
    },
    {
      type: 'lm_if',
      message0: 'もし %1 %2 %3 %4 %5 なら',
      args0: CONDITION_ARGS,
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'THEN' }],
      message2: 'そうでなければ',
      message3: '%1',
      args3: [{ type: 'input_statement', name: 'ELSE' }],
      colour: BLOCK_COLOURS.control,
      extensions: ['lm_condition'],
      ...statement,
    },
    {
      type: 'lm_while',
      // 1 行が長いと、ブロックの一覧の幅が広がり、ブロックを置く面が狭くなるため、2 行に分けます（#139）。
      message0: '%1 %2 %3 %4 %5 の間',
      args0: CONDITION_ARGS,
      message1: '繰り返す（上限 %1 回）',
      args1: [
        {
          type: 'field_number',
          name: 'MAX',
          value: DEFAULT_WHILE_MAX,
          min: 1,
          max: 1000,
          precision: 1,
        },
      ],
      message2: '%1',
      args2: [{ type: 'input_statement', name: 'STEPS' }],
      colour: BLOCK_COLOURS.control,
      extensions: ['lm_condition'],
      ...statement,
    },
    {
      type: 'lm_forEach',
      message0: '%1 の各行で繰り返す（上限 %2 件）',
      args0: [
        { type: 'field_label_serializable', name: 'TARGET', text: '' },
        {
          type: 'field_number',
          name: 'MAX',
          value: DEFAULT_FOREACH_MAX,
          min: 1,
          max: 500,
          precision: 1,
        },
      ],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'STEPS' }],
      colour: BLOCK_COLOURS.control,
      ...statement,
    },
    {
      type: 'lm_forEach_pages',
      // ページ送りのない繰り返しと、1 行目から見分けられる文にします（#139）。一覧で取り違えやすいためです。
      // 1 行が長いと、ブロックの一覧の幅が広がり、ブロックを置く面が狭くなるため、欄を 3 行に分けます。
      message0: '%1 の各行で繰り返し、次のページへ進む',
      args0: [{ type: 'field_label_serializable', name: 'TARGET', text: '' }],
      message1: '上限 %1 件、%2 ページまで',
      args1: [
        {
          type: 'field_number',
          name: 'MAX',
          value: DEFAULT_FOREACH_MAX,
          min: 1,
          max: 500,
          precision: 1,
        },
        {
          type: 'field_number',
          name: 'MAX_PAGES',
          value: DEFAULT_MAX_PAGES,
          min: 1,
          max: 50,
          precision: 1,
        },
      ],
      message2: '次のページへ進むボタン：%1',
      args2: [{ type: 'field_label_serializable', name: 'NEXT', text: '' }],
      message3: '%1',
      args3: [{ type: 'input_statement', name: 'STEPS' }],
      colour: BLOCK_COLOURS.control,
      ...statement,
    },
  ];
}

/** 要素をまだ選んでいない欄に出す文です（#139）。 */
export const NOT_PICKED = '（ページで選ぶ）';

/**
 * 要素の指定を持つブロックの種類と、その欄です（#139）。TARGET は手順の要素（繰り返しでは行）、NEXT は
 * ページ送りの［次へ］のボタンです。
 * @type {Record<string, ('TARGET' | 'NEXT')[]>}
 */
export const PICK_FIELDS = {
  lm_click: ['TARGET'],
  lm_input: ['TARGET'],
  lm_input_secret: ['TARGET'],
  lm_select: ['TARGET'],
  lm_extract: ['TARGET'],
  lm_if: ['TARGET'],
  lm_while: ['TARGET'],
  lm_forEach: ['TARGET'],
  lm_forEach_pages: ['TARGET', 'NEXT'],
};

/**
 * ブロックの一覧（ツールボックス）に出すブロックです。
 * 要素の指定を必要とするブロックは、要素をまだ選んでいない状態で出します。置いた後に［ページで選ぶ］で
 * 要素を選びます（#139）。選択の欄（lm_select）は、選ぶ値を記録からしか作れないため出しません。
 * @returns {{ kind: 'flyoutToolbox', contents: object[] }}
 */
export function toolbox() {
  /** @type {Step[]} */
  const steps = [
    { type: 'navigate', cause: 'user', url: 'https://' },
    { type: 'wait', ms: 1000 },
    { type: 'pause' },
    { type: 'savePdf' },
    { type: 'closeTab' },
  ];
  /** @type {object[]} */
  const picked = [
    { type: 'lm_click', fields: { TARGET: NOT_PICKED } },
    { type: 'lm_input', fields: { TARGET: NOT_PICKED, VALUE: '' } },
    { type: 'lm_input_secret', fields: { TARGET: NOT_PICKED } },
    { type: 'lm_extract', fields: { TARGET: NOT_PICKED, NAME: 'value' } },
    { type: 'lm_if', fields: { TARGET: NOT_PICKED, COND: 'exists', VALUE: '', VALUE2: '' } },
    { type: 'lm_forEach', fields: { TARGET: NOT_PICKED, MAX: DEFAULT_FOREACH_MAX } },
    {
      type: 'lm_forEach_pages',
      fields: {
        TARGET: NOT_PICKED,
        MAX: DEFAULT_FOREACH_MAX,
        MAX_PAGES: DEFAULT_MAX_PAGES,
        NEXT: NOT_PICKED,
      },
    },
    {
      type: 'lm_while',
      fields: { TARGET: NOT_PICKED, COND: 'exists', VALUE: '', VALUE2: '', MAX: DEFAULT_WHILE_MAX },
    },
  ];
  return {
    kind: 'flyoutToolbox',
    contents: [
      ...steps.map((step) => ({ kind: 'block', ...stepToBlock(step) })),
      ...picked.map((block) => ({ kind: 'block', ...block })),
    ],
  };
}

/**
 * ページで選んだ結果を、ブロックの元の手順に入れます（#139）。元の手順は変更しません。
 * @param {string} blockType ブロックの種類（例：lm_click）
 * @param {Record<string, any> | undefined} step ブロックの元の手順。一覧から置いた直後のブロックにはありません
 * @param {'TARGET' | 'NEXT'} field 選んだ欄
 * @param {{ target?: object, items?: object }} result ページで選んだ要素の指定
 * @returns {Record<string, any>}
 */
export function pickedStep(blockType, step, field, result) {
  const type = stepTypeOf(blockType);
  /** @type {Record<string, any>} */
  const next = structuredClone(step ?? { type });
  if (field === 'NEXT') {
    next.nextPage = result.target;
  } else if (type === 'forEach') {
    next.items = result.items;
  } else if (type === 'if' || type === 'while') {
    next.condition = { ...(next.condition ?? { exists: true }), target: result.target };
  } else {
    next.target = result.target;
  }
  if (blockType === 'lm_input_secret') {
    next.secret = true;
  }
  return next;
}

/**
 * ブロックの種類から、手順の種類を返します。例：lm_forEach_pages → forEach
 * @param {string} blockType
 * @returns {string}
 */
function stepTypeOf(blockType) {
  return blockType.replace(/^lm_/, '').replace(/_(secret|pages)$/, '');
}

/**
 * 要素をまだ選んでいないブロックがあれば、その説明を返します（#139）。すべて選んでいれば空の文字列です。
 * 保存の前の検証（validateFlow）の誤りの文より先に、直し方を示すためです。
 * @param {BlockState[]} blocks 最上位のブロック
 * @returns {string}
 */
function unpickedMessage(blocks) {
  /** @type {BlockState[]} */
  const queue = [...blocks];
  while (queue.length > 0) {
    const block = /** @type {BlockState} */ (queue.shift());
    const step = /** @type {Record<string, any>} */ (block.extraState?.step ?? {});
    const fields = PICK_FIELDS[block.type] ?? [];
    const type = stepTypeOf(block.type);
    const hasTarget =
      type === 'forEach'
        ? Boolean(step.items)
        : type === 'if' || type === 'while'
          ? Boolean(step.condition?.target)
          : Boolean(step.target);
    if ((fields.includes('TARGET') && !hasTarget) || (fields.includes('NEXT') && !step.nextPage)) {
      return `要素をまだ選んでいないブロック（${NOT_PICKED}）があります。そのブロックを右クリックし、［ページで選ぶ］を押してください。`;
    }
    for (const input of Object.values(block.inputs ?? {})) {
      if (input.block) {
        queue.push(input.block);
      }
    }
    if (block.next?.block) {
      queue.push(block.next.block);
    }
  }
  return '';
}

/**
 * 手順の一覧を、Blockly の配置の保存形式にします。手順は 1 つの縦の並びにします。
 * @param {Step[]} steps
 * @returns {WorkspaceState}
 */
export function stepsToWorkspace(steps) {
  const first = chain(steps);
  return {
    blocks: { languageVersion: 0, blocks: first ? [{ ...first, x: 16, y: 16 }] : [] },
  };
}

/**
 * 手順の並びを、next でつないだブロックにします。
 * @param {Step[]} steps
 * @returns {BlockState | undefined}
 */
function chain(steps) {
  /** @type {BlockState | undefined} */
  let next;
  for (const step of [...steps].reverse()) {
    const block = stepToBlock(step);
    if (next) {
      block.next = { block: next };
    }
    next = block;
  }
  return next;
}

/**
 * 手順 1 つをブロックにします。
 * @param {Step} step
 * @returns {BlockState}
 */
export function stepToBlock(step) {
  const {
    then: thenSteps,
    else: elseSteps,
    steps: innerSteps,
    ...rest
  } = /** @type {any} */ (step);
  /** @type {BlockState} */
  const block = { type: blockType(step), extraState: { step: rest }, fields: stepFields(step) };
  /** @type {Record<string, { block?: BlockState }>} */
  const inputs = {};
  /** @type {[string, Step[] | undefined][]} */
  const nested = [
    ['THEN', thenSteps],
    ['ELSE', elseSteps],
    ['STEPS', innerSteps],
  ];
  for (const [name, list] of nested) {
    const first = list ? chain(list) : undefined;
    if (first) {
      inputs[name] = { block: first };
    }
  }
  if (Object.keys(inputs).length > 0) {
    block.inputs = inputs;
  }
  // 空の else があったか（else: []）を、手順に戻すときに区別できるよう、元の手順に残します。
  if (elseSteps !== undefined) {
    /** @type {any} */ (block.extraState).step.else = [];
  }
  return block;
}

/**
 * 手順に対応するブロックの種類です。
 * @param {Step} step
 * @returns {string}
 */
function blockType(step) {
  if (step.type === 'input' && step.secret) {
    return 'lm_input_secret';
  }
  if (step.type === 'forEach' && step.nextPage) {
    return 'lm_forEach_pages';
  }
  return `lm_${step.type}`;
}

/**
 * 手順のうち、ブロックの欄に出す値です。
 * @param {Step} step
 * @returns {Record<string, string | number | boolean>}
 */
function stepFields(step) {
  switch (step.type) {
    case 'navigate':
      return { URL: step.url };
    case 'click':
      return {
        TARGET: step.target.label,
        NEW_TAB: step.newTab === true,
        DOWNLOAD: step.download?.path ?? '',
      };
    case 'input':
      return step.secret
        ? { TARGET: step.target.label }
        : { TARGET: step.target.label, VALUE: step.value ?? '' };
    case 'select':
      return { TARGET: step.target.label, LABELS: step.labels.join('、') };
    case 'extract':
      return { TARGET: step.target.label, NAME: step.name };
    case 'savePdf':
      return { PATH: step.path ?? '' };
    case 'wait':
      return { SECONDS: step.ms / 1000 };
    case 'pause':
      return { NOTE: step.note ?? '' };
    case 'closeTab':
      return {};
    case 'if':
      return conditionFields(step.condition);
    case 'while':
      return { ...conditionFields(step.condition), MAX: step.max ?? DEFAULT_WHILE_MAX };
    case 'forEach':
      return step.nextPage
        ? {
            TARGET: step.items.label,
            MAX: step.max ?? DEFAULT_FOREACH_MAX,
            MAX_PAGES: step.maxPages ?? DEFAULT_MAX_PAGES,
            NEXT: step.nextPage.label,
          }
        : { TARGET: step.items.label, MAX: step.max ?? DEFAULT_FOREACH_MAX };
  }
}

/**
 * 条件を、ブロックの欄の値にします。
 * @param {Condition} condition
 * @returns {Record<string, string>}
 */
function conditionFields(condition) {
  const target = condition.target.label;
  if ('exists' in condition) {
    return {
      TARGET: target,
      COND: condition.exists ? 'exists' : 'notExists',
      VALUE: '',
      VALUE2: '',
    };
  }
  if ('contains' in condition) {
    return { TARGET: target, COND: 'contains', VALUE: condition.contains, VALUE2: '' };
  }
  if ('equals' in condition) {
    return { TARGET: target, COND: 'equals', VALUE: condition.equals, VALUE2: '' };
  }
  if ('month' in condition) {
    return { TARGET: target, COND: 'month', VALUE: condition.month, VALUE2: '' };
  }
  return { TARGET: target, COND: 'range', VALUE: condition.from ?? '', VALUE2: condition.to ?? '' };
}

/**
 * Blockly の配置の保存形式を、手順の一覧に戻します。
 * ブロックは 1 つの縦の並びにつながっている必要があります。つながっていないブロックがある場合は、
 * 手順を作らず、誤りを返します。どの順で実行するかが決まらないためです。
 * @param {WorkspaceState} state
 * @returns {{ steps: Step[], error?: string }}
 */
export function workspaceToSteps(state) {
  const tops = state.blocks?.blocks ?? [];
  if (tops.length > 1) {
    return {
      steps: [],
      error:
        'つながっていないブロックがあります。すべてのブロックを 1 つの並びにつなげるか、使わないブロックを削除してください。',
    };
  }
  const unpicked = unpickedMessage(tops);
  if (unpicked) {
    return { steps: [], error: unpicked };
  }
  return { steps: tops[0] ? unchain(tops[0]) : [] };
}

/**
 * next でつないだブロックを、手順の並びに戻します。
 * @param {BlockState} first
 * @returns {Step[]}
 */
function unchain(first) {
  /** @type {Step[]} */
  const steps = [];
  /** @type {BlockState | undefined} */
  let block = first;
  while (block) {
    steps.push(blockToStep(block));
    block = block.next?.block;
  }
  return steps;
}

/**
 * ブロック 1 つを手順に戻します。元の手順に、欄の値と中に入れたブロックを重ねます。
 * @param {BlockState} block
 * @returns {Step}
 */
export function blockToStep(block) {
  const type = stepTypeOf(block.type);
  /** @type {Record<string, any>} */
  const step = structuredClone(block.extraState?.step ?? { type });
  step.type = type;
  if (block.type === 'lm_input_secret') {
    step.secret = true;
  }
  const fields = block.fields ?? {};
  const text = (/** @type {string} */ name) => String(fields[name] ?? '');
  /** @param {string} name */
  const inner = (name) => {
    const first = block.inputs?.[name]?.block;
    return first ? unchain(first) : [];
  };

  switch (type) {
    case 'navigate':
      step.url = text('URL');
      break;
    case 'click':
      setOrDelete(
        step,
        'newTab',
        fields.NEW_TAB === true || fields.NEW_TAB === 'TRUE' ? true : undefined,
      );
      setOrDelete(
        step,
        'download',
        text('DOWNLOAD') ? { ...(step.download ?? {}), path: text('DOWNLOAD') } : undefined,
      );
      break;
    case 'input':
      if (!step.secret) {
        step.value = text('VALUE');
      }
      break;
    case 'extract':
      step.name = text('NAME');
      break;
    case 'savePdf':
      setOrDelete(step, 'path', text('PATH') || undefined);
      break;
    case 'wait':
      step.ms = Math.round(Number(fields.SECONDS ?? 1) * 1000);
      break;
    case 'pause':
      setOrDelete(step, 'note', text('NOTE') || undefined);
      break;
    case 'if': {
      step.condition = conditionFromFields(step.condition, fields);
      step.then = inner('THEN');
      const elseSteps = inner('ELSE');
      setOrDelete(step, 'else', elseSteps.length > 0 || step.else ? elseSteps : undefined);
      break;
    }
    case 'while':
      step.condition = conditionFromFields(step.condition, fields);
      setOrDelete(step, 'max', keepDefault(step.max, fields.MAX, DEFAULT_WHILE_MAX));
      step.steps = inner('STEPS');
      break;
    case 'forEach':
      setOrDelete(step, 'max', keepDefault(step.max, fields.MAX, DEFAULT_FOREACH_MAX));
      if (step.nextPage) {
        setOrDelete(
          step,
          'maxPages',
          keepDefault(step.maxPages, fields.MAX_PAGES, DEFAULT_MAX_PAGES),
        );
      }
      step.steps = inner('STEPS');
      break;
  }
  return /** @type {Step} */ (step);
}

/**
 * 省略できる数値の項目の値です。元の手順で省略していて、欄の値が既定値のままなら、省略したままにします。
 * @param {number | undefined} original
 * @param {unknown} field
 * @param {number} fallback
 * @returns {number | undefined}
 */
function keepDefault(original, field, fallback) {
  const value = field === undefined ? (original ?? fallback) : Number(field);
  return original === undefined && value === fallback ? undefined : value;
}

/**
 * 条件の欄の値から、条件を作り直します。調べる要素（target）は元の条件のものを使います。
 * @param {Condition | undefined} original 一覧から置いた直後のブロックにはありません
 * @param {Record<string, unknown>} fields
 * @returns {Condition}
 */
function conditionFromFields(original, fields) {
  const target = /** @type {Condition} */ (original)?.target;
  const value = String(fields.VALUE ?? '');
  const value2 = String(fields.VALUE2 ?? '');
  switch (fields.COND) {
    case 'exists':
      return { target, exists: true };
    case 'notExists':
      return { target, exists: false };
    case 'contains':
      return { target, contains: value };
    case 'equals':
      return { target, equals: value };
    case 'month':
      return { target, month: value };
    case 'range':
      return /** @type {Condition} */ ({
        target,
        ...(value ? { from: value } : {}),
        ...(value2 ? { to: value2 } : {}),
      });
    default:
      return original ?? /** @type {Condition} */ ({ target, exists: true });
  }
}

/**
 * 値が undefined なら項目を削除し、そうでなければ設定します。
 * @param {Record<string, unknown>} object
 * @param {string} key
 * @param {unknown} value
 */
function setOrDelete(object, key, value) {
  if (value === undefined) {
    delete object[key];
  } else {
    object[key] = value;
  }
}

/**
 * 条件の種類ごとに、値の欄を使うかです。画面で、使わない欄を隠すために使います。
 * @param {string} kind
 * @returns {{ value: boolean, value2: boolean }}
 */
export function conditionUsesValues(kind) {
  return {
    value: kind !== 'exists' && kind !== 'notExists',
    value2: kind === 'range',
  };
}
