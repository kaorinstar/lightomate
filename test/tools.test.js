import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const toolsDir = new URL('../tools/', import.meta.url);

test('Windows で実行するファイルは、すべての行が CRLF で終わる', () => {
  // GitHub の［Download raw file］はリポジトリに保存した内容をそのまま返します。LF の行が混ざると、
  // 利用者が受け取るファイルも LF になり、コマンドプロンプトが正しく読めない場合があります（#56）。
  const files = readdirSync(toolsDir).filter((name) => /\.(bat|cmd|ps1)$/i.test(name));
  assert.ok(files.length > 0);
  for (const name of files) {
    const text = readFileSync(new URL(name, toolsDir), 'latin1');
    const bareLf = text.split('\r\n').findIndex((line) => line.includes('\n'));
    assert.equal(bareLf, -1, `${name} の ${bareLf + 1} 行目付近に、CR のない改行があります。`);
  }
});
