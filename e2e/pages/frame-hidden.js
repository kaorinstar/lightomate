// 画面に見えない枠と、後から表示される枠を持つ、お支払いの画面です（#230）。
// URL の frame に、埋め込むページの URL を指定します。別のサイトを指定すると、許可がないサイトの枠になります。
// - 計測用の枠：1×1px で、常に見えません。広告や計測のための枠を再現します。
// - 決済の枠：最初は非表示で、［カードで支払う］を押すと表示されます。

const params = new URLSearchParams(location.search);
const source = params.get('frame') ?? 'frame-card.html';
const container = document.getElementById('frames');

const tracker = document.createElement('iframe');
tracker.src = new URL(source, location.href).href;
tracker.title = '計測';
tracker.style.cssText = 'width: 1px; height: 1px; border: 0;';
container?.append(tracker);

const card = document.createElement('iframe');
card.src = new URL(source, location.href).href;
card.title = 'カード情報';
card.style.cssText = 'display: none; width: 360px; height: 160px; border: 1px solid #888;';
container?.append(card);

document.getElementById('show')?.addEventListener('click', () => {
  card.style.display = 'block';
});
