#!/bin/sh
# 一時的なリポジトリに対して check-main.sh の動作を確認します。
#
# この確認は 2 方向に誤る可能性があります。拒否すべき push を見逃す誤りと、push では
# ないものを拒否する誤りです。複製元では後者が実際に起きました。ブランチの削除や、
# 検索パターンにその語を含むコマンドが拒否されました。本来止める必要のない作業を止める
# 確認は、利用者に確認を回避する習慣をつけさせます。
#
# そのため、入力される理由のある git push の形式をすべて下に列挙し、それぞれの期待動作を
# 記載しています。判定処理を変更する前に、新しい形式をここへ追加してください。
#
# 実行方法:
#
#     sh .claude/hooks/check-main.test.sh
#
# 一時ディレクトリの下に専用のリポジトリを作成します。ネットワークは不要で、そのディレクトリ
# 以外には変更を加えません。すべてのケースが成功すると終了コード 0 で終了します。

set -u

HOOK=$(cd "$(dirname "$0")" && pwd)/check-main.sh
[ -f "$HOOK" ] || { echo "同じディレクトリに check-main.sh がありません"; exit 1; }

WORKDIR=$(mktemp -d) || exit 1
trap 'rm -rf "$WORKDIR"' EXIT INT TERM

FAILURES=0
CASES=0

# 1 つのリポジトリの複製を 2 つ作ります。"work" は作業中のブランチ、"other" は先に main へ
# 反映したほかのセッションを表します。
build_repository() {
    rm -rf "$WORKDIR/origin.git" "$WORKDIR/work" "$WORKDIR/other"
    (
        cd "$WORKDIR" || exit 1
        git init -q --bare -b main origin.git
        git init -q -b main work
        cd work || exit 1
        git config user.email test@example.com
        git config user.name test
        git config push.negotiate false
        mkdir -p src .claude/hooks
        printf 'shared\n' >src/shared.txt
        cp "$HOOK" .claude/hooks/check-main.sh
        git add -A
        git commit -qm base
        git remote add origin ../origin.git
        git push -q -u origin main
        git checkout -qb feat/x
        printf 'mine\n' >>src/shared.txt
        git commit -qam "work on this branch"
        cd .. || exit 1
        git clone -q origin.git other
        cd other || exit 1
        git config user.email test@example.com
        git config user.name test
        git config push.negotiate false
        printf 'theirs\n' >>src/shared.txt
        git commit -qam "work that reached main first"
        git push -q origin main
    ) >/dev/null 2>&1
}

# $1 ケースの説明、$2 期待する終了コード、$3 セッションが実行するコマンド
expect_exit() {
    CASES=$((CASES + 1))
    rm -f "$WORKDIR/work/.git/claude-main-check"
    actual=$(
        cd "$WORKDIR/work" || exit 1
        printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$3" \
            | sh .claude/hooks/check-main.sh PreToolUse >/dev/null 2>&1
        echo $?
    )
    if [ "$actual" = "$2" ]; then
        printf 'ok   %s\n' "$1"
    else
        printf 'FAIL %s（期待する終了コード %s、実際 %s）\n' "$1" "$2" "$actual"
        FAILURES=$((FAILURES + 1))
    fi
}

# $1 ケースの説明、$2 "silent"（出力なし）または "speaks"（出力あり）、$3 フックへの引数
expect_output() {
    CASES=$((CASES + 1))
    rm -f "$WORKDIR/work/.git/claude-main-check"
    out=$(cd "$WORKDIR/work" && sh .claude/hooks/check-main.sh $3 2>/dev/null)
    if [ "$2" = "silent" ] && [ -z "$out" ]; then
        printf 'ok   %s\n' "$1"
    elif [ "$2" = "speaks" ] && [ -n "$out" ]; then
        printf 'ok   %s\n' "$1"
    else
        printf 'FAIL %s（期待 %s）\n' "$1" "$2"
        FAILURES=$((FAILURES + 1))
    fi
}

echo "ブランチが main より 1 コミット遅れている状態です。"
build_repository

echo
echo "このブランチの作業を送る push は拒否します:"
expect_exit "通常の push" 2 "git push -u origin feat/x"
expect_exit "引数なしの push" 2 "git push"
expect_exit "別のコマンドに続く push" 2 "git status \&\& git push"
expect_exit "参照先を明示した push" 2 "git push origin HEAD:refs/heads/feat/x"

echo
echo "作業を送らない push は許可します:"
expect_exit "ブランチの削除" 0 "git push origin --delete claude/old"
expect_exit "-d による削除" 0 "git push origin -d claude/old"
expect_exit "refspec による削除" 0 "git push origin :claude/old"
expect_exit "タグの push" 0 "git push origin --tags"
expect_exit "試行（dry run）" 0 "git push --dry-run origin feat/x"

echo
echo "push ではないコマンドは、内容にかかわらず許可します:"
expect_exit "その語の検索" 0 "grep -rn 'git push' docs/"
expect_exit "push に言及するメッセージ" 0 "echo 'remember to git push later'"
expect_exit "無関係のコマンド" 0 "git status"
expect_exit "名前が似ているだけのコマンド" 0 "git pushall"

echo
echo "報告の出力:"
expect_output "遅れているときは出力する" speaks ""
expect_output "セッション開始時に出力する" speaks "SessionStart"

echo
echo "報告することがないときは出力しません:"
(cd "$WORKDIR/work" && git checkout -q main) >/dev/null 2>&1
expect_output "基準ブランチ上" silent ""
(cd "$WORKDIR/work" && git checkout -q feat/x && git merge -q --no-edit FETCH_HEAD 2>/dev/null || git checkout -q --theirs . 2>/dev/null; git add -A >/dev/null 2>&1; git commit -qm merged >/dev/null 2>&1) >/dev/null 2>&1
expect_output "main をマージした後" silent ""
build_repository
(cd "$WORKDIR/work" && git checkout -q --detach HEAD) >/dev/null 2>&1
expect_output "detached HEAD の状態" silent ""
build_repository
(cd "$WORKDIR/work" && git remote rename origin upstream) >/dev/null 2>&1
expect_output "origin リモートがない状態" silent ""

echo
build_repository
CASES=$((CASES + 1))
first=$(cd "$WORKDIR/work" && printf '{"tool_input":{"command":"ls"}}' | sh .claude/hooks/check-main.sh PreToolUse 2>/dev/null)
second=$(cd "$WORKDIR/work" && printf '{"tool_input":{"command":"ls"}}' | sh .claude/hooks/check-main.sh PreToolUse 2>/dev/null)
if [ -n "$first" ] && [ -z "$second" ]; then
    echo "ok   2 回の Bash 呼び出しの間で確認間隔が守られる"
else
    echo "FAIL 2 回の Bash 呼び出しの間で確認間隔が守られる"
    FAILURES=$((FAILURES + 1))
fi

CASES=$((CASES + 1))
case "$first" in
    '{'*'}') echo "ok   フックの出力が JSON オブジェクトである" ;;
    *)
        echo "FAIL フックの出力が JSON オブジェクトである"
        FAILURES=$((FAILURES + 1))
        ;;
esac

echo
if [ "$FAILURES" = "0" ]; then
    printf '%s ケース、すべて成功しました。\n' "$CASES"
    exit 0
fi
printf '%s ケース中 %s ケースが失敗しました。\n' "$CASES" "$FAILURES"
exit 1
