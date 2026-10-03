// iframe の中の入力欄とボタンを持つ、お支払いの画面です（#20）。
// URL の frame に、埋め込むページの URL を指定します。別のポートを指定すると、別のサイトの iframe になります。
// count に 2 を指定すると、同じ iframe を 2 つ埋め込みます。iframe の URL には、読み込むたびに変わる値を ? の後に
// 付けます。決済の iframe と同じく、実行時の URL が記録時と異なる状態を再現するためです。
// iframe の［確認へ］が押されると、iframe から届いた名前を付けて、完了のページへ移動します。

const params = new URLSearchParams(location.search);
const source = params.get('frame') ?? 'frame-card.html';
const count = Number(params.get('count') ?? '1');
for (let index = 0; index < count; index += 1) {
  const frame = document.createElement('iframe');
  const url = new URL(source, location.href);
  url.searchParams.set('session', String(Math.random()).slice(2));
  frame.src = url.href;
  frame.title = 'カード情報';
  frame.style.cssText = 'width: 360px; height: 160px; border: 1px solid #888;';
  document.getElementById('frames')?.append(frame);
}

window.addEventListener('message', (event) => {
  if (event.data?.kind === 'frame-card/submit') {
    location.href = `done.html?${new URLSearchParams({ holder: String(event.data.holder) })}`;
  }
});
