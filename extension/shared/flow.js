// フロー定義（JSON）の型と検証です。形式の説明は docs/flow-format.md にあります。
//
// ES モジュールのため、Service Worker と拡張機能の画面からは読み込めますが、content script からは
// 読み込めません。content script から ES モジュールを読み込むには web_accessible_resources の宣言が
// 必要になり、ページから拡張機能の有無を検出できるようになるためです。検証は Service Worker で行います。

import {
  PARAM_NAME_PATTERN,
  validateParams,
  validateReferences,
  withPlaceholders,
} from './params.js';
import { RESERVED_NAMES, nonBuiltinReferences, validateSaveTemplate } from './save-path.js';
import { validateInterval, validateWaitMs } from './speed.js';
import {
  CONTROL_STEP_TYPES,
  FOREACH_MAX_LIMIT,
  MAX_NESTING,
  MAX_PAGES_LIMIT,
} from './control-flow.js';

/** 現在のフロー定義の形式の版番号です。形式を変えるときに 1 増やします。 */
export const SCHEMA_VERSION = 7;

/**
 * 読み込める版番号です。版 2 は、版 1 に一時停止の手順（pause）を加えたものです。
 * 版 3 は、版 2 に PDF の保存（savePdf）とページの文字の読み取り（extract）を加えたものです（#16）。
 * 版 4 は、版 3 に手順の間隔（interval）と待機の手順（wait）を加えたものです（#15）。
 * 版 5 は、版 4 に追加のサイトの一覧（extraOrigins）と、手順を記録したサイト（手順の origin）を
 * 加えたものです（#41）。
 * 版 6 は、版 5 に条件分岐（if）と繰り返し（forEach）、行の内側で要素を探す指定（target の scope）を
 * 加えたものです（#6）。
 * 版 7 は、版 6 に forEach のページ送り（nextPage、maxPages）と、forEach の内側のページの操作による
 * 移動（navigate、cause が page）を加えたものです（#95）。
 * 古い版のフローは、変換せずにそのまま新しい版として扱えます。
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4, 5, 6, 7];

/**
 * 手順の種類ごとの、使える最も古い版です。これより古い版のフローには書けません。
 * @type {Record<string, number>}
 */
const MIN_SCHEMA_VERSION = { pause: 2, savePdf: 3, extract: 3, wait: 4, if: 6, forEach: 6 };

/** interval を使える最も古い版です。 */
const INTERVAL_MIN_SCHEMA_VERSION = 4;

/** extraOrigins と手順の origin を使える最も古い版です（#41）。 */
const ORIGINS_MIN_SCHEMA_VERSION = 5;

/** target の scope を使える最も古い版です（#6）。 */
const SCOPE_MIN_SCHEMA_VERSION = 6;

/** forEach の nextPage と maxPages、forEach の内側の navigate を使える最も古い版です（#95）。 */
const LOOP_NAVIGATION_MIN_SCHEMA_VERSION = 7;

/**
 * 追加のサイト（extraOrigins）の件数の上限です（#41）。記録中は確認を出さずに加えるため、
 * 多くのサブドメインを通るサイト（楽天市場など）も収まる件数にします。
 */
export const MAX_EXTRA_ORIGINS = 10;

/** 手順を記録したサイト（origin）を持てる手順の種類です。ページを操作する手順です（#41）。 */
export const PAGE_STEP_TYPES = ['click', 'input', 'select', 'extract'];

/**
 * 1 つのフローに含められる手順の数の上限です。保存領域を使い切ることを防ぎます。
 * if と forEach の内側の手順も数えます（#6）。
 */
export const MAX_STEPS = 1000;

/** 文字列の項目の長さの上限です。 */
export const MAX_TEXT_LENGTH = 2000;

/**
 * 操作した要素を、後で再び見つけるための指定です。
 * @typedef {object} Target
 * @property {string[]} selectors CSS セレクター。優先する順に並べます。1 つ以上あります。
 * @property {string} tag 要素のタグ名（小文字）
 * @property {string} label 人が読むための説明（ボタンの表示文字列など）
 * @property {string} [text] 要素の表示文字列。セレクターで見つからない場合の手がかりに使います。
 * @property {'item'} [scope] item の場合は、ページ全体ではなく、forEach で処理中の行の内側だけで
 *   要素を探します（#6）。forEach の内側の手順にだけ書けます。版 6 で加えました。
 */

