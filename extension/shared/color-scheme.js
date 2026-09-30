// 明るい表示と暗い表示を、最初の描画より前に OS の設定に合わせます（#148）。
// 画面の ES モジュールは HTML の読み込みが終わった後に実行されるため、そこで設定すると、暗い表示の OS でも
// 一瞬明るい表示で描画されます。そのため、head の先頭で通常のスクリプトとして読み込みます。
// CSP（script-src 'self'）により HTML に直接書いたスクリプトは実行できないため、別のファイルにしています。
// OS の設定が途中で変わった場合の追従は、各画面で ui.js の followColorScheme が行います。
document.documentElement.setAttribute(
  'data-bs-theme',
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
);
