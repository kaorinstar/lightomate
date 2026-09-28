// URL の n の値を、領収書の番号として表示します。
document.getElementById('number').textContent = new URLSearchParams(location.search).get('n');