/**
 * ページの移動です。
 * @typedef {object} NavigateStep
 * @property {'navigate'} type
 * @property {string} url 移動先の URL
 * @property {'user' | 'page'} cause 利用者の操作（URL の入力、再読み込み、戻る）による移動か、
 *   ページの操作（リンク、フォームの送信、転送）による移動か
 */

/**
 * クリックです。
 * @typedef {object} ClickStep
 * @property {'click'} type
 * @property {Target} target
 * @property {string} [origin] 手順を記録したサイト。省略した場合はフローの origin です（#41）
 */

/**
 * 文字の入力です。secret が true の場合、値は記録しません。
 * @typedef {object} InputStep
 * @property {'input'} type
 * @property {Target} target
 * @property {string} [value] 入力した値
 * @property {true} [secret] パスワードなど、値を記録しない入力欄であること
 * @property {string} [origin] 手順を記録したサイト。省略した場合はフローの origin です（#41）
 */

/**
 * 選択肢の選択（select 要素）です。
 * @typedef {object} SelectStep
 * @property {'select'} type
 * @property {Target} target
 * @property {string[]} values 選んだ選択肢の value
 * @property {string[]} labels 選んだ選択肢の表示文字列
 * @property {string} [origin] 手順を記録したサイト。省略した場合はフローの origin です（#41）
 */

/**
 * 一時停止です。実行はこの手順で終了し、以降の操作は人が行います（#29）。版 2 で加えました。
 * @typedef {object} PauseStep
 * @property {'pause'} type
 * @property {string} [note] 止まる理由の説明
 */

/**
 * 表示中のページを PDF として保存します（#16）。版 3 で加えました。
 * @typedef {object} SavePdfStep
 * @property {'savePdf'} type
 * @property {string} [path] 保存先のひな形。ダウンロード先フォルダーからの相対パスです。
 *   省略した場合は save-path.js の DEFAULT_SAVE_PATH を使います。
 * @property {'rename' | 'overwrite'} [onConflict] 同じ名前のファイルがある場合の動作。
 *   rename（既定）は番号を付けて別名で保存し、overwrite は上書きします。
 * @property {'print' | 'screen'} [mode] PDF を作るときの表示。print（既定）は印刷用の表示、
 *   screen は画面の表示で作ります（#73）。
 */

/**
 * 指定した要素の文字を読み取り、名前を付けて覚えます（#16）。版 3 で加えました。
 * 読み取った値は、後の手順の savePdf の path で {{名前}} として使えます。保存はしません。
 * @typedef {object} ExtractStep
 * @property {'extract'} type
 * @property {Target} target
 * @property {string} name 読み取った値に付ける名前
 * @property {string} [origin] 手順を記録したサイト。省略した場合はフローの origin です（#41）
 */

/**
 * 指定した時間だけ待ちます（#15）。版 4 で加えました。
 * @typedef {object} WaitStep
 * @property {'wait'} type
 * @property {number} ms 待つ時間（ミリ秒）。1 以上 300,000 以下の整数です
 */

/**
 * 条件分岐です（#6）。要素があるか（ないか）で、行う手順を分けます。版 6 で加えました。
 * @typedef {object} IfStep
 * @property {'if'} type
 * @property {{ target: Target, exists: boolean }} condition 条件。exists が true の場合は要素がある
 *   ことを、false の場合は要素がないことを条件にします
 * @property {Step[]} then 条件を満たす場合に行う手順
 * @property {Step[]} [else] 条件を満たさない場合に行う手順
 */

/**
 * 繰り返しです（#6）。一覧の各行で、同じ手順を行います。版 6 で加えました。
 * 版 7 で、内側でのページの操作による移動と、ページ送り（nextPage、maxPages）を加えました（#95）。
 * @typedef {object} ForEachStep
 * @property {'forEach'} type
 * @property {Target} items 一覧の各行を指す指定。selectors は、すべての行に一致するセレクターです
 * @property {number} [max] 繰り返しの上限。行がこれより多い場合は、繰り返しを始めずに止めます。
 *   ページ送りを使う場合は、全ページの行の合計の上限です。
 *   省略した場合は control-flow.js の DEFAULT_FOREACH_MAX です
 * @property {Target} [nextPage] 次のページへ送る要素（「次へ」のボタンなど）の指定。ページの行をすべて処理した後にクリックし、
 *   次のページの行を続けて処理します。見つからない場合は繰り返しを終えます
 * @property {number} [maxPages] ページ送りの上限。省略した場合は control-flow.js の DEFAULT_MAX_PAGES です
 * @property {Step[]} steps 各行で行う手順
 */

