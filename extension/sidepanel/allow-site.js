// 記録中に許可がないサイトへ移動したときに開く、許可を求める小さい窓です（#209）。
// 窓は Service Worker（background/recording.js）が開き、許可を求めるサイトを URL の origin で渡します。
// 許可を得た後は、サイドパネルの［このサイトを許可して記録］と同じ処理で、そのページの記録を始めます。

import { requestPermission } from '../common/permissions.js';
import { followColorScheme, showNotice } from '../shared/ui.js';

followColorScheme(document.documentElement, matchMedia('(prefers-color-scheme: dark)'));

const text = /** @type {HTMLElement} */ (document.getElementById('allow-site-text'));
const allow = /** @type {HTMLButtonElement} */ (document.getElementById('allow-site'));
const skip = /** @type {HTMLButtonElement} */ (document.getElementById('allow-site-skip'));
const notice = /** @type {HTMLElement} */ (document.getElementById('allow-site-notice'));

/**
 * URL で渡されたサイトです。http と https のサイト（オリジン）以外は受け付けません。
 * @returns {string}
 */
function siteFromUrl() {
  const value = new URLSearchParams(location.search).get('origin') ?? '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value ? value : '';
  } catch {
    return '';
  }
}

const origin = siteFromUrl();

if (origin) {
  text.textContent = `記録中のタブで ${origin} を開きました。このサイトは許可していないため、操作を記録していません。このサイトでの操作も記録する場合は、アドレスバーのサイト名が利用しているサービスのものか確かめてから、［このサイトを許可して記録］を押してください。`;
} else {
  allow.disabled = true;
  showNotice(notice, '許可を求めるサイトがわかりません。この窓を閉じてください。', 'error');
}

allow.addEventListener('click', async () => {
  showNotice(notice, '');
  // 許可を求める処理は、ボタンを押した直後に呼び出す必要があります。この前に待ち時間を入れないでください。
  const denied = await requestPermission(origin);
  if (denied) {
    showNotice(notice, denied, 'error');
    return;
  }
  const response = await chrome.runtime.sendMessage({ kind: 'recording/allowOrigin', origin });
  if (!response?.ok) {
    showNotice(notice, response?.error ?? 'このサイトでは記録できません。', 'error');
    return;
  }
  window.close();
});

skip.addEventListener('click', () => {
  window.close();
});
