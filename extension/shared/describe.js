// 手順を、人が読むための 1 行の説明にします。サイドパネルと設定画面で使います。

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
