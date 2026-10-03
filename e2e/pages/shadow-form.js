// Shadow DOM の部品で作った申し込みの画面です（#20）。
// 開いた Shadow DOM の部品 lm-card の中に、名前の入力欄と、閉じた Shadow DOM の部品 lm-pay を置きます。
// lm-pay の中には、備考の入力欄と［送信］のボタンがあります。閉じた Shadow DOM の中は、ページのスクリプトからも
// 見えないため、テストが押す位置を得られるよう、要素の位置を返す関数（lmRect）をページに置きます。
// URL に translate=1 がある場合は、Chrome の翻訳と同じく、表示の後に部品の中の文字を置き換えます。

/** @type {ShadowRoot | undefined} */
let payRoot;

class LmPay extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<label>備考 <input name="note" /></label> <button type="button">送信</button>';
    root.querySelector('button').addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('lm-submit', { bubbles: true, composed: true }));
    });
    payRoot = root;
  }

  get note() {
    return payRoot?.querySelector('input')?.value ?? '';
  }
}

class LmCard extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<p><label>名前 <input name="name" /></label></p><lm-pay></lm-pay>';
    root.addEventListener('lm-submit', () => {
      const name = root.querySelector('input')?.value ?? '';
      const note = /** @type {LmPay} */ (root.querySelector('lm-pay')).note;
      location.href = `done.html?${new URLSearchParams({ name, note })}`;
    });
  }
}

customElements.define('lm-pay', LmPay);
customElements.define('lm-card', LmCard);

if (new URLSearchParams(location.search).has('translate')) {
  setTimeout(() => {
    const cardRoot = document.querySelector('lm-card')?.shadowRoot;
    for (const root of [cardRoot, payRoot]) {
      for (const label of root?.querySelectorAll('label') ?? []) {
        label.firstChild.textContent = label.firstChild.textContent === '名前 ' ? 'Name ' : 'Note ';
      }
    }
    const button = payRoot?.querySelector('button');
    if (button) {
      button.textContent = 'Send';
    }
  }, 300);
}

/**
 * 閉じた Shadow DOM の中の要素の、画面上の中心の位置を返します。
 * @param {'note' | 'button'} which
 */
window.lmRect = (which) => {
  const element = payRoot?.querySelector(which === 'note' ? 'input' : 'button');
  const rect = element?.getBoundingClientRect();
  return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
};