/**
 * @typedef {NavigateStep | ClickStep | InputStep | SelectStep | PauseStep | SavePdfStep | ExtractStep | WaitStep | IfStep | ForEachStep} Step
 */

/** @typedef {import('./params.js').Param} Param */

/**
 * フロー定義です。
 * @typedef {object} Flow
 * @property {number} schemaVersion 形式の版番号
 * @property {string} name フロー名
 * @property {string} origin 記録を始めたサイトのオリジン（例：https://www.amazon.co.jp）。
 *   実行時は、手順を記録したサイトのページでだけ手順を実行します。
 * @property {string[]} [extraOrigins] 記録を始めたサイトのほかに、手順を記録したサイトの一覧です（#41）。
 *   ログイン画面などが別のサブドメインや別のサイトにある場合に使います。版 5 で加えました。
 * @property {Param[]} [params] パラメータ（実行のたびに入力する値）の定義
 * @property {import('./speed.js').Interval} [interval] 手順と手順の間に待つ時間の範囲（ミリ秒、#15）。
 *   省略した場合は speed.js の DEFAULT_INTERVAL です。版 4 で加えました。
 * @property {Step[]} steps 手順の一覧
 */

/**
 * 編集中の JSON の文字列のうち、フローの名前（最上位の "name"）だけを書き換えます（#53）。
 * 名前の変更で、保存していない JSON の編集内容を失わないようにするためです。
 * JSON として読み取れない場合と、最上位がオブジェクトでない場合は、書き換えずに null を返します。
 * 書き換えた場合は、字下げ 2 文字で整形し直します。項目の順序は変えません。
 * @param {string} text
 * @param {string} name
 * @returns {string | null}
 */
export function replaceJsonName(text, name) {
  return replaceJsonFields(text, { name });
}

/**
 * 編集中の JSON の文字列のうち、指定した最上位の項目だけを書き換えます（#53、#15）。
 * 値が undefined の項目は削除します。そのほかの扱いは replaceJsonName と同じです。
 * @param {string} text
 * @param {Record<string, unknown>} fields
 * @returns {string | null}
 */
export function replaceJsonFields(text, fields) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  return JSON.stringify({ ...value, ...fields }, null, 2);
}

/**
 * 手順の間隔（interval）を変えたフローを返します（#15）。元のフローは変更しません。
 * interval に undefined を渡すと削除し、既定の間隔に戻します。
 * interval を加える場合、版 4 より古いフローは版 4 にします。interval は版 4 で加えた項目のためです。
 * @param {Flow} flow
 * @param {import('./speed.js').Interval | undefined} interval
 * @returns {Flow}
 */
export function withInterval(flow, interval) {
  const rest = { ...flow };
  delete rest.interval;
  if (interval === undefined) {
    return rest;
  }
  return {
    ...rest,
    schemaVersion: Math.max(flow.schemaVersion, INTERVAL_MIN_SCHEMA_VERSION),
    interval: { min: interval.min, max: interval.max },
  };
}

/**
 * 編集中の JSON の文字列を、字下げ 2 文字で整形します（#50）。保存時・書き出し時と同じ字下げです。
 * フロー定義の形式を満たす場合だけ、表示を開き直したときと同じ順序（orderFlow）に並べ直します。
 * 形式に誤りがある場合は項目の順序を変えず、字下げだけを直します。検証は保存と追加の時点で行います。
 * @param {string} text
 * @returns {{ ok: true, text: string } | { ok: false, error: string }}
 */
export function formatFlowJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `JSON として読み取れません。${String(error)}` };
  }
  const ordered = validateFlow(value).length === 0 ? orderFlow(/** @type {Flow} */ (value)) : value;
  return { ok: true, text: JSON.stringify(ordered, null, 2) };
}

/**
 * フロー定義の項目を、読みやすい順序に並べ直します。
 * chrome.storage は保存した項目を名前の順に並べ替えるため、表示や書き出しの前に使います。
 * @param {Flow} flow
 * @returns {Flow}
 */
