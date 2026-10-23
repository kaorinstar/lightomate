/**
 * PreToolUse hook: blocks Bash commands that put `cd` and `git` in one compound command.
 *
 * Claude Code asks for approval every time a compound command changes directory and then runs git,
 * because the git hooks of the target directory could run. Written rules did not stop it, so this hook
 * rejects the command before it runs and tells the model how to rewrite it.
 *
 * Exit codes: 2 = block (reason on stderr), 0 = allow. Any parse error allows the command.
 */

import { pathToFileURL } from "node:url";

const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;

const CD_COMMANDS = new Set(["cd", "pushd"]);
const GIT_COMMAND = "git";
// 区切りの直後に来ても、コマンド名ではない語。
const SHELL_KEYWORDS = new Set(["then", "do", "else", "{", "!", "time", "if", "while", "until"]);

export const HELP = [
  "cd と git を同じコマンドに並べないでください（Claude Code が毎回確認を出すため）。次のように書き直してください。",
  "- git は git -C <パス> ... で書く。",
  "- cat・sed・tail などは、ファイルを絶対パスで渡す。",
  "- npm は npm --prefix <パス> ...、docker compose は docker compose --project-directory <パス> ...、node は node <パス>/x.mjs にする。",
  "- 作業ディレクトリが必要な作業は、cd <パス> && ... を、git を含まない別のコマンドとして実行する。",
].join("\n");

/**
 * Splits a shell command into simple commands, skipping quoted text and heredoc bodies.
 *
 * @param {string} command The raw Bash command.
 * @returns {string[]} The simple commands, trimmed and non-empty.
 */
export function splitCommands(command) {
  const segments = [];
  let current = "";
  let quote = "";
  let depth = 0;
  // "$( ... )" の中では引用符を一度抜ける。閉じたときに戻る引用符と括弧の深さを積む。
  const substitutions = [];
  const heredocs = [];
  let index = 0;

  const flush = () => {
    const trimmed = current.trim();
    if ("" !== trimmed) {
      segments.push(trimmed);
    }
    current = "";
  };

  while (index < command.length) {
    const char = command[index];

    if ("" !== quote) {
      // 引用符の中は区切りとして扱わない。中身は判定に使わないので捨てる。
      if ("\\" === char && '"' === quote) {
        index += 2;
        continue;
      }
      if ('"' === quote && "$" === char && "(" === command[index + 1]) {
        // 二重引用符の中のコマンド置換は実行されるので、中身も判定に使う。
        substitutions.push({ quote, depth });
        quote = "";
        depth += 1;
        flush();
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = "";
      }
      current += "_";
      index += 1;
      continue;
    }

    if ("\\" === char) {
      current += command.slice(index, index + 2);
      index += 2;
      continue;
    }

    if ("'" === char || '"' === char) {
      quote = char;
      current += "_";
      index += 1;
      continue;
    }

    if ("<" === char && "<" === command[index + 1] && "<" !== command[index + 2]) {
      // ヒアドキュメントの終わりの印を覚える。本文は次の改行のあとで読み飛ばす。
      const match = /^<<(-?)\s*(['"]?)([A-Za-z0-9_]+)\2/.exec(command.slice(index));
      if (null !== match) {
        heredocs.push({ delimiter: match[3], allowTabs: "-" === match[1] });
        current += "_";
        index += match[0].length;
        continue;
      }
    }

    if ("\n" === char) {
      flush();
      index += 1;
      while (0 < heredocs.length) {
        const { delimiter, allowTabs } = heredocs.shift();
        while (index < command.length) {
          const lineEnd = command.indexOf("\n", index);
          const end = -1 === lineEnd ? command.length : lineEnd;
          const line = command.slice(index, end);
          index = end + 1;
          if ((allowTabs ? line.replace(/^\t+/, "") : line) === delimiter) {
            break;
          }
        }
      }
      continue;
    }

    if ("(" === char) {
      depth += 1;
      flush();
      index += 1;
      continue;
    }

    if (")" === char) {
      depth = Math.max(0, depth - 1);
      flush();
      index += 1;
      const outer = substitutions.at(-1);
      if (undefined !== outer && outer.depth === depth) {
        substitutions.pop();
        quote = outer.quote;
      }
      continue;
    }

    if (";" === char || "&" === char || "|" === char) {
      flush();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  flush();
  return segments;
}

/**
 * Returns the command name of a simple command, skipping variable assignments and shell keywords.
 *
 * @param {string} segment A simple command.
 * @returns {string} The command name, or an empty string.
 */
export function commandName(segment) {
  const words = segment.split(/\s+/);
  for (const word of words) {
    if (SHELL_KEYWORDS.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      continue;
    }
    return word;
  }
  return "";
}

/**
 * Tells whether a command changes directory and runs git in the same compound command.
 *
 * @param {string} command The raw Bash command.
 * @returns {boolean} True when the command must be blocked.
 */
export function shouldBlock(command) {
  const names = splitCommands(command).map(commandName);
  const hasCd = names.some((name) => CD_COMMANDS.has(name));
  const hasGit = names.some((name) => GIT_COMMAND === name);
  return hasCd && hasGit;
}

/**
 * Reads the hook input from stdin and returns the exit code.
 *
 * @returns {Promise<number>} The exit code for Claude Code.
 */
async function main() {
  try {
    let raw = "";
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
    const input = JSON.parse(raw);
    if ("Bash" !== input?.tool_name) {
      return EXIT_ALLOW;
    }
    const command = input?.tool_input?.command;
    if ("string" !== typeof command || !shouldBlock(command)) {
      return EXIT_ALLOW;
    }
    process.stderr.write(`${HELP}\n`);
    return EXIT_BLOCK;
  } catch {
    // 読めない入力で作業を止めない。止めるのは、確かに cd と git が並んだときだけにする。
    return EXIT_ALLOW;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
