// リリース用ワークフロー（.github/workflows/release.yml）から呼び出し、リリースの内容を確認します。
//
//   node scripts/release-notes.js v0.1.0
//
// タグが manifest.json の version と一致し、version.md にタグと同じ見出しの節があれば、
// その節の本文を標準出力に書き出します。どちらかを満たさない場合は、理由を表示して失敗します。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * タグが manifest.json の version と一致するかを確認します。
 * タグは先頭に v を付けた vMAJOR.MINOR.PATCH の形式です（CLAUDE.md の「リリース」）。
 *
 * @param {string} tag
 * @param {string} manifestVersion
 * @returns {string | null} 一致しない場合は理由、一致する場合は null
 */
export function checkTag(tag, manifestVersion) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    return `タグ ${tag} が vMAJOR.MINOR.PATCH の形式ではありません。`;
  }
  if (tag.slice(1) !== manifestVersion) {
    return `タグ ${tag} と manifest.json の version（${manifestVersion}）が一致しません。`;
  }
  return null;
}

/**
 * version.md から、タグと同じ見出し（## v0.1.0）の節の本文を取り出します。
 * 節がない場合と、本文が空の場合は null を返します。
 *
 * @param {string} markdown
 * @param {string} tag
 * @returns {string | null}
 */
export function extractReleaseNotes(markdown, tag) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${tag}`);
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##? /.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return body === '' ? null : body;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2] ?? '';
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('extension/manifest.json', root), 'utf8'));
  const problem = checkTag(tag, manifest.version);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  const notes = extractReleaseNotes(readFileSync(new URL('version.md', root), 'utf8'), tag);
  if (notes === null) {
    console.error(
      `version.md に「## ${tag}」の節がないか、本文が空です。` +
        '「## Unreleased」の見出しをバージョン番号に変更してから、リリースを作成してください。',
    );
    process.exit(1);
  }
  console.log(notes);
}