export function orderFlow({ schemaVersion, name, origin, extraOrigins, params, steps, ...rest }) {
  return {
    schemaVersion,
    name,
    origin,
    ...(extraOrigins ? { extraOrigins } : {}),
    ...(params
      ? {
          params: params.map(({ name, label, type, ...paramRest }) => ({
            name,
            label,
            type,
            ...paramRest,
          })),
        }
      : {}),
    ...rest,
    steps: steps.map(orderStep),
  };
}

/**
 * 手順の項目を、種類（type）が先頭に来る順序に並べ直します。if と forEach は、内側の手順も並べ直します。
 * @param {Step} step
 * @returns {Step}
 */
function orderStep(step) {
  switch (step.type) {
    case 'if': {
      const { type, condition, then, else: otherwise, ...rest } = step;
      return {
        type,
        condition,
        ...rest,
        then: then.map(orderStep),
        ...(otherwise ? { else: otherwise.map(orderStep) } : {}),
      };
    }
    case 'forEach': {
      const { type, items, max, nextPage, maxPages, steps, ...rest } = step;
      return {
        type,
        items,
        ...(max !== undefined ? { max } : {}),
        ...(nextPage !== undefined ? { nextPage } : {}),
        ...(maxPages !== undefined ? { maxPages } : {}),
        ...rest,
        steps: steps.map(orderStep),
      };
    }
    default: {
      const { type, ...rest } = step;
      return /** @type {Step} */ ({ type, ...rest });
    }
  }
}

/**
 * 値がフロー定義の形式を満たしているかを検証します。
 * 外部から読み込んだ JSON を想定するため、どのような値を受け取っても例外を投げません。
 * @param {unknown} value 検証する値
 * @returns {string[]} 誤りの説明の一覧。空の場合は形式を満たしています。
 */
export function validateFlow(value) {
  if (!isRecord(value)) {
    return ['フロー定義がオブジェクトではありません。'];
  }

  /** @type {string[]} */
  const errors = [];

  if (!SUPPORTED_SCHEMA_VERSIONS.includes(/** @type {number} */ (value.schemaVersion))) {
    errors.push(
      `schemaVersion が ${SUPPORTED_SCHEMA_VERSIONS.join(' または ')} ではありません。` +
        '新しい版のフローの場合は、拡張機能を更新してください。',
    );
  }

  if (!isText(value.name) || value.name.trim() === '') {
    errors.push('name が空か、文字列ではありません。');
  }

  if (typeof value.origin !== 'string' || !isWebOrigin(value.origin)) {
    errors.push('origin が https:// または http:// で始まるオリジンではありません。');
  }

  const originErrors = validateExtraOrigins(value);
  errors.push(...originErrors);
  /** 手順の origin に書けるサイトです。一覧に誤りがある場合は、手順の origin の検証を行いません。 */
  const origins =
    originErrors.length === 0 && typeof value.origin === 'string'
      ? [value.origin, .../** @type {string[]} */ (value.extraOrigins ?? [])]
      : undefined;

  const paramErrors = validateParams(value.params);
  errors.push(...paramErrors);

  if (value.interval !== undefined) {
    errors.push(...validateInterval(value.interval));
    if (
      typeof value.schemaVersion === 'number' &&
      value.schemaVersion < INTERVAL_MIN_SCHEMA_VERSION
    ) {
      errors.push(
        `interval は、schemaVersion が ${INTERVAL_MIN_SCHEMA_VERSION} 以上のフローでだけ使えます。`,
      );
    }
  }

  if (!Array.isArray(value.steps)) {
    errors.push('steps が配列ではありません。');
  } else if (countSteps(value.steps, 0) > MAX_STEPS) {
    errors.push(
      `steps が、if と forEach の内側の手順を含めて上限の ${MAX_STEPS} 件を超えています。`,
    );
  } else {
    validateStepList(value.steps, 'steps', 0, false, {
      errors,
      version: typeof value.schemaVersion === 'number' ? value.schemaVersion : undefined,
      origins,
      params: /** @type {Param[]} */ (paramErrors.length === 0 ? (value.params ?? []) : []),
      paramErrors: paramErrors.length > 0,
      extracted: new Set(),
    });
  }

  return errors;
}

