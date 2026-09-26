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

/** 現在のフロー定義の形式の版番号です。形式を変えるときに 1 増やします。 */
export const SCHEMA_VERSION = 5;

/**
 * 読み込める版番号です。版 2 は、版 1 に一時停止の手順（pause）を加えたものです。
 * 版 3 は、版 2 に PDF の保存（savePdf）とページの文字の読み取り（extract）を加えたものです（#16）。
 * 版 4 は、版 3 に手順の間隔（interval）と待機の手順（wait）を加えたものです（#15）。
 * 版 5 は、版 4 に追加のサイトの一覧（extraOrigins）と、手順を記録したサイト（手順の origin）を
 * 加えたものです（#41）。
 * 古い版のフローは、変換せずにそのまま新しい版として扱えます。
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2, 3, 4, 5];

/**
 * 手順の種類ごとの、使える最も古い版です。これより古い版のフローには書けません。
 * @type {Record<string, number>}
 */
const MIN_SCHEMA_VERSION = { pause: 2, savePdf: 3, extract: 3, wait: 4 };

/** interval を使える最も古い版です。 */
const INTERVAL_MIN_SCHEMA_VERSION = 4;

/** extraOrigins と手順の origin を使える最も古い版です（#41）。 */
const ORIGINS_MIN_SCHEMA_VERSION = 5;

/**
 * 追加のサイト（extraOrigins）の件数の上限です（#41）。記録中は確認を出さずに加えるため、
 * 多くのサブドメインを通るサイト（楽天市場など）も収まる件数にします。
 */
export const MAX_EXTRA_ORIGINS = 10;

/** 手順を記録したサイト（origin）を持てる手順の種類です。ページを操作する手順です（#41）。 */
export const PAGE_STEP_TYPES = ['click', 'input', 'select', 'extract'];

/** 1 つのフローに含められる手順の数の上限です。保存領域を使い切ることを防ぎます。 */
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
 * @typedef {NavigateStep | ClickStep | InputStep | SelectStep | PauseStep | SavePdfStep | ExtractStep | WaitStep} Step
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
    steps: steps.map(({ type, ...stepRest }) => /** @type {Step} */ ({ type, ...stepRest })),
  };
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
  } else if (value.steps.length > MAX_STEPS) {
    errors.push(`steps が上限の ${MAX_STEPS} 件を超えています。`);
  } else {
    /** 前の手順の extract で付けた名前です。savePdf の path で参照できます。 */
    const extracted = new Set();
    const params = /** @type {Param[]} */ (paramErrors.length === 0 ? (value.params ?? []) : []);
    value.steps.forEach((step, index) => {
      for (const error of validateStep(step)) {
        errors.push(`steps[${index}]: ${error}`);
      }
      const type = isRecord(step) && typeof step.type === 'string' ? step.type : '';
      const minVersion = MIN_SCHEMA_VERSION[type];
      if (
        minVersion !== undefined &&
        typeof value.schemaVersion === 'number' &&
        value.schemaVersion < minVersion
      ) {
        errors.push(
          `steps[${index}]: ${type} の手順は、schemaVersion が ${minVersion} 以上のフローでだけ使えます。`,
        );
      }
      if (isRecord(step) && typeof step.origin === 'string' && PAGE_STEP_TYPES.includes(type)) {
        if (
          typeof value.schemaVersion === 'number' &&
          value.schemaVersion < ORIGINS_MIN_SCHEMA_VERSION
        ) {
          errors.push(
            `steps[${index}]: origin は、schemaVersion が ${ORIGINS_MIN_SCHEMA_VERSION} 以上のフローでだけ使えます。`,
          );
        } else if (origins && !origins.includes(step.origin)) {
          errors.push(
            `steps[${index}]: origin の「${step.origin}」が、フローの origin にも extraOrigins にもありません。`,
          );
        }
      }
      if (isRecord(step) && step.type === 'extract' && typeof step.name === 'string') {
        if (params.some((param) => param.name === step.name)) {
          errors.push(
            `steps[${index}]: name の「${step.name}」は、パラメータと同じ名前のため使えません。`,
          );
        }
        extracted.add(step.name);
      }
      if (isRecord(step) && step.type === 'savePdf' && typeof step.path === 'string') {
        for (const { name, part } of nonBuiltinReferences(step.path)) {
          if (part === undefined && extracted.has(name)) {
            continue;
          }
          if (
            part === undefined &&
            !params.some((param) => param.name === name) &&
            paramErrors.length === 0
          ) {
            errors.push(
              `steps[${index}]: path の「${name}」は、パラメータにも、前の手順の extract で付けた名前にもありません。`,
            );
          } else if (paramErrors.length === 0) {
            for (const error of validateReferences(
              `{{${part ? `${name}.${part}` : name}}}`,
              params,
            )) {
              errors.push(`steps[${index}]: path の${error}`);
            }
          }
        }
      }
      // パラメータの定義に誤りがある場合、参照の検証は定義を直してから行います。
      if (paramErrors.length === 0) {
        for (const text of templateTexts(step)) {
          for (const error of validateReferences(text, params)) {
            errors.push(`steps[${index}]: ${error}`);
          }
        }
      }
    });
  }

  return errors;
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

    default:
      return [
        '手順の種類（type）が navigate、click、input、select、pause、savePdf、extract、wait のいずれでもありません。',
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
 * @returns {string[]}
 */
function validateTarget(target) {
  if (!isRecord(target)) {
    return ['target がオブジェクトではありません。'];
  }

  /** @type {string[]} */
  const errors = [];
  if (
    !isTextArray(target.selectors) ||
    target.selectors.length === 0 ||
    target.selectors.some((selector) => selector === '')
  ) {
    errors.push('target.selectors が、空でない文字列の配列ではありません。');
  }
  if (!isText(target.tag) || target.tag === '') {
    errors.push('target.tag が空か、文字列ではありません。');
  }
  if (!isText(target.label)) {
    errors.push('target.label が文字列ではありません。');
  }
  if (target.text !== undefined && !isText(target.text)) {
    errors.push('target.text が文字列ではありません。');
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
