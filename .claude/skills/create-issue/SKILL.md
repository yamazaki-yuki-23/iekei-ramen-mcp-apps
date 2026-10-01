---
name: create-issue
description: "このリポジトリの GitHub issue を、テンプレートの型で、種類と領域のラベル付きで作る。段階（マイルストーン）を付け、親があればサブ issue として繋ぎ、本当の前後関係があれば依存関係を付ける。作った直後に読み返して確かめる。Use when: issue を作って、issue にして、チケットを切って、別の issue で追う、と言ったとき、または作業中に見つけた不具合や宿題を issue に残すとき。Triggers: issue を作って, issue にして, チケットを作って, 別 issue で追う, create-issue"
---

# create-issue

issue を、**テンプレートの型で、種類 1 つ・領域 1 つ以上のラベル付きで、段階（マイルストーン）を付けて**作るスキル。

issue を作るのは Claude Code だけ。ここを通らずに `gh issue create` を直接叩くと、
ラベルの無い issue がたまる（実際に 11 本たまり、全 28 本を付け直した）。

## 決まりはここに書かない

**作るたびに、次の 2 つを読む。** テンプレートの項目もラベルの基準も、このファイルには
書き写さない。二重に持つと、片方だけ直したときにずれる。

| 読むもの                                                               | 何が書いてあるか                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [.github/ISSUE_TEMPLATE/](../../../.github/ISSUE_TEMPLATE/) の `*.yml` | 種類ごとの項目（`body[].attributes.label` の並び）と、付く種類ラベル（`labels`） |
| [.github/LABELS.md](../../../.github/LABELS.md)                        | 種類と領域の意味、迷ったときの判断例、テンプレートの無い種類の扱い               |
| マイルストーンの一覧と説明（GitHub）                                   | 段階の順番（番号順）と、それぞれの段階で何を済ませるか                           |

```bash
ls .github/ISSUE_TEMPLATE/
cat .github/LABELS.md
gh api 'repos/{owner}/{repo}/milestones?state=open' --jq 'sort_by(.number)[] | "\(.title): \(.description)"'
```

対応順の持たせ方（マイルストーン・依存関係・サブ issue）は CLAUDE.md の
「次にやる issue の探し方」にある。

## 手順

### 1. 種類・領域・段階・親・前後関係を決める

LABELS.md を読んで決める。**種類は 1 つ、領域は 1 つ以上。** 迷ったら判断例を見る。
判断例に無い迷い方をしたら、作ったあとで判断例に 1 行足す。

**親を付けるなら、ここで確かめる。親にできるのは `epic` だけ。** 本文を書く前に
確かめる——作ってから気付くと、`親:` の行が本文に残ったまま作られてしまう
（試しに作ったとき、作業の #51 を親に指定し、作った後で行を外す羽目になった）。

```bash
gh issue view <親の番号> --json labels --jq '[.labels[].name] | index("epic") != null'   # true であること
```

`false` なら親にしない。関係があるだけの issue（「#51 のために作った」など）は、
子を束ねる役ではないので、繋ぐと系統を読み違えさせる。**関係は本文に書く。**
サブ issue の親は 1 つしか持てない。2 つの epic に関わるときは、近い方を親にし、
段階はマイルストーンで表す（#38・#39 は #50 にも関わるが、#33 の子にしてある）。

**段階（マイルストーン）を 1 つ選ぶ。** 上で読んだ説明を見て、**その issue が要る
いちばん前の段階**にする（公開前に要るなら公開の段階より前）。どれにも当てはまらない、
または判断が付かないときは付けずに作り、報告でそう伝える——段階を決めるのは
ユーザーなので、当て推量で置かない。

**前後関係は、本当にあるものだけ。** 「先に終わっていないと、この issue が始められない
／やり直しになる」ものだけを依存関係にする（#46 シェア画像は #38 サインインの後、など）。
**並び順を表すためには付けない**——それはマイルストーンが持つ。

### 2. テンプレートを選んで、項目を読む

種類に合うテンプレートの `.yml` を開き、項目を上から順に読む。

```bash
node -e '
const t = require("yaml").parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(t.name, t.labels);
for (const b of t.body) console.log(`- ${b.attributes.label}${b.validations?.required ? "（必須）" : ""}: ${b.attributes.description ?? ""}`);
' .github/ISSUE_TEMPLATE/<種類>.yml
```

