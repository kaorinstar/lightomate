import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { shouldBlock } from "./block-cd-git.mjs";

const HOOK = fileURLToPath(new URL("./block-cd-git.mjs", import.meta.url));

const BLOCKED = [
  "cd x && git status",
  "cd x; git log",
  "(cd x; git log)",
  "pushd x && git status",
  "cd /c/repo/.worktrees/a; git checkout -- a.php; git status --short; git add b.mjs && git commit -q -F - <<'EOF'\nmsg\nEOF\ngit -C . fetch -q; git log --oneline HEAD..origin/main | wc -l",
  "cd x\ngit status",
  "cd x && FOO=1 git status",
  "cd x; docker compose up -d; node a.mjs; git add a",
  'cd x && echo "ahead: $(git log origin/main..b --oneline | wc -l)"',
  "cd x && echo $(git status --short | wc -l)",
];

const ALLOWED = [
  "git -C x status",
  "cd x && node y.mjs",
  "cd x && docker compose up -d",
  "git -C x commit -F - <<'EOF'\ncd x; git status\nEOF",
  "git -C x commit -F - <<-EOF\n\tcd x; git status\n\tEOF",
  'echo "cd x; git status"',
  "echo 'cd x && git log'",
  'R="C:/r"; gh pr merge 88 --merge 2>&1 | tail -1; git -C "$R" status -sb | head -1; git -C "$R" pull -q --ff-only',
  "grep -r cdgit .; git status",
  'cd x && grep -n "git clone" a.sh',
  'cd x && echo "$(date) (git)"; ls',
  "cd x && cat > a.txt <<'EOF'\ngit status\nEOF",
  "ls; gitk",
  "",
];

for (const command of BLOCKED) {
  test(`blocks: ${JSON.stringify(command)}`, () => {
    assert.equal(shouldBlock(command), true);
  });
}

for (const command of ALLOWED) {
  test(`allows: ${JSON.stringify(command)}`, () => {
    assert.equal(shouldBlock(command), false);
  });
}

/**
 * Runs the hook entry point with the given stdin.
 *
 * @param {string} stdin The raw hook input.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} The process result.
 */
function runHook(stdin) {
  return spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8" });
}

test("entry: blocks with exit 2 and help on stderr", () => {
  const result = runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: "cd x; git status" } }));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /git -C/);
});

test("entry: allows a command without git", () => {
  const result = runHook(JSON.stringify({ tool_name: "Bash", tool_input: { command: "cd x && node y.mjs" } }));
  assert.equal(result.status, 0);
});

test("entry: allows other tools", () => {
  const result = runHook(JSON.stringify({ tool_name: "Edit", tool_input: { command: "cd x; git status" } }));
  assert.equal(result.status, 0);
});

test("entry: allows broken JSON", () => {
  const result = runHook("{not json");
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});
