---
name: squash-and-merge
description: "作業ブランチのコミットを 1 つにまとめ、CI の緑を待って PR をマージし、ブランチを片付けて自動デプロイの結果まで確認する。Use when: コミットを1つにまとめてマージして、squashしてマージ、マージしておいて、PRをマージして、と言ったとき。Triggers: squashしてマージ, コミットを1つにまとめてマージ, PRをマージ, マージして, squash-and-merge"
---

# squash-and-merge

作業ブランチのコミットを 1 つにまとめ、**CI が緑になってから**マージし、ブランチを片付け、
本番への自動デプロイまで見届けるスキル。

**ユーザーがマージを頼んだときだけ動かす。** 指摘ゼロになっただけでは merge しない。

## squash-commits との使い分け

|                  | 使う場面                                                              |
| ---------------- | --------------------------------------------------------------------- |
| **このスキル**   | まとめて**マージまで**やる。CI 待ち・ブランチ削除・デプロイ確認を含む |
| `squash-commits` | まとめるだけ。まだマージしない（レビュー中に履歴を整えたいときなど）  |

## 引数

```
/squash-and-merge [PR番号]
```

省略時は現在のブランチの PR を引く。

---

## 手順

### 1. 前提を確かめる

```bash
git branch --show-current     # main / master なら中断
git status --porcelain        # 空でなければ中断（stash か commit を促す）
gh pr view <PR> --json headRefName,headRefOid,baseRefName \
  -q '"\(.headRefName) \(.headRefOid) \(.baseRefName)"'
BASE=origin/<baseRefName>     # 多くは origin/main。PR の行き先から取る
git fetch origin && git log "$BASE..HEAD" --oneline
```

- **今のブランチと PR のブランチが違う → 中断**（`gh pr checkout <PR>` してからやり直す）。
  以降の reset・force-push・CI 待ちは今のブランチに効き、最後の `gh pr merge` だけが PR
  番号で選ぶので、食い違うと**別のブランチを書き換え、確かめていない PR をマージする**
- 手元の HEAD と PR の `headRefOid` が違う → **中断**（push し忘れか、他所から push がある）
- 現在ブランチが `main` / `master` → **中断**
- 未コミットの変更がある → **中断**
- コミットが 1 つ → squash は飛ばして 4 へ

### 2. まとめる

**`git rebase -i` は対話モードなので Bash から実行できない。**
`git reset --soft` + `git commit` で同じことをする。

**数えて戻さない。PR の行き先との分かれ目へ戻す。** `origin/main..HEAD` の件数で
`HEAD~N` へ戻すと、行き先が main 以外のときに行き先側のコミットまで数えて戻りすぎ、
それを 1 つにまとめて force-push する。中身（ツリー）は同じなので 3 の差分確認では気付けない。

```bash
git reset --soft "$(git merge-base "$BASE" HEAD)"
git commit -F - <<'EOF'
<まとめたメッセージ>
EOF
```

#### メッセージの作り方

**N 個のメッセージを連結しない。** 変更全体を 1 本の物語として書き直す。

- 1 行目は「何をしたか」。元の 1 個目のタイトルをそのまま使えることが多い
- 本文に **なぜそうしたか**、主な変更、レビューで直した分を入れる
- レビュー対応のコミットは「レビューで見つかった N 件も直した」としてまとめる
- 検証した事実（テスト件数・サイズなど）を入れると、あとで追える

プロジェクトの規約（言語・署名行）に従う。

### 3. 中身が変わっていないことを確かめてから force-push

**squash でツリーが変わっていないことを必ず確認する。** ここを飛ばすと、
reset を打ち間違えても気付けない。

```bash
git diff origin/<branch> HEAD --stat   # ← 空であること
git push --force-with-lease
```

`--force` は使わない。自分が把握していない push を握り潰す。

### 4. まとめ直したコミットで CI が緑になるのを待つ

**前の実行を見て「緑だった」と早合点しない。** `headSha` で突き合わせる。
待ちは `run_in_background: true`（前景 Bash は 600 秒で切れる）。

**コミットで絞る（`--commit`）。最新の 1 件を見張らない。** `--limit 1` で最新だけを
見ていると、間に別の実行が入ったとき、目当ての実行がその下にあるのに永久に待つ。

```bash
SHA=$(git rev-parse HEAD)
for i in $(seq 1 60); do      # 10 分で諦める
  RUN=$(gh run list --commit "$SHA" --workflow CI --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$RUN" ] && break; sleep 10
done
[ -n "$RUN" ] || { echo "CI の実行が見つからない: $SHA"; exit 1; }
gh run watch "$RUN" --exit-status --compact
```

**赤ならマージしない。** 直してから 4 へ戻る。

### 5. マージする

```bash
gh pr merge <PR> --squash --delete-branch --match-head-commit "$SHA"   # 4 で CI を見たコミット
```

- **`--match-head-commit` を必ず付ける。** CI を見ている間に誰かが push すると、PR は
  新しい head のままマージされ、確かめていない変更が本番に出る。最初の確認も
  `--force-with-lease` も、この間は守らない。付ければ head が変わったときに失敗する

- リポジトリのルールセットが Squash だけを許していることが多い。`--squash` を使う
- `--delete-branch` はリモートのブランチを消す。**手元のブランチも一緒に消えることがある**ので、
  次の手順では「無ければそれでよい」と扱う

### 6. 片付ける

```bash
git checkout main && git pull
git branch -D <branch> 2>/dev/null || true   # 既に消えていれば何もしない
git remote prune origin
git branch -a | grep <branch> || echo "ブランチ削除済み"
```

### 7. 自動デプロイを見届ける

このプロジェクトは **main へのマージで本番へ出る**（CI の `deploy` ジョブ）。
マージして終わりにせず、出たことまで確認する。

見張るのは**このマージのコミット**（`mergeCommit`）。`git pull` の後の HEAD は、別の PR が
続けてマージされていると別のコミットになる。

```bash
SHA=$(gh pr view <PR> --json mergeCommit -q .mergeCommit.oid)
for i in $(seq 1 60); do
  RUN=$(gh run list --commit "$SHA" --workflow CI --json databaseId --jq '.[0].databaseId // empty')
  [ -n "$RUN" ] && break; sleep 10
done
[ -n "$RUN" ] || { echo "デプロイの実行が見つからない: $SHA"; exit 1; }
gh run watch "$RUN" --exit-status --compact
gh run view "$RUN" --log | grep -E "Current Version ID|Deployed|Total Upload"
curl -s -o /dev/null -w "health: %{http_code}\n" https://iekeiramen.com/health
```

---

## 報告の形

```
| | |
| --- | --- |
| main | <sha> |
| Version ID | <new>（前: <old>） |
| /health | 200 |
| バンドル | gzip <n> KiB |
| CI | 3 ジョブ success |
```

デプロイが走らない PR（`main` 以外へのマージなど）のときは、その旨を書いて 7 を飛ばす。

## 注意

- **ユーザーが頼むまでマージしない。** レビューが緑でも勝手に進めない
- **CI が赤のままマージしない**
- `--force` ではなく `--force-with-lease`
- squash 後は必ず `git diff` で中身が同じことを確認してから push
- 他の人がそのブランチを見ている可能性があるときは、force-push する旨を先に伝える