/**
 * 手順の一覧を検証するときに、手順の間で受け渡す情報です。
 * @typedef {object} StepContext
 * @property {string[]} errors 誤りを加えていく一覧
 * @property {number | undefined} version フローの版番号
 * @property {string[] | undefined} origins 手順の origin に書けるサイト。一覧に誤りがある場合は undefined です
 * @property {Param[]} params パラメータの定義
 * @property {boolean} paramErrors パラメータの定義に誤りがあるか
 * @property {Set<string>} extracted 前の手順の extract で付けた名前。savePdf の path で参照できます
 */

/**
 * 手順の一覧を、内側の手順を含めて検証します（#6）。
 * @param {unknown[]} list
 * @param {string} path 誤りの説明に付ける、一覧の位置（例：steps、steps[2].then）
 * @param {number} depth if と forEach の入れ子の段数。最上位は 0 です
 * @param {boolean} inLoop forEach の内側か
 * @param {StepContext} context
 */
function validateStepList(list, path, depth, inLoop, context) {
  const { errors, version, origins, params } = context;
  list.forEach((step, index) => {
    const at = `${path}[${index}]`;
    for (const error of validateStep(step)) {
      errors.push(`${at}: ${error}`);
    }
    if (!isRecord(step)) {
      return;
    }
    const type = typeof step.type === 'string' ? step.type : '';
    const minVersion = MIN_SCHEMA_VERSION[type];
    if (minVersion !== undefined && version !== undefined && version < minVersion) {
      errors.push(
        `${at}: ${type} の手順は、schemaVersion が ${minVersion} 以上のフローでだけ使えます。`,
      );
    }
    for (const [name, target] of stepTargets(step)) {
      if (!isRecord(target) || target.scope === undefined) {
        continue;
      }
      if (name === 'nextPage') {
        // 「次へ」のボタンは行の外にあるため、ページ全体で探します（#95）。
        errors.push(`${at}: nextPage.scope は書けません。「次へ」はページ全体で探します。`);
      } else if (version !== undefined && version < SCOPE_MIN_SCHEMA_VERSION) {
        errors.push(
          `${at}: ${name}.scope は、schemaVersion が ${SCOPE_MIN_SCHEMA_VERSION} 以上のフローでだけ使えます。`,
        );
      } else if (!inLoop) {
        errors.push(`${at}: ${name}.scope は、forEach の内側の手順にだけ書けます。`);
      }
    }
    if (inLoop && type === 'navigate') {
      if (version !== undefined && version < LOOP_NAVIGATION_MIN_SCHEMA_VERSION) {
        errors.push(
          `${at}: forEach の内側の navigate の手順は、schemaVersion が ${LOOP_NAVIGATION_MIN_SCHEMA_VERSION} 以上のフローでだけ使えます。`,
        );
      } else if (step.cause === 'user') {
        // 一覧のページへは自動で戻るため、利用者の操作による移動は書く必要がありません（#95）。
        errors.push(
          `${at}: forEach の内側には、cause が user の navigate の手順を書けません。一覧のページへは、行の処理の後に自動で戻ります。`,
        );
      }
    }
    if (type === 'forEach' && (step.nextPage !== undefined || step.maxPages !== undefined)) {
      if (version !== undefined && version < LOOP_NAVIGATION_MIN_SCHEMA_VERSION) {
        errors.push(
          `${at}: nextPage と maxPages は、schemaVersion が ${LOOP_NAVIGATION_MIN_SCHEMA_VERSION} 以上のフローでだけ使えます。`,
        );
      }
      if (inLoop) {
        // 内側の繰り返しでページを送ると、外側の行の番号が意味を失うためです（#95）。
        errors.push(
          `${at}: nextPage と maxPages は、外側に forEach がない forEach にだけ書けます。`,
        );
      }
    }
    if (typeof step.origin === 'string' && PAGE_STEP_TYPES.includes(type)) {
      if (version !== undefined && version < ORIGINS_MIN_SCHEMA_VERSION) {
        errors.push(
          `${at}: origin は、schemaVersion が ${ORIGINS_MIN_SCHEMA_VERSION} 以上のフローでだけ使えます。`,
        );
      } else if (origins && !origins.includes(step.origin)) {
        errors.push(
          `${at}: origin の「${step.origin}」が、フローの origin にも extraOrigins にもありません。`,
        );
      }
    }
    if (type === 'extract' && typeof step.name === 'string') {
      if (params.some((param) => param.name === step.name)) {
        errors.push(`${at}: name の「${step.name}」は、パラメータと同じ名前のため使えません。`);
      }
      context.extracted.add(step.name);
    }
    if (type === 'savePdf' && typeof step.path === 'string') {
      validatePathReferences(step.path, at, context);
    }
    // パラメータの定義に誤りがある場合、参照の検証は定義を直してから行います。
    if (!context.paramErrors) {
      for (const text of templateTexts(step)) {
        for (const error of validateReferences(text, params)) {
          errors.push(`${at}: ${error}`);
        }
      }
    }

    if (CONTROL_STEP_TYPES.includes(type)) {
      if (depth >= MAX_NESTING) {
        errors.push(`${at}: if と forEach の入れ子は ${MAX_NESTING} 段までです。`);
        return;
      }
      if (type === 'if') {
        if (Array.isArray(step.then)) {
          validateStepList(step.then, `${at}.then`, depth + 1, inLoop, context);
        }
        if (Array.isArray(step.else)) {
          validateStepList(step.else, `${at}.else`, depth + 1, inLoop, context);
        }
      } else if (Array.isArray(step.steps)) {
        validateStepList(step.steps, `${at}.steps`, depth + 1, true, context);
      }
    }
  });
}

