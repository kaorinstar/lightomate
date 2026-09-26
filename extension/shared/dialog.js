// 実行中にサイトが表示するダイアログ（alert、confirm、prompt、ページを離れるときの確認）への応答を
// 決めます（#88）。chrome.* は使いません。
//
// ダイアログが開くと、閉じるまでページのスクリプトはすべて止まり、content script も応答しません。
// そのため、ダイアログは Service Worker が chrome.debugger（Page.javascriptDialogOpening）で受け取り、
// 手順の dialog の指定どおりに応答します（Page.handleJavaScriptDialog）。指定がない場合は応答せずに
// 一時停止し、利用者が応答します。確定を表す語を含むダイアログには、指定があっても［OK］を返しません。

import { findConfirmText } from './purchase-guard.js';

/** 手順の dialog を使える最も古い版です（#88）。 */
export const DIALOG_MIN_SCHEMA_VERSION = 10;

/** dialog を書ける手順の種類です。ページを操作し、ダイアログを開かせる可能性がある手順です。 */
export const DIALOG_STEP_TYPES = ['click', 'input', 'select', 'navigate'];

/** 1 つの手順の dialog に書ける応答の数の上限です。 */
export const MAX_DIALOG_RESPONSES = 5;

/** 止まった理由に載せる、ダイアログの文言の長さの上限です。 */
const MESSAGE_MAX_LENGTH = 200;

/**
 * ダイアログへの応答です。accept は［OK］（ページを離れる）、dismiss は［キャンセル］（ページにとどまる）です。
 * @typedef {'accept' | 'dismiss'} DialogResponse
 */

/**
 * 開いたダイアログです。Page.javascriptDialogOpening の type と message です。
 * @typedef {object} OpenedDialog
 * @property {string} type alert、confirm、prompt、beforeunload のいずれか
 * @property {string} message ダイアログの文言
 */

/**
 * ダイアログへの対応です。
 * - respond：response のとおりに応答します。
 * - pause：応答せずに一時停止します。利用者が応答してから［再開］を押します。
 * - halt：応答せずに実行を終えます。ダイアログは開いたまま残し、利用者が応答します。
 * @typedef {{ action: 'respond', response: DialogResponse }
 *   | { action: 'pause', note: string }
 *   | { action: 'halt', note: string }} DialogDecision
 */

/**
 * 手順の dialog の形式を検証します。
 * @param {unknown} value
 * @returns {string[]} 誤りの説明の一覧
 */
export function validateDialog(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_DIALOG_RESPONSES ||
    !value.every((response) => response === 'accept' || response === 'dismiss')
  ) {
    return [
      `dialog が、"accept" または "dismiss" を 1〜${MAX_DIALOG_RESPONSES} 個並べた配列ではありません。`,
    ];
  }
  return [];
}

/**
 * ダイアログの種類を、人が読む形にします。
 * @param {string} type
 * @returns {string}
 */
function dialogName(type) {
  switch (type) {
    case 'alert':
      return '知らせのダイアログ';
    case 'confirm':
      return '確認のダイアログ';
    case 'prompt':
      return '文字を入力するダイアログ';
    case 'beforeunload':
      return 'ページを離れるかの確認';
    default:
      return 'ダイアログ';
  }
}

/**
 * ダイアログの種類と文言を、止まった理由に載せる形にします。文言は空白を詰め、長い場合は切ります。
 * @param {OpenedDialog} dialog
 * @returns {string}
 */
function describeDialog(dialog) {
  const message = dialog.message.replace(/\s+/g, ' ').trim();
  if (!message) {
    return dialogName(dialog.type);
  }
  const shown =
    message.length > MESSAGE_MAX_LENGTH ? `${message.slice(0, MESSAGE_MAX_LENGTH)}…` : message;
  return `${dialogName(dialog.type)}（「${shown}」）`;
}

/**
 * 開いたダイアログへの対応を決めます。
 * @param {OpenedDialog} dialog
 * @param {DialogResponse[] | undefined} responses 直前にページを操作した手順の dialog
 * @param {number} answered その手順の後に、すでに応答したダイアログの数
 * @returns {DialogDecision}
 */
export function decideDialog(dialog, responses, answered) {
  const shown = describeDialog(dialog);
  if (dialog.type === 'prompt') {
    return {
      action: 'pause',
      note: `サイトが${shown}を表示しました。文字を入力するダイアログには、自動では応答しません。ダイアログに手で応答してください。`,
    };
  }
  const response = responses?.[answered];
  if (response === undefined) {
    return {
      action: 'pause',
      note:
        `サイトが${shown}を表示しました。` +
        (responses === undefined
          ? '手順に応答の指定（dialog）がないため、応答していません。'
          : `手順の応答の指定（dialog）は ${responses.length} 回分で、使い切っているため、応答していません。`) +
        'ダイアログに手で応答してください。',
    };
  }
  // alert は［OK］しかなく、閉じても操作は進みません。確定を表す語は、進む応答だけで確かめます。
  if (response === 'accept' && (dialog.type === 'confirm' || dialog.type === 'beforeunload')) {
    const word = findConfirmText([dialog.message]);
    if (word !== undefined) {
      return {
        action: 'halt',
        note: `サイトが${shown}を表示しました。確定を表す語を含むため、［OK］を返さずに実行を終えました。内容を確認し、ダイアログへの応答と確定は手で行ってください。`,
      };
    }
  }
  return { action: 'respond', response };
}
