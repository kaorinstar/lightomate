// 購入や申し込みの確定ボタンかどうかを、ボタンの文言から判定します（#29）。
//
// 確定は必ず人が行います。記録時は確定ボタンのクリックを一時停止（pause）の手順に置き換え、
// 実行時はクリックの直前に判定して、確定ボタンであればクリックせずに実行を終了します。
//
// 表示の文字は、Chrome の翻訳で置き換わります（#97）。翻訳で確定を表す語が一覧にない言い回しに変わると、
// 文言だけでは検出できず、確定まで進むおそれがあります。そのため、翻訳で変わらない手がかり（要素の id、
// name、class、リンク先、フォームの送信先、記録したセレクター）に含まれる英語の語でも判定します。
//
// 文言で判定する方法には限界があります。画像だけで説明のないボタンや、独自の文言のボタンは
// 検出できません。逆に、確定ではないボタンを確定ボタンと判定することがありますが、
// 止まるだけで購入はされないため、安全側の誤りとして許容します。

/**
 * 確定ボタンの文言に含まれる語です。表記の揺れを揃えてから比べるため、空白を含めずに書きます。
 * 「購入手続きへ進む」のように、確定の前の画面へ進むだけのボタンは含めません。
 */
const CONFIRM_WORDS = [
  '注文を確定',
  '注文する',
  '購入する',
  '購入を確定',
  '今すぐ購入',
  '今すぐ買う',
  '支払う',
  '支払いを確定',
  '決済する',
  '申し込む',
  '申込む',
  // 英語のボタンを Chrome の翻訳で日本語にした場合に出やすい言い回しです（#97）。翻訳の結果は変わることが
  // あるため、翻訳で変わらない手がかり（下記の findConfirmKey）が主な対策で、これは補助です。
  '購入を完了',
  '購入を確認',
  // 「Confirm order」の翻訳です。「ご注文を確認する」のように確認の画面へ進むボタンにも一致しますが、
  // 止まるだけのため、安全側の誤りとして許容します。「注文内容を確認」には一致しません。
  '注文を確認',
  '注文を完了',
  '注文を送信',
  '支払いを完了',
  'placeyourorder',
  'placeorder',
  'buynow',
  'paynow',
  'completepurchase',
  'confirmpurchase',
  'confirmorder',
  'submitorder',
];

/**
 * 比べる前に、表記の揺れを揃えます。全角の英数字を半角に、大文字を小文字にし、空白を除きます。
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/**
 * 翻訳で変わらない手がかりと比べる語です。英語の語だけを使います。属性の値は英語で書かれることが多く、
 * 日本語の語と比べても一致しないためです。
 */
const KEY_WORDS = CONFIRM_WORDS.filter((word) => /^[a-z]+$/.test(word));

/**
 * 翻訳で変わらない手がかりを比べる前に、表記を揃えます。英数字以外の文字を除きます。
 * place-order、place_order、placeOrder を、同じ placeorder として比べるためです。
 * @param {string} key
 * @returns {string}
 */
export function normalizeKey(key) {
  return key
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * 翻訳で変わらない手がかりのうち、確定を表す語を含むものを探します（#97）。
 * @param {string[]} keys 要素の id、name、class、リンク先、フォームの送信先、記録したセレクターなど
 * @returns {string | undefined} 確定を表す語を含む手がかり。含まない場合は undefined です。
 */
export function findConfirmKey(keys) {
  return keys.find((key) => {
    const normalized = normalizeKey(key);
    return KEY_WORDS.some((word) => normalized.includes(word));
  });
}

/**
 * クリックする要素が確定ボタンかを判定し、止める理由の説明に使う文言を返します（#97）。
 * 文言で判定できた場合はその文言を、翻訳で変わらない手がかりで判定できた場合は手順の説明（label）を
 * 返します。確定ボタンでない場合は undefined です。
 * @param {string[]} texts 要素の表示文字列、aria-label、title、value、画像の alt と、記録時の文言
 * @param {string[]} keys 翻訳で変わらない手がかり
 * @param {string} label 手順の説明
 * @returns {string | undefined}
 */
export function findConfirm(texts, keys, label) {
  const text = findConfirmText(texts);
  if (text !== undefined) {
    return text;
  }
  const key = findConfirmKey(keys);
  if (key === undefined) {
    return undefined;
  }
  return label.trim() ? label : key;
}

/**
 * 要素の文言のうち、確定を表す語を含むものを探します。
 * @param {string[]} texts 要素の表示文字列、aria-label、title、value、画像の alt など
 * @returns {string | undefined} 確定を表す語を含む文言。含まない場合は undefined です。
 */
export function findConfirmText(texts) {
  return texts.find((text) => {
    const normalized = normalizeText(text);
    return CONFIRM_WORDS.some((word) => normalized.includes(word));
  });
}

/**
 * 一時停止の手順に記録する、止まる理由の説明です。
 * @param {string} text 確定を表す語を含む文言
 * @returns {string}
 */
export function confirmPauseNote(text) {
  return `確定ボタン「${text.trim().slice(0, 50)}」の手前で止まります。内容を確認し、確定は手で行ってください。`;
}

/** @typedef {import('./flow.js').Step} Step */

/**
 * 記録した手順が確定ボタンのクリックであれば、一時停止の手順に置き換えます。
 * @param {Step} step 記録した手順
 * @param {string[]} texts クリックした要素の文言。届かなかった場合は、手順の説明と表示文字列で判定します。
 * @param {string[]} [keys] クリックした要素の、翻訳で変わらない手がかり（#97）。記録したセレクターも加えて判定します
 * @returns {{ step: Step, confirmText?: string }} 置き換えた場合は、判定に使った文言を confirmText で返します。
 */
export function guardRecordedStep(step, texts, keys = []) {
  if (step.type !== 'click') {
    return { step };
  }
  const confirmText = findConfirm(
    [...texts, step.target.label, ...(step.target.text ? [step.target.text] : [])],
    [...keys, ...step.target.selectors],
    step.target.label,
  );
  return confirmText
    ? { step: { type: 'pause', note: confirmPauseNote(confirmText) }, confirmText }
    : { step };
}