/**
 * savePdf の path が参照する名前を検証します。
 * @param {string} path
 * @param {string} at 誤りの説明に付ける、手順の位置
 * @param {StepContext} context
 */
function validatePathReferences(path, at, context) {
  const { errors, params } = context;
  for (const { name, part } of nonBuiltinReferences(path)) {
    if (part === undefined && context.extracted.has(name)) {
      continue;
    }
    if (context.paramErrors) {
      continue;
    }
    if (part === undefined && !params.some((param) => param.name === name)) {
      errors.push(
        `${at}: path の「${name}」は、パラメータにも、前の手順の extract で付けた名前にもありません。`,
      );
    } else {
      for (const error of validateReferences(`{{${part ? `${name}.${part}` : name}}}`, params)) {
        errors.push(`${at}: path の${error}`);
      }
    }
  }
}

/**
 * 手順が持つ要素の指定と、その項目名です。
 * @param {Record<string, unknown>} step
 * @returns {[string, unknown][]}
 */
function stepTargets(step) {
  switch (step.type) {
    case 'if':
      return isRecord(step.condition) ? [['condition.target', step.condition.target]] : [];
    case 'forEach':
      return step.nextPage === undefined
        ? [['items', step.items]]
        : [
            ['items', step.items],
            ['nextPage', step.nextPage],
          ];
    default:
      return 'target' in step ? [['target', step.target]] : [];
  }
}

/**
 * if と forEach の内側を含めた、手順の数を数えます。形式に誤りがあっても例外を投げません。
 * 入れ子の段数の上限を超えた内側は数えません。その誤りは validateStepList が報告します。
 * @param {unknown[]} list
 * @param {number} depth
 * @returns {number}
 */
function countSteps(list, depth) {
  let count = list.length;
  if (depth >= MAX_NESTING) {
    return count;
  }
  for (const step of list) {
    if (!isRecord(step)) {
      continue;
    }
    for (const children of [step.then, step.else, step.steps]) {
      if ((step.type === 'if' || step.type === 'forEach') && Array.isArray(children)) {
        count += countSteps(children, depth + 1);
      }
    }
  }
  return count;
}

/**
 * 値が 1 つの手順の形式を満たしているかを検証します。
 * @param {unknown} step 検証する値
 * @returns {string[]} 誤りの説明の一覧。空の場合は形式を満たしています。
 */
