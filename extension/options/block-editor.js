// フローの詳細の［手順］タブの、ブロックの編集画面です（#9）。
// Blockly（extension/vendor/blockly/）は、options.html で通常のスクリプトとして先に読み込み、
// グローバルの Blockly を使います。ブロックの定義と、手順との変換は extension/shared/blocks.js にあります。

import {
  PICK_FIELDS,
  blockDefinitions,
  conditionUsesValues,
  pickedStep,
  stepsToWorkspace,
  toolbox,
  workspaceToSteps,
} from '../shared/blocks.js';

/** @typedef {import('../shared/flow.js').Step} Step */

/** Blockly には型の定義を同梱していないため、any として扱います。 */
const Blockly = /** @type {any} */ (globalThis).Blockly;

let registered = false;

/**
 * 右クリックのメニューの［ページで選ぶ］を押したときに呼ぶ処理です（#139）。メニューは 1 回だけ登録するため、
 * 編集画面を作るときに差し替えます。
 * @type {(blockId: string, field: 'TARGET' | 'NEXT') => void}
 */
let onPickFromMenu = () => {};

/** 画像と音のファイルの場所です。options.html からの相対パスです。 */
const MEDIA = '../vendor/blockly/media/';

/** ブロックの見た目の名前です。 */
const RENDERER = 'lm';

/** ブロックの定義と、ブロックが使う仕組みを、Blockly に 1 回だけ登録します。 */
function register() {
  if (registered) {
    return;
  }
  registered = true;
  // 元の手順（ブロックに出さない項目を含む）を、ブロックと一緒に保存・複製します。
  Blockly.Extensions.registerMutator('lm_step', {
    /** @this {any} */
    saveExtraState() {
      return this.lmState ?? null;
    },
    /** @this {any} @param {unknown} state */
    loadExtraState(state) {
      this.lmState = state;
    },
  });
  // 条件の種類に合わせて、値の欄を出し分けます。
  Blockly.Extensions.register(
    'lm_condition',
    /** @this {any} */
    function () {
      const block = this;
      /** @param {string} kind */
      const update = (kind) => {
        const uses = conditionUsesValues(kind);
        block.getField('VALUE')?.setVisible(uses.value);
        block.getField('TILDE')?.setVisible(uses.value2);
        block.getField('VALUE2')?.setVisible(uses.value2);
      };
      block.getField('COND').setValidator((/** @type {string} */ kind) => {
        update(kind);
        return kind;
      });
      update(block.getFieldValue('COND'));
    },
  );
  Blockly.defineBlocksWithJsonArray(blockDefinitions());

  // Scratch 風の見た目（zelos）です。選択の欄の「▼」を data: の画像で描く設定を、同梱した画像ファイルに
  // 置き換えます。拡張機能の CSP は data: の画像を許可していないためです。画像は同じ内容です。
  class Constants extends Blockly.zelos.ConstantProvider {
    constructor() {
      super();
      this.FIELD_DROPDOWN_SVG_ARROW_DATAURI = `${MEDIA}dropdown-arrow.svg`;
    }
  }
  class Renderer extends Blockly.zelos.Renderer {
    makeConstants_() {
      return new Constants();
    }
  }
  Blockly.blockRendering.register(RENDERER, Renderer);

  // 右クリックのメニューから、要素の選択モードを始めます（#139）。キーボードの場合は、編集画面の上の
  // ［ページで選ぶ］を使います。
  for (const field of /** @type {const} */ (['TARGET', 'NEXT'])) {
    Blockly.ContextMenuRegistry.registry.register({
      id: `lm_pick_${field}`,
      scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,
      weight: -1,
      displayText: field === 'NEXT' ? '［次へ］のボタンをページで選ぶ' : 'ページで選ぶ',
      /** @param {any} scope */
      preconditionFn(scope) {
        const block = scope.block;
        return !block.isInFlyout && (PICK_FIELDS[block.type] ?? []).includes(field)
          ? 'enabled'
          : 'hidden';
      },
      /** @param {any} scope */
      callback(scope) {
        onPickFromMenu(scope.block.id, field);
      },
    });
  }
}

/**
 * 画面の色（明るい表示・暗い表示）に合わせた Blockly の配色です。色は、画面の CSS の計算結果から取ります。
 * @param {HTMLElement} container
 */
function theme(container) {
  const style = getComputedStyle(container);
  const dark = document.documentElement.dataset.bsTheme === 'dark';
  return Blockly.Theme.defineTheme(dark ? 'lm-dark' : 'lm-light', {
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: style.backgroundColor,
      toolboxBackgroundColour: style.backgroundColor,
      flyoutBackgroundColour: dark ? '#2a2f36' : '#eef1f4',
      flyoutOpacity: 1,
      scrollbarColour: dark ? '#6b7480' : '#9aa3ad',
      insertionMarkerColour: dark ? '#ffffff' : '#000000',
      cursorColour: dark ? '#ffd966' : '#1d5fa6',
    },
    fontStyle: { family: style.fontFamily, weight: '600', size: 12 },
  });
}

/**
 * 要素を選べるブロックの情報です（#139）。
 * @typedef {object} PickInfo
 * @property {string} blockId
 * @property {string} blockType
 * @property {('TARGET' | 'NEXT')[]} fields 選べる欄
 * @property {object[]} chain ブロックを囲む繰り返しの行の指定（外側から順）
 * @property {string} [error] 選べない理由。囲む繰り返しの行をまだ選んでいない場合です
 */

