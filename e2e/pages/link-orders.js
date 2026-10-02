// ログインした状態の代わりに、ログインの Cookie を付けます（#172）。SameSite=Strict にし、ほかのサイトからの
// 要求には付かない、厳しい条件の Cookie でも保存できるかを確かめます。
document.cookie = 'lm_auth=1; path=/; SameSite=Strict';