export function validateStep(step) {
  if (!isRecord(step)) {
    return ['手順がオブジェクトではありません。'];
  }
  if (step.origin !== undefined) {
    if (typeof step.type !== 'string' || !PAGE_STEP_TYPES.includes(step.type)) {
      return ['origin は、click、input、select、extract の手順にだけ書けます。'];
    }
    if (typeof step.origin !== 'string' || !isWebOrigin(step.origin)) {
      return ['origin が https:// または http:// で始まるオリジンではありません。'];
    }
  }

  switch (step.type) {
    case 'navigate': {
      /** @type {string[]} */
      const errors = [];
      if (!isText(step.url) || !isWebUrl(withPlaceholders(step.url))) {
        errors.push('url が https:// または http:// で始まる URL ではありません。');
      }
      if (step.cause !== 'user' && step.cause !== 'page') {
        errors.push('cause が user または page ではありません。');
      }
      return errors;
    }

    case 'click':
      return validateTarget(step.target);

    case 'input': {
      const errors = validateTarget(step.target);
      if (step.secret === true) {
        if ('value' in step) {
          errors.push('secret の入力欄に value が記録されています。');
        }
      } else if (step.secret !== undefined) {
        errors.push('secret が true ではありません。');
      } else if (!isText(step.value)) {
        errors.push('value が文字列ではありません。');
      }
      return errors;
    }

    case 'select': {
      const errors = validateTarget(step.target);
      if (!isTextArray(step.values)) {
        errors.push('values が文字列の配列ではありません。');
      }
      if (!isTextArray(step.labels)) {
        errors.push('labels が文字列の配列ではありません。');
      }
      return errors;
    }

    case 'pause':
      return step.note === undefined || isText(step.note) ? [] : ['note が文字列ではありません。'];

    case 'savePdf': {
      /** @type {string[]} */
      const errors = [];
      if (step.path !== undefined) {
        if (!isText(step.path)) {
          errors.push('path が文字列ではありません。');
        } else {
          errors.push(...validateSaveTemplate(step.path));
        }
      }
      if (
        step.onConflict !== undefined &&
        step.onConflict !== 'rename' &&
        step.onConflict !== 'overwrite'
      ) {
        errors.push('onConflict が rename または overwrite ではありません。');
      }
      if (step.mode !== undefined && step.mode !== 'print' && step.mode !== 'screen') {
        errors.push('mode が print または screen ではありません。');
      }
      return errors;
    }

    case 'extract': {
      const errors = validateTarget(step.target);
      if (typeof step.name !== 'string' || !PARAM_NAME_PATTERN.test(step.name)) {
        errors.push('name が、英字または _ で始まり英数字と _ だけを使った名前ではありません。');
      } else if (RESERVED_NAMES.includes(step.name)) {
        errors.push(`name に「${step.name}」は使えません。組み込みの値の名前です。`);
      }
      return errors;
    }

    case 'wait':
      return validateWaitMs(step.ms);

    case 'if': {
      /** @type {string[]} */
      const errors = [];
      if (!isRecord(step.condition)) {
        errors.push('condition がオブジェクトではありません。');
      } else {
        errors.push(...validateTarget(step.condition.target, 'condition.target'));
        if (typeof step.condition.exists !== 'boolean') {
          errors.push('condition.exists が true または false ではありません。');
        }
      }
      if (!Array.isArray(step.then)) {
        errors.push('then が配列ではありません。');
      }
      if (step.else !== undefined && !Array.isArray(step.else)) {
        errors.push('else が配列ではありません。');
      }
      return errors;
    }

    case 'forEach': {
      const errors = validateTarget(step.items, 'items');
      if (
        step.max !== undefined &&
        (!Number.isInteger(step.max) ||
          /** @type {number} */ (step.max) < 1 ||
          /** @type {number} */ (step.max) > FOREACH_MAX_LIMIT)
      ) {
        errors.push(`max が 1 以上 ${FOREACH_MAX_LIMIT} 以下の整数ではありません。`);
      }
      if (step.nextPage !== undefined) {
        errors.push(...validateTarget(step.nextPage, 'nextPage'));
      }
      if (
        step.maxPages !== undefined &&
        (!Number.isInteger(step.maxPages) ||
          /** @type {number} */ (step.maxPages) < 1 ||
          /** @type {number} */ (step.maxPages) > MAX_PAGES_LIMIT)
      ) {
        errors.push(`maxPages が 1 以上 ${MAX_PAGES_LIMIT} 以下の整数ではありません。`);
      }
      if (!Array.isArray(step.steps)) {
        errors.push('steps が配列ではありません。');
      }
      return errors;
    }

    default:
      return [
        '手順の種類（type）が navigate、click、input、select、pause、savePdf、extract、wait、if、forEach のいずれでもありません。',
      ];
  }
}

/**
 * 手順のうち、パラメータの参照（{{名前}}）を書ける値を返します。
 * 入力の値、選択肢の value、移動先の URL です。
 * @param {unknown} step
 * @returns {string[]}
 */