/**
 * ブロックの編集画面を作ります。
 * @param {HTMLElement} container ブロックを表示する要素
 * @param {{
 *   onChange: (dirty: boolean) => void,
 *   onSelect?: (info: PickInfo | null) => void,
 *   onPick?: (blockId: string, field: 'TARGET' | 'NEXT') => void,
 * }} options
 *   onChange：保存していない変更の有無が変わったとき。onSelect：選んだブロックが変わったとき（#139）。
 *   onPick：右クリックのメニューの［ページで選ぶ］を押したとき（#139）
 */
export function createBlockEditor(container, { onChange, onSelect, onPick }) {
  register();
  if (onPick) {
    onPickFromMenu = onPick;
  }
  const workspace = Blockly.inject(container, {
    renderer: RENDERER,
    theme: theme(container),
    toolbox: toolbox(),
    media: MEDIA,
    sounds: false,
    trashcan: true,
    zoom: { controls: true, startScale: 0.75, maxScale: 1.5, minScale: 0.4 },
    move: { scrollbars: true, drag: true, wheel: true },
  });

  let dirty = false;
  let loading = false;
  /** @param {boolean} value */
  const setDirty = (value) => {
    if (dirty !== value) {
      dirty = value;
      onChange(dirty);
    }
  };
  workspace.addChangeListener((/** @type {any} */ event) => {
    if (!loading && !event.isUiEvent) {
      setDirty(true);
    }
    // 選んだブロックが変わったとき、または選んだブロックの位置が変わったときに、選べる要素を知らせます。
    if (event.type === Blockly.Events.SELECTED || event.type === Blockly.Events.BLOCK_MOVE) {
      onSelect?.(pickInfo(Blockly.getSelected()));
    }
  });

  /**
   * ブロックの要素を選べるかと、選ぶときに使う情報を返します（#139）。
   * @param {any} block
   * @returns {PickInfo | null}
   */
  const pickInfo = (block) => {
    const fields = block && !block.isInFlyout ? PICK_FIELDS[block.type] : undefined;
    if (!block || !fields || block.workspace !== workspace) {
      return null;
    }
    // 囲む繰り返しの行の指定を、外側から順に集めます。行の内側の要素（scope: item）を作るのに使います。
    /** @type {object[]} */
    const chain = [];
    let error = '';
    for (let parent = block.getSurroundParent(); parent; parent = parent.getSurroundParent()) {
      if (parent.type === 'lm_forEach' || parent.type === 'lm_forEach_pages') {
        const items = parent.lmState?.step?.items;
        if (items) {
          chain.unshift(items);
        } else {
          error =
            '囲んでいる繰り返しの行をまだ選んでいません。先に繰り返しのブロックで行を選んでください。';
        }
      }
    }
    return { blockId: block.id, blockType: block.type, fields, chain, ...(error ? { error } : {}) };
  };

  // 画面の色が変わったら（OS の設定の切り替え）、Blockly の配色も合わせます。
  new MutationObserver(() => workspace.setTheme(theme(container))).observe(
    document.documentElement,
    { attributes: true, attributeFilter: ['data-bs-theme'] },
  );

  /** 手順の先頭（配置の左上）が、表示欄の左上に見える位置に動かします。 */
  const showStart = () => {
    Blockly.svgResize(workspace);
    const content = workspace.getMetricsManager().getContentMetrics();
    const view = workspace.getMetricsManager().getViewMetrics();
    workspace.scroll(-content.left + 16, -content.top + view.top + 16);
  };

  return {
    /**
     * 手順を表示し直します。保存していない変更は消えます。
     * @param {Step[]} steps
     */
    load(steps) {
      loading = true;
      Blockly.Events.disable();
      try {
        workspace.clear();
        Blockly.serialization.workspaces.load(stepsToWorkspace(steps), workspace);
      } finally {
        Blockly.Events.enable();
        loading = false;
      }
      setDirty(false);
      showStart();
    },

    /**
     * 表示中のブロックから、手順の一覧を作ります。
     * @returns {{ steps: Step[], error?: string }}
     */
    steps() {
      return workspaceToSteps(Blockly.serialization.workspaces.save(workspace));
    },

    /** 保存した後に呼び、保存していない変更がない状態にします。 */
    markSaved() {
      setDirty(false);
    },

    /** 保存していない変更があるかです。 */
    get dirty() {
      return dirty;
    },

    /**
     * ブロックの要素を選べるかと、選ぶときに使う情報を返します（#139）。
     * @param {string} blockId
     * @returns {PickInfo | null}
     */
    pickInfo(blockId) {
      return pickInfo(workspace.getBlockById(blockId));
    },

    /** 選んでいるブロックの情報です。選んでいない場合と、要素を選べないブロックの場合は null です。 */
    selectedPickInfo() {
      return pickInfo(Blockly.getSelected());
    },

    /**
     * ページで選んだ結果をブロックに入れます（#139）。保存は［手順を保存］で行います。
     * @param {string} blockId
     * @param {'TARGET' | 'NEXT'} field
     * @param {{ target?: { label: string }, items?: { label: string } }} result
     * @returns {boolean} ブロックが見つかり、入れられたか
     */
    applyPick(blockId, field, result) {
      const block = workspace.getBlockById(blockId);
      if (!block) {
        return false;
      }
      const step = pickedStep(block.type, block.lmState?.step, field, result);
      block.lmState = { step };
      const label =
        (field === 'TARGET' && result.items ? result.items : result.target)?.label ?? '';
      block.setFieldValue(label, field);
      setDirty(true);
      block.select();
      return true;
    },

    /** 表示の大きさを合わせ直します。隠していた区画を表示したときに呼びます。 */
    resize() {
      Blockly.svgResize(workspace);
    },
  };
}