### 3. 本文を書く

- 項目の `label` を、**その順のまま** `## ` の見出しにする
- 必須の項目は必ず書く。必須でない項目は、書くことが無ければ見出しごと省く
- **完了条件はチェックボックス**（`- [ ] `）で書く
- **親は本文に書かない。** 親子はサブ issue で持つ（手順 6）。本文にも `親: #番号` を書くと
  二重になり、子を別の親へ移したときに片方だけ古くなる。テンプレートの「親」の項目は
  見出しにしない（人が GitHub の画面から作るとき用の欄）
- 実測した数字・再現手順は、そのまま載せる。「〜と思われる」で済ませない

### 4. 作る

**`--template` は使わない。** 本文の書き出しにしか使われず、ラベルは付かない。
ラベルは `--label` で明示する。

```bash
gh issue create \
  --title "<タイトル>" \
  --label "<種類>,<領域>[,<領域>]" \
  --milestone "<段階>" \
  --body-file - <<'EOF'
<本文>
EOF
```

段階を付けないと決めたときだけ、`--milestone` を外す。

### 5. ラベルと段階を読み返す

**作った直後に読み返す。** 付け忘れ・打ち間違い（存在しないラベル名）は、ここでしか気付けない。

```bash
gh issue view <番号> --json labels,milestone --jq '{labels: [.labels[].name], milestone: .milestone.title}'
```

- 種類（LABELS.md の「種類」の表にあるもの）が**ちょうど 1 つ**
- 領域（`area:` で始まるもの）が **1 つ以上**

- 段階が、手順 1 で選んだもの

足りなければ、その場で足す（多すぎれば外す）。

```bash
gh issue edit <番号> --add-label "<ラベル>"
gh issue edit <番号> --remove-label "<ラベル>"
gh issue edit <番号> --milestone "<段階>"
```

### 6. 親と前後関係を繋ぐ

どちらの API も、issue の**番号ではなく id** を受け取る。

**このファイルに位置引数（ドル記号のすぐ後に数字）を書かない。** スキルを引数付きで
呼ぶと、本文の位置引数が呼んだときの引数で置き換わる（実際に、関数の中で番号を
受けていた所が `issues/issue` になり、id を取れなかった）。説明の中に書いても
置き換わる。番号は `<番号>` のまま書き、使うときに埋める。

**親（手順 1 で確かめた epic）があれば、サブ issue として繋ぐ。** 親の本文の
チェックリストには足さない（子の一覧はサブ issue が持つ）。

```bash
CHILD_ID=$(gh api "repos/{owner}/{repo}/issues/<番号>" --jq .id)
gh api -X POST "repos/{owner}/{repo}/issues/<親の番号>/sub_issues" -F sub_issue_id=$CHILD_ID
```

**前後関係があれば、依存関係を付ける。**「この issue は、先の issue が終わってから」。

```bash
FIRST_ID=$(gh api "repos/{owner}/{repo}/issues/<先の番号>" --jq .id)
gh api -X POST "repos/{owner}/{repo}/issues/<番号>/dependencies/blocked_by" -F issue_id=$FIRST_ID
```

繋いだら読み返す。依存関係は、付けた直後だと「次にやる issue の探し方」の検索に
まだ出ない（実測: 反映まで約 20 秒）。API で読み返せば、すぐに分かる。

```bash
gh api "repos/{owner}/{repo}/issues/<親の番号>/sub_issues" --paginate --jq '[.[].number]'        # 番号が入っている
gh api "repos/{owner}/{repo}/issues/<番号>/dependencies/blocked_by" --jq '[.[].number]'          # 先の番号が入っている
```

## 報告の形

```
| | |
| --- | --- |
| issue | #<番号> <タイトル> |
| URL | <URL> |
| ラベル | <種類>, <領域> |
| 段階 | <マイルストーン>（付けなければ「無し」と理由） |
| 親 | #<番号>（無ければ —） |
| 先に終わる必要がある | #<番号>（無ければ —） |
```

## やらないこと

- **テンプレートやラベルの決まりを、このファイルに書き写さない**
- **`gh issue create` を、このスキルを通さずに叩かない**
- LABELS.md に無いラベルを付けない。足すなら先に LABELS.md に書いてから `gh label create`
- 段階の一覧や中身をこのファイルに書き写さない（マイルストーンを読む）
- 並び順を表すためだけに依存関係を付けない
