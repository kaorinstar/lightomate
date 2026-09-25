// PDF の保存（savePdf、#16）の保存先を、ひな形に値を埋め込んで作ります。chrome.* は使いません。
//
// 保存先は Chrome のダウンロード先フォルダーからの相対パスです（chrome.downloads の filename）。
// 値によってダウンロード先フォルダーの外に保存されることを防ぐため、次のようにします。
// - ひな形の / だけをフォルダーの区切りにします。値の中の / と \ は区切りにせず、_ に置き換えます。
// - Windows でファイル名に使えない文字（\ / : * ? " < > |）と制御文字は、_ に置き換えます。
// - 値を埋め込んだ結果がドットだけの名前（. や ..）や空の名前になる場合は、_ にします。
// - ひな形そのものが絶対パス、空のフォルダー名、. や .. を含む場合は、誤りとします。

import { findReferences } from './params.js';

/** path を指定しない場合の保存先です。 */
export const DEFAULT_SAVE_PATH =
  'Lightomate/{{flow.name}}/{{run.yyyy}}{{run.mm}}{{run.dd}}_{{run.hhmmss}}.pdf';

/** 組み込みの値の名前です。{{flow.name}} のように、名前と部分を . でつないで参照します。 */
export const BUILTIN_REFERENCES = /** @type {const} */ ([
  'flow.name',
  'site.host',
  'run.yyyy',
  'run.mm',
  'run.dd',
  'run.hhmmss',
]);

/** 組み込みの値に使う名前です。読み取った値（extract）には付けられません。 */
export const RESERVED_NAMES = ['flow', 'site', 'run'];

/** Windows で使えないファイル名の文字と、制御文字です。 */
// 制御文字をファイル名から除くことが目的のため、正規表現に制御文字を含めます。
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** Windows で予約されている名前です（拡張子が付いていても使えません）。 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * {{名前}} と {{名前.部分}} を見つける正規表現です。params.js と同じ書式です。
 * @returns {RegExp}
 */
function referencePattern() {
  return /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z]+))?\s*\}\}/g;
}

/**
 * 組み込みの値を作ります。
 * @param {string} flowName
 * @param {string} origin フローのオリジン
 * @param {Date} now 実行した日時
 * @returns {Record<string, string>}
 */
export function builtinValues(flowName, origin, now) {
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0');
  let host = origin;
  try {
    host = new URL(origin).hostname;
  } catch {
    // オリジンが読み取れない場合は、そのまま使います。値は後で安全な文字に置き換えます。
  }
  return {
    'flow.name': flowName,
    'site.host': host,
    'run.yyyy': String(now.getFullYear()),
    'run.mm': pad(now.getMonth() + 1),
    'run.dd': pad(now.getDate()),
    'run.hhmmss': `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  };
}

/**
 * ひな形の参照のうち、組み込みの値でないものを返します。パラメータか、読み取った値の参照です。
 * @param {string} template
 * @returns {{ name: string, part: string | undefined }[]}
 */
export function nonBuiltinReferences(template) {
  return findReferences(template).filter(
    ({ name, part }) =>
      part === undefined ||
      !(/** @type {readonly string[]} */ (BUILTIN_REFERENCES).includes(`${name}.${part}`)),
  );
}

/**
 * ひな形そのものの形を検証します。値を埋め込む前に確かめられる誤りだけを扱います。
 * @param {string} template
 * @returns {string[]} 誤りの説明の一覧
 */
export function validateSaveTemplate(template) {
  /** @type {string[]} */
  const errors = [];
  const normalized = template.replaceAll('\\', '/');
  if (normalized.trim() === '') {
    return ['path が空です。'];
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    errors.push(
      'path に絶対パスは使えません。ダウンロード先フォルダーからの相対パスで書いてください。',
    );
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.trim() === '')) {
    errors.push('path に空のフォルダー名があります（/ が続いているか、末尾が / です）。');
  }
  if (segments.some((segment) => segment.trim() === '.' || segment.trim() === '..')) {
    errors.push('path に . や .. のフォルダー名は使えません。');
  }
  return errors;
}

/**
 * ひな形に値を埋め込み、保存先のパスを作ります。
 * @param {string} template 保存先のひな形。/ でフォルダーを区切ります
 * @param {Record<string, string>} values 参照の名前（例：flow.name、month、month.mm）と値
 * @returns {{ ok: true, path: string } | { ok: false, error: string }}
 */
export function buildSavePath(template, values) {
  const errors = validateSaveTemplate(template);
  if (errors.length > 0) {
    return { ok: false, error: errors.join(' ') };
  }
  /** @type {string[]} */
  const missing = [];
  const segments = template
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => {
      const filled = segment.replace(referencePattern(), (whole, name, part) => {
        const key = part ? `${name}.${part}` : name;
        if (!Object.hasOwn(values, key)) {
          missing.push(key);
          return whole;
        }
        return values[key];
      });
      return safeSegment(filled);
    });
  if (missing.length > 0) {
    return {
      ok: false,
      error: `保存先に埋め込む値がありません（${[...new Set(missing)].join('、')}）。`,
    };
  }
  const last = segments.length - 1;
  if (!/\.pdf$/i.test(segments[last])) {
    segments[last] = `${segments[last]}.pdf`;
  }
  return { ok: true, path: segments.join('/') };
}

/**
 * 1 つのフォルダー名またはファイル名を、ダウンロード先フォルダーの中で安全に使える形にします。
 * @param {string} segment
 * @returns {string}
 */
function safeSegment(segment) {
  // Windows は名前の末尾の空白とドットを取り除くため、先に取り除いておきます。
  let result = segment
    .replace(UNSAFE_CHARACTERS, '_')
    .trim()
    .replace(/[. ]+$/, '');
  if (result === '' || /^\.+$/.test(result)) {
    result = '_';
  }
  if (WINDOWS_RESERVED.test(result)) {
    result = `_${result}`;
  }
  return result;
}
