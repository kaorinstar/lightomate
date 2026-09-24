// 記録中・実行中であることを示す枠と文字を、ページの最前面に表示します（#13）。
//
// content script は ES モジュールとして読み込めないため、通常のスクリプトとして読み込みます。
// 同じページに 2 回読み込まれても誤りにならないよう、最上位には関数の宣言だけを置きます。

/* exported showStatusOverlay */

/**
 * 指定した色の枠で画面を囲み、左上に文字を表示します。
 *
 * ページの CSS やスクリプトの影響を受けないよう、閉じた Shadow DOM の中に置きます。
 * クリックは枠を通り抜けるため、ページの操作を妨げず、枠への操作が記録されることもありません。
 * 印刷用の表示では非表示にし、PDF に写り込まないようにします。
 * @param {string} text 左上に表示する文字
 * @param {string} color 枠と文字の背景の色
 * @returns {HTMLElement} 表示を消すときに remove() を呼ぶ要素
 */
function showStatusOverlay(text, color) {
  const host = document.createElement('lightomate-status');
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { pointer-events: none; }
    .frame {
      position: fixed; inset: 0; box-sizing: border-box;
      border: 4px solid ${color}; pointer-events: none;
    }
    .badge {
      position: fixed; top: 8px; left: 8px; padding: 4px 10px; border-radius: 4px;
      background: ${color}; color: #fff; pointer-events: none;
      font: bold 13px/1.4 system-ui, sans-serif;
    }
    /* 要素に直接指定したスタイル（all: initial）より優先させるため、!important を付けます。 */
    @media print { :host { display: none !important; } }
  `;
  const frame = document.createElement('div');
  frame.className = 'frame';
  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = text;

  shadow.append(style, frame, badge);
  document.documentElement.append(host);
  return host;
}
