// 在庫の表示です（#251）。URL の v を表示し、later がある場合は、2 秒後に later へ置き換えます。
// 置き換えは、Chrome の翻訳が表示の後に少し遅れて文字を置き換える動きの代わりです。
const query = new URL(location.href).searchParams;
const stock = document.getElementById('stock');
if (stock) {
  stock.textContent = query.get('v') ?? '';
  const later = query.get('later');
  if (later !== null) {
    setTimeout(() => {
      stock.textContent = later;
    }, 2000);
  }
}
