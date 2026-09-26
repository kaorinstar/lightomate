// 手順を、人が読むための 1 行の説明にします。サイドパネルと設定画面で使います。

import { DEFAULT_FOREACH_MAX, itemText } from './control-flow.js';
import { DEFAULT_SAVE_PATH } from './save-path.js';

/** @typedef {import('./flow.js').Step} Step */

/**
 * @param {Step} step
 * @returns {string}
 */
export function describeStep(step) {
  switch (step.type) {
    case 'navigate':
      return `${step.cause === 'user' ? 'ページを開く' : 'ページが移動'}：${step.url}`;
    case 'click':
      return `クリック：${step.target.label}`;
    case 'input':
      return step.secret
        ? `入力：${step.target.label}（値は記録していません）`
        : `入力：${step.target.label} ← ${step.value}`;
    case 'select':
      return `選択：${step.target.label} ← ${step.labels.join('、')}`;
    case 'pause':
      return `一時停止${step.note ? `：${step.note}` : ''}`;
    case 'savePdf':
      return `PDF を保存：${step.path ?? DEFAULT_SAVE_PATH}${step.onConflict === 'overwrite' ? '（同じ名前は上書き）' : ''}`;
    case 'extract':
      return `読み取り：${step.target.label} → {{${step.name}}}`;
    case 'wait':
      return `${step.ms / 1000} 秒待つ`;
    case 'if':
      return `条件：「${step.condition.target.label}」が${step.condition.exists ? 'ある' : 'ない'}場合`;
    case 'forEach':
      return `繰り返し：「${step.items.label}」の各行（上限 ${step.max ?? DEFAULT_FOREACH_MAX} 件）`;
  }
}

/**
 * 実行の状態の説明です。サイドパネルの「フローの実行」に表示します。
 * @param {{
 *   flowName: string, status: string, stepIndex: number, total: number, error?: string, note?: string,
 *   items?: number[],
 * }} run 実行の状態（background/runner.js の RunState）
 * @param {Step | undefined} step 実行中、または止まった手順。一時停止中は、次に実行する手順です。
 * @returns {string}
 */
export function runStatusText(run, step) {
  // 繰り返しの中では、何件目の行かを添えます（#6）。
  const item = itemText(run.items);
  const number = `手順 ${run.stepIndex + 1} / ${run.total}${item ? `（${item}）` : ''}`;
  const where = `${number}${step ? `（${describeStep(step)}）` : ''}`;
  switch (run.status) {
    case 'running':
      return `「${run.flowName}」を実行中です。${where}`;
    case 'pausing':
      return `「${run.flowName}」は、実行中の手順が終わった時点で一時停止します。${where}`;
    case 'paused': {
      const next = step ? `（次の手順：${describeStep(step)}）` : '';
      return `「${run.flowName}」は ${number} の前で一時停止しています${next}。${run.note ?? ''}続ける場合は［再開］を押してください。`;
    }
    case 'stopping':
      return `「${run.flowName}」を停止しています。${where}`;
    case 'done':
      return `「${run.flowName}」の実行が完了しました。`;
    case 'stopped':
      return `「${run.flowName}」の実行を停止しました。完了した手順は ${run.total} 件中 ${run.stepIndex} 件です。`;
    case 'halted':
      // 止まった理由（error）に手順の説明が含まれるため、手順の番号だけを示します。
      return `「${run.flowName}」の実行は ${number} で止まりました。${run.error ?? ''}`;
    default:
      return `「${run.flowName}」の実行は ${where} で止まりました。${run.error ?? ''}`;
  }
}

/**
 * 手順の種類の短い名前です。管理画面の手順の一覧で、説明の前に表示します。
 * @param {Step} step
 * @returns {string}
 */
export function stepKindLabel(step) {
  switch (step.type) {
    case 'navigate':
      return '移動';
    case 'click':
      return 'クリック';
    case 'input':
      return '入力';
    case 'select':
      return '選択';
    case 'pause':
      return '一時停止';
    case 'savePdf':
      return 'PDF 保存';
    case 'extract':
      return '読み取り';
    case 'wait':
      return '待機';
    case 'if':
      return '条件';
    case 'forEach':
      return '繰り返し';
  }
}

/** パラメータの種類の名前です。 */
const PARAM_TYPE_LABELS = {
  text: '文字',
  number: '数値',
  select: '選択肢',
  month: '年月',
};

/**
 * 実行時に入力するパラメータの説明です。種類と既定値を、人が読む形にします。
 * @param {import('./params.js').Param} param
 * @returns {string} 例：「年月・既定値は前月」
 */
export function describeParam(param) {
  const type = PARAM_TYPE_LABELS[param.type];
  const choices = param.type === 'select' && param.options ? `（${param.options.join('、')}）` : '';
  if (param.default === undefined || param.default === '') {
    return `${type}${choices}・既定値なし`;
  }
  const value =
    param.default === '@previous-month'
      ? '前月'
      : param.default === '@current-month'
        ? '今月'
        : param.default;
  return `${type}${choices}・既定値は${value}`;
}

/**
 * 日時を「2026/9/25 10:05」の形式にします。
 * @param {string} iso ISO 8601 の日時
 * @returns {string}
 */
export function formatDateTime(iso) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