export function templateTexts(step) {
  if (!isRecord(step)) {
    return [];
  }
  switch (step.type) {
    case 'navigate':
      return typeof step.url === 'string' ? [step.url] : [];
    case 'input':
      return typeof step.value === 'string' ? [step.value] : [];
    case 'select':
      return Array.isArray(step.values)
        ? step.values.filter((value) => typeof value === 'string')
        : [];
    default:
      return [];
  }
}

/**
 * 追加のサイトの一覧（extraOrigins）を検証します（#41）。
 * @param {Record<string, unknown>} value フロー定義
 * @returns {string[]}
 */
function validateExtraOrigins(value) {
  const list = value.extraOrigins;
  if (list === undefined) {
    return [];
  }
  /** @type {string[]} */
  const errors = [];
  if (typeof value.schemaVersion === 'number' && value.schemaVersion < ORIGINS_MIN_SCHEMA_VERSION) {
    errors.push(
      `extraOrigins は、schemaVersion が ${ORIGINS_MIN_SCHEMA_VERSION} 以上のフローでだけ使えます。`,
    );
  }
  if (!Array.isArray(list)) {
    return [...errors, 'extraOrigins が配列ではありません。'];
  }
  if (list.length > MAX_EXTRA_ORIGINS) {
    errors.push(`extraOrigins が上限の ${MAX_EXTRA_ORIGINS} 件を超えています。`);
  }
  list.forEach((origin, index) => {
    if (typeof origin !== 'string' || !isWebOrigin(origin)) {
      errors.push(
        `extraOrigins[${index}] が https:// または http:// で始まるオリジンではありません。`,
      );
    } else if (origin === value.origin) {
      errors.push(`extraOrigins[${index}] が、フローの origin と同じです。`);
    } else if (list.indexOf(origin) !== index) {
      errors.push(`extraOrigins[${index}] の「${origin}」が重複しています。`);
    }
  });
  return errors;
}

/**
 * フローが操作するサイトの一覧です。フローの origin と extraOrigins を合わせたものです（#41）。
 * @param {Pick<Flow, 'origin' | 'extraOrigins'>} flow
 * @returns {string[]}
 */
export function flowOrigins(flow) {
  return [flow.origin, ...(flow.extraOrigins ?? [])];
}

/**
 * 手順を実行してよいページのサイトです。手順の origin がない場合は、フローの origin です（#41）。
 * @param {Pick<Flow, 'origin'>} flow
 * @param {Step} step
 * @returns {string}
 */
export function stepOrigin(flow, step) {
  return 'origin' in step && typeof step.origin === 'string' ? step.origin : flow.origin;
}

/**
 * @param {unknown} target
 * @param {string} [name] 誤りの説明に使う項目名
 * @returns {string[]}
 */
function validateTarget(target, name = 'target') {
  if (!isRecord(target)) {
    return [`${name} がオブジェクトではありません。`];
  }

  /** @type {string[]} */
  const errors = [];
  if (
    !isTextArray(target.selectors) ||
    target.selectors.length === 0 ||
    target.selectors.some((selector) => selector === '')
  ) {
    errors.push(`${name}.selectors が、空でない文字列の配列ではありません。`);
  }
  if (!isText(target.tag) || target.tag === '') {
    errors.push(`${name}.tag が空か、文字列ではありません。`);
  }
  if (!isText(target.label)) {
    errors.push(`${name}.label が文字列ではありません。`);
  }
  if (target.text !== undefined && !isText(target.text)) {
    errors.push(`${name}.text が文字列ではありません。`);
  }
  if (target.scope !== undefined && target.scope !== 'item') {
    errors.push(`${name}.scope が item ではありません。`);
  }
  return errors;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 長さの上限を超えない文字列かを判定します。
 * @param {unknown} value
 * @returns {value is string}
 */
function isText(value) {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

/**
 * @param {unknown} value
 * @returns {value is string[]}
 */
function isTextArray(value) {
  return Array.isArray(value) && value.length <= MAX_STEPS && value.every(isText);
}

/**
 * @param {string} value
 * @returns {URL | null}
 */
function parseWebUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
}

/**
 * https:// または http:// で始まる URL かを判定します。
 * @param {string} value
 * @returns {boolean}
 */
export function isWebUrl(value) {
  return parseWebUrl(value) !== null;
}

/**
 * パスなどを含まない、Web ページのオリジンそのものかを判定します。
 * @param {string} value
 * @returns {boolean}
 */
export function isWebOrigin(value) {
  return parseWebUrl(value)?.origin === value;
}
