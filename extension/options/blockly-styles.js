// Blockly が見た目の指定（<style>）を head に入れる操作を受け取り、CSSOM のスタイルシートとして適用します（#9）。
// 拡張機能の CSP（default-src 'self'）は <style> を止めますが、CSSOM による指定は止めません。
// Blockly より先に読み込む必要があるため、ES モジュールではなく通常のスクリプトとして読み込みます。
// head に <style> を入れるのは Blockly だけです。ほかの要素は、そのまま head に入れます。
(() => {
  const head = document.head;

  /**
   * <style> なら、その中身をスタイルシートとして適用し、true を返します。
   * @param {unknown} node
   * @returns {boolean}
   */
  const adopt = (node) => {
    if (!(node instanceof HTMLStyleElement)) {
      return false;
    }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(node.textContent ?? '');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return true;
  };

  const prepend = head.prepend.bind(head);
  const append = head.append.bind(head);
  const appendChild = head.appendChild.bind(head);
  const insertBefore = head.insertBefore.bind(head);

  /** @param {(Node | string)[]} nodes */
  head.prepend = (...nodes) => prepend(...nodes.filter((node) => !adopt(node)));
  /** @param {(Node | string)[]} nodes */
  head.append = (...nodes) => append(...nodes.filter((node) => !adopt(node)));
  head.appendChild = /** @type {typeof head.appendChild} */ (
    (/** @type {Node} */ node) => (adopt(node) ? node : appendChild(node))
  );
  head.insertBefore = /** @type {typeof head.insertBefore} */ (
    (/** @type {Node} */ node, /** @type {Node | null} */ child) =>
      adopt(node) ? node : insertBefore(node, child)
  );
})();
