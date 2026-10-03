#!/usr/bin/env bash
# Codex のレビューが、PR の先頭のコミットに届くまで待ち、未返信の指摘を出す。
#
#   scripts/wait-codex-review.sh [PR番号]     # 省略時は今のブランチの PR
#
# 終了コード: 0 = 指摘なし / 3 = 指摘あり（下に一覧） / 4 = 時間切れ
#             5 = 待っている間に PR の先頭が変わった（新しい先頭でもう一度待つ）
#
# 待ち方を毎回その場で書いていて、2 回踏んだ。
# - 総評コメントは「Running」の行にも同じ SHA を書くので、SHA だけで待つと
#   レビューの途中で「届いた」と早合点する。**Completed と同じ行**で見る
# - **届いた合図は総評の Completed 行だけ。** review オブジェクトの commit_id は見ない。
#   Codex は返信のスレッドに答えるだけでも review を作り、その commit_id は答えた時点の
#   先頭になる。返信の本文に「@codex」を書いたら Codex が反応し、それを今の先頭の
#   レビューと取り違えて指摘を見落とした（PR #70）。総評の行は、指摘の有無に関わらず
#   レビューが終わったときに Completed になる
# - 依頼への 👍 は見ない。SHA を持たないので、前の巡の 👍 と今の head を結び付けられず、
#   レビューされていないコミットを「指摘なし」と取り違える（レビューで 2 度指摘された）。
#   SHA を持つ合図だけで待ち、届かなければ時間切れ（安全な側）にする
set -euo pipefail

BOT='chatgpt-codex-connector[bot]'
TIMEOUT_SEC=${CODEX_WAIT_TIMEOUT:-2400}

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
PR=${1:-$(gh pr view --json number -q .number)}
# 手元の HEAD ではなく PR の先頭を見る。push し忘れていると、古いコミットの
# レビューを待つことになる。
SHA=$(gh pr view "$PR" --json headRefOid -q .headRefOid)
S7=${SHA:0:7}
[ "$(git rev-parse HEAD 2>/dev/null)" = "$SHA" ] ||
  echo "注意: 手元の HEAD と PR の先頭（${S7}）が違う。push したか確かめる" >&2

# **いちばん新しい依頼より後の結果だけ**を見る。コードを変えずに指摘へ反論して
# 依頼し直すと、head は同じなので、前の巡の結果がそのまま「届いた」に見える。
# 総評コメントは書き換えて使い回されるので、作った時刻ではなく updated_at で比べる。
REQ_AT=$(gh api "repos/$REPO/issues/$PR/comments" --paginate \
  --jq '.[] | select(.body | startswith("@codex review")) | .created_at' | tail -1)

arrived() {
  gh api "repos/$REPO/issues/$PR/comments" --paginate \
    --jq ".[] | select(.user.login==\"$BOT\" and .updated_at > \"$REQ_AT\") | .body" |
    grep "\`$S7\`" | grep -q "Completed"
}

start=$(date +%s)
until arrived 2>/dev/null; do
  if [ $(($(date +%s) - start)) -ge "$TIMEOUT_SEC" ]; then
    echo "時間切れ: $((TIMEOUT_SEC / 60)) 分待ってもレビューが届かない（${S7}）。依頼し直すか確かめる" >&2
    exit 4
  fi
  sleep 20
done
echo "レビュー到着: PR #${PR} / ${S7}"

# 未返信の指摘。**ページをまたいで突き合わせる。** --paginate に --jq を付けると
# ページごとに評価されるので、返信が次のページにあると「未返信」に見える。
findings=$(gh api "repos/$REPO/pulls/$PR/comments" --paginate --slurp | jq -r --arg bot "$BOT" '
  add // [] |
  ([.[] | .in_reply_to_id | select(.)] | map(tostring)) as $replied |
  .[] | select(.in_reply_to_id == null and .user.login == $bot and ((.id | tostring) | IN($replied[]) | not)) |
  "id=\(.id) \(.path):\(.line // .original_line)\n\(.body)\n---"')

gh api "repos/$REPO/issues/$PR/comments" --paginate --slurp |
  jq -r --arg bot "$BOT" '[add[] | select(.user.login == $bot)] | last | .body // ""' |
  grep -E "Didn't find|major issues" || true

# 待っている間（ここまでの取得の間も含む）に push されていたら、届いたのは古い先頭の
# レビュー。新しい先頭は誰も見ていないので、結果を返す直前に確かめる。
# ponytail: この確認と終了の間の push は防げない。最後の守りはマージの
# --match-head-commit（下に出す SHA を渡す）。
NOW=$(gh pr view "$PR" --json headRefOid -q .headRefOid)
if [ "$NOW" != "$SHA" ]; then
  echo "PR の先頭が変わった（${S7} → ${NOW:0:7}）。依頼し直してから、もう一度待つ" >&2
  exit 5
fi
echo "レビューしたコミット: $SHA"

if [ -n "$findings" ]; then
  echo "$findings"
  exit 3
fi
echo "未返信の指摘: なし"
