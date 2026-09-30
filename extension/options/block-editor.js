// フローの詳細の［手順］タブの、ブロックの編集画面です（#9）。
// Blockly（extension/vendor/blockly/）は、options.html で通常のスクリプトとして先に読み込み、
// グローバルの Blockly を使います。ブロックの定義と、手順との変換は extension/shared/blocks.js にあります。

import {
  blockDefinitions,
  conditionUsesValues,
  stepsToWorkspace,
  toolbox,
  workspaceToSteps,
} from '../shared/blocks.js';

/** @typedef {import('../shared/flow.js').Step} Step */

/** Blockly には型の定義を同梱していないため、any として扱います。 */
const Blockly = /** @type {any} */ (globalThis).Blockly;

let registered = false;

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
 * ブロックの編集画面を作ります。
 * @param {HTMLElement} container ブロックを表示する要素
 * @param {{ onChange: (dirty: boolean) => void }} options onChange：保存していない変更の有無が変わったとき
 */
export function createBlockEditor(container, { onChange }) {
  register();
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
  });

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

    /** 表示の大きさを合わせ直します。隠していた区画を表示したときに呼びます。 */
    resize() {
      Blockly.svgResize(workspace);
    },
  };
}
