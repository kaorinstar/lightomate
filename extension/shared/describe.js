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
