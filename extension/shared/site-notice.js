// 記録中に、許可がないサイトへ移動したときの知らせ（#209）の内容を決めます。
// 知らせはサイドパネルの最上部に重ねて表示します。利用者はサイトの画面に集中しているため、サイドパネルの中の
// 小さな変化には気づかないためです。サイトのページの中には、許可がないため何も表示できません。
// chrome.* は使いません。Node.js のテストから読み込むためです。

/** 記録しないと選んだサイトを、同じ記録の間だけ保存する chrome.storage.session のキーです。 */
export const DECLINED_SITES_KEY = 'recordingDeclinedSites';

/**
 * @typedef {object} SiteNotice
 * @property {string} origin 許可がないサイト（オリジン）
 * @property {string} host 表示に使うホスト名。`https://` などを除き、読みやすくします
 * @property {'full' | 'collapsed'} mode 'full' は説明とボタンを出し、'collapsed' は 1 行に畳みます。
 *   ［このサイトは記録しない］を選んだサイトは畳みます
 * @property {boolean} limitReached 記録できるサイトの上限に達しているか。許可しても記録できないため、
 *   許可のボタンの代わりに理由を示します
 * @property {boolean} frame ページに埋め込まれた、画面に見える枠（iframe）のサイトか（#230）。見せ方はページそのものと
 *   同じにし、文言だけ枠であることがわかるようにします
 */

/**
 * 記録中のタブの表示に合わせて、知らせの内容を決めます。知らせが要らない場合は null です。
 * 知らせを出すのは、記録中のタブが、記録を始めたサイト以外の、許可がないサイトのページを表示している場合と、
 * 表示中のページに、許可がない、画面に見える枠がある場合です（#230）。見えない枠は blockedFrames に含まれません。
 * @param {object} state
 * @param {string} state.recordingOrigin 記録を始めたサイト
 * @param {{ origin: string, allowed: boolean, blockedFrames?: string[] } | undefined} state.page 記録中のタブが
 *   表示しているページ
 * @param {string[]} state.extraOrigins 記録を始めたサイトのほかに、手順を記録したサイト
 * @param {string[]} state.declined 同じ記録の間に、記録しないと選んだサイト
 * @param {number} state.maxExtraOrigins 記録を始めたサイトのほかに記録できるサイトの件数
 * @returns {SiteNotice | null}
 */
export function siteNotice({ recordingOrigin, page, extraOrigins, declined, maxExtraOrigins }) {
  if (!page) {
    return null;
  }
  const blockedFrame = page.allowed ? page.blockedFrames?.[0] : undefined;
  const origin = !page.allowed && page.origin !== recordingOrigin ? page.origin : blockedFrame;
  if (origin === undefined) {
    return null;
  }
  return {
    origin,
    host: hostOf(origin),
    mode: declined.includes(origin) ? 'collapsed' : 'full',
    limitReached: !extraOrigins.includes(origin) && extraOrigins.length >= maxExtraOrigins,
    frame: origin === blockedFrame,
  };
}

/**
 * 知らせの文言です。何が起きたか、なぜか、どうすればよいかの順に書きます。
 * 「許可していないため、記録していません」だけでは、急に壊れたと思われたためです。
 * @param {SiteNotice} notice
 * @param {number} maxExtraOrigins
 * @returns {{ title: string, body: string, collapsed: string }}
 */
export function siteNoticeText(notice, maxExtraOrigins) {
  if (notice.frame) {
    const body = notice.limitReached
      ? `記録できるサイトは、記録を始めたサイトのほかに ${maxExtraOrigins} 件までのため、この枠の中の操作は手順に入りません。枠の外の操作は記録しています。`
      : 'この枠の中のサイトはまだ操作の許可をしていないため、枠の中の操作は手順に入りません。枠の外の操作は記録しています。枠の中も記録する場合は、決済などで利用しているサービスのサイトか確かめてから、下のボタンを押し、Chrome の確認で「許可」を選んでください。';
    return {
      title: `このページの枠（${notice.host}）では記録が止まっています`,
      body,
      collapsed: `このページの枠（${notice.host}）は記録していません`,
    };
  }
  const body = notice.limitReached
    ? `記録できるサイトは、記録を始めたサイトのほかに ${maxExtraOrigins} 件までのため、このサイトでの操作は手順に入りません。記録を続ける場合は、記録したサイトのページに戻ってください。`
    : 'このサイトはまだ操作の許可をしていないため、ここでの操作は手順に入りません。記録を続ける場合は、アドレスバーのサイト名が利用しているサービスのものか確かめてから、下のボタンを押し、Chrome の確認で「許可」を選んでください。';
  return {
    title: `${notice.host} では記録が止まっています`,
    body,
    collapsed: `${notice.host} は記録していません`,
  };
}

/**
 * オリジンから、表示に使うホスト名を取り出します。読み取れない場合は、そのまま返します。
 * @param {string} origin
 * @returns {string}
 */
function hostOf(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
