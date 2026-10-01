---
name: create-issue
description: "このリポジトリの GitHub issue を、テンプレートの型で、種類と領域のラベル付きで作る。作った直後にラベルを読み返して確かめ、親があれば親のチェックリストに足す。Use when: issue を作って、issue にして、チケットを切って、別の issue で追う、と言ったとき、または作業中に見つけた不具合や宿題を issue に残すとき。Triggers: issue を作って, issue にして, チケットを作って, 別 issue で追う, create-issue"
---

# create-issue

issue を、**テンプレートの型で、種類 1 つ・領域 1 つ以上のラベル付きで**作るスキル。

issue を作るのは Claude Code だけ。ここを通らずに `gh issue create` を直接叩くと、
ラベルの無い issue がたまる（実際に 11 本たまり、全 28 本を付け直した）。

## 決まりはここに書かない

**作るたびに、次の 2 つを読む。** テンプレートの項目もラベルの基準も、このファイルには
書き写さない。二重に持つと、片方だけ直したときにずれる。

| 読むもの                                                               | 何が書いてあるか                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [.github/ISSUE_TEMPLATE/](../../../.github/ISSUE_TEMPLATE/) の `*.yml` | 種類ごとの項目（`body[].attributes.label` の並び）と、付く種類ラベル（`labels`） |
| [.github/LABELS.md](../../../.github/LABELS.md)                        | 種類と領域の意味、迷ったときの判断例、テンプレートの無い種類の扱い               |

```bash
ls .github/ISSUE_TEMPLATE/
cat .github/LABELS.md
```

## 手順

### 1. 種類と領域を決める

LABELS.md を読んで決める。**種類は 1 つ、領域は 1 つ以上。** 迷ったら判断例を見る。
判断例に無い迷い方をしたら、作ったあとで判断例に 1 行足す。

**親を付けるなら、ここで確かめる。親にできるのは `epic` だけ。** 本文を書く前に
確かめる——作ってから気付くと、`親:` の行が本文に残ったまま作られてしまう
（試しに作ったとき、作業の #51 を親に指定し、作った後で行を外す羽目になった）。

```bash
gh issue view <親の番号> --json labels --jq '[.labels[].name] | index("epic") != null'   # true であること
```

`false` なら親にしない。関係があるだけの issue（「#51 のために作った」など）は、
子のチェックリストを持たないので足す先が無く、`親:` の行だけが残って系統を
読み違えさせる。**関係は本文に書く。**

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
- 手順 1 で確かめた親（epic）があれば、**本文の最後の行に `親: #番号`** を書く（テンプレートの「親」の項目は見出しにしない）
- 実測した数字・再現手順は、そのまま載せる。「〜と思われる」で済ませない

### 4. 作る

**`--template` は使わない。** 本文の書き出しにしか使われず、ラベルは付かない。
ラベルは `--label` で明示する。

```bash
gh issue create \
  --title "<タイトル>" \
  --label "<種類>,<領域>[,<領域>]" \
  --body-file - <<'EOF'
<本文>
EOF
```

### 5. ラベルを読み返す

**作った直後に読み返す。** 付け忘れ・打ち間違い（存在しないラベル名）は、ここでしか気付けない。

```bash
gh issue view <番号> --json labels --jq '[.labels[].name]'
```

- 種類（LABELS.md の「種類」の表にあるもの）が**ちょうど 1 つ**
- 領域（`area:` で始まるもの）が **1 つ以上**

足りなければ、その場で足す（多すぎれば外す）。

```bash
gh issue edit <番号> --add-label "<ラベル>"
gh issue edit <番号> --remove-label "<ラベル>"
```

### 6. 親に足す

手順 1 で確かめた親（epic）があれば、親の子 issue のチェックリストに 1 行足す。

```bash
gh issue view <親の番号> --json body --jq .body > /tmp/parent.md
# 子 issue のチェックリストに「- [ ] #<番号> <タイトル>」を足す
gh issue edit <親の番号> --body-file /tmp/parent.md
```

## 報告の形

```
| | |
| --- | --- |
| issue | #<番号> <タイトル> |
| URL | <URL> |
| ラベル | <種類>, <領域> |
| 親 | #<番号>（無ければ —） |
```

## やらないこと

- **テンプレートやラベルの決まりを、このファイルに書き写さない**
- **`gh issue create` を、このスキルを通さずに叩かない**
- LABELS.md に無いラベルを付けない。足すなら先に LABELS.md に書いてから `gh label create`
