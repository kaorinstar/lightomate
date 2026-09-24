#!/bin/sh
# 作業中のブランチより基準ブランチ（main）が先に進んでいないかを報告します。
#
# このリポジトリでは複数のセッションが同時に作業することが多く、ブランチの作業中にも main
# が更新されます。このスクリプトはその確認だけを行います。取得・比較・報告をして終了し、
# マージも作業ツリーの変更も行いません。マージ自体は /sync-main で行います。
#
# 使い方:
#   sh .claude/hooks/check-main.sh              報告を表示して終了コード 0 で終了
#   sh .claude/hooks/check-main.sh SessionStart 報告をフックの追加情報として出力
#   sh .claude/hooks/check-main.sh PreToolUse   同上。ただし 15 分に 1 回まで。
#                                               main が未マージの間は push を拒否
#
# 環境変数:
#   CLAUDE_MAIN_BRANCH           比較する基準ブランチ（既定値: main）
#   CLAUDE_MAIN_CHECK_INTERVAL   PreToolUse での確認間隔の秒数（既定値: 900）

set -u

EVENT="${1:-}"
BASE_BRANCH="${CLAUDE_MAIN_BRANCH:-main}"
INTERVAL="${CLAUDE_MAIN_CHECK_INTERVAL:-900}"

# 想定外の状況では、作業を止めずに何もせず終了します。
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
STATE="$GIT_DIR/claude-main-check"

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
[ "$BRANCH" = "$BASE_BRANCH" ] && exit 0
[ "$BRANCH" = "HEAD" ] && exit 0

# フックへの入力は標準入力の JSON で渡されます。jq がない環境もあるため、
# その場合は必要な 1 項目だけを sed で読み取ります。
extract_command() {
    if command -v jq >/dev/null 2>&1; then
        OUT=$(printf '%s' "$1" | jq -r '.tool_input.command // empty' 2>/dev/null)
        if [ -n "$OUT" ]; then
            printf '%s' "$OUT"
            return
        fi
    fi
    printf '%s' "$1" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

# git push を実際に実行するコマンドだけを push とみなします。その語を含むだけのコマンド
# （検索やメッセージ）は push ではなく、拒否すると本来守る必要のない作業を止めてしまいます。
# 連結されたコマンドは 1 つずつ判定します。
is_push() {
    printf '%s' "$1" \
        | awk '{ gsub(/[;|&]/, "\n"); print }' \
        | grep -Eq '^[[:space:]]*git[[:space:]]+push([^a-zA-Z0-9_-]|$)'
}

# push はほかのセッションからブランチが見えるようになる時点のため、間隔に関係なく毎回確認します。
PUSHING=no
if [ "$EVENT" = "PreToolUse" ]; then
    INPUT=$(cat)
    COMMAND=$(extract_command "$INPUT")
    if is_push "$COMMAND"; then
        PUSHING=yes
    fi
    # ブランチの削除、タグの push、試行（dry run）は、このブランチの作業をリモートへ
    # 送らないため、この確認の対象外とします。
    if [ "$PUSHING" = "yes" ]; then
        case "$COMMAND" in
            *--delete* | *--tags* | *--dry-run* | *" -d "* | *" :"*) PUSHING=no ;;
        esac
    fi
fi

NOW=$(date +%s 2>/dev/null) || exit 0
if [ "$EVENT" = "PreToolUse" ] && [ "$PUSHING" = "no" ] && [ -f "$STATE" ]; then
    LAST=$(cat "$STATE" 2>/dev/null)
    case "$LAST" in
        '' | *[!0-9]*) LAST=0 ;;
    esac
    [ $((NOW - LAST)) -lt "$INTERVAL" ] && exit 0
fi
[ -n "$EVENT" ] && printf '%s\n' "$NOW" >"$STATE" 2>/dev/null

# ネットワークに接続できないことは、作業を止める理由にしません。
git fetch --quiet origin "$BASE_BRANCH" 2>/dev/null || exit 0
BEHIND=$(git rev-list --count HEAD..FETCH_HEAD 2>/dev/null) || exit 0
[ "$BEHIND" = "0" ] && exit 0

MERGE_BASE=$(git merge-base HEAD FETCH_HEAD 2>/dev/null) || exit 0

TMP=$(mktemp -d 2>/dev/null) || exit 0
trap 'rm -rf "$TMP"' EXIT INT TERM

git diff --name-only "$MERGE_BASE" FETCH_HEAD 2>/dev/null | sort -u >"$TMP/theirs"
{
    git diff --name-only "$MERGE_BASE" HEAD 2>/dev/null
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
} | sort -u >"$TMP/mine"
comm -12 "$TMP/theirs" "$TMP/mine" >"$TMP/overlap"

COMMITS=$(git log --oneline --no-decorate HEAD..FETCH_HEAD 2>/dev/null | sed 's/^/  /')

# echo ではなく printf を使います。コミットの件名にバックスラッシュが含まれる場合、
# シェルによっては echo がそれを展開するためです。
{
    if [ "$PUSHING" = "yes" ]; then
        printf 'この push を拒否しました。%s が %s より %s コミット先に進んでおり、まだマージされていません。\n' \
            "$BASE_BRANCH" "$BRANCH" "$BEHIND"
    else
        printf '%s が更新されています。origin/%s の %s コミットが %s に含まれていません。\n' \
            "$BASE_BRANCH" "$BASE_BRANCH" "$BEHIND" "$BRANCH"
    fi
    printf '\n%s\n\n' "$COMMITS"
    if [ -s "$TMP/overlap" ]; then
        printf 'これらのコミットが変更したファイルのうち、このブランチでも変更しているもの:\n'
        sed 's/^/  /' "$TMP/overlap"
    else
        printf 'このブランチで変更したファイルと重なる変更はありません。\n'
    fi
    printf '\n先に進む前に /sync-main でマージしてください。\n'
} >"$TMP/message"

json_escape() {
    sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' "$1" | awk '{ printf "%s\\n", $0 }'
}

case "$EVENT" in
    '')
        cat "$TMP/message"
        ;;
    PreToolUse)
        if [ "$PUSHING" = "yes" ]; then
            cat "$TMP/message" >&2
            exit 2
        fi
        printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' "$(json_escape "$TMP/message")"
        ;;
    *)
        printf '{"hookSpecificOutput":{"hookEventName":"%s","additionalContext":"%s"}}\n' "$EVENT" "$(json_escape "$TMP/message")"
        ;;
esac

exit 0
