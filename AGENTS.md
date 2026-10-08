# AGENTS.md

家系ラーメンを探す MCP Apps。Cloudflare Workers にデプロイし、Claude などの
MCP Apps 対応ホストの中で UI が動く。

## 必須ルール

作業前に [docs/development.md](docs/development.md) を読む。既存の設計上の制約、データ更新、検証、デプロイの詳細はこの開発ガイドが持つ。UIを触る前には [DESIGN.md](DESIGN.md) も読む。

- 匿名の検索を維持する。訪問記録だけ認証を要求し、秘密の値をログ・チャット・issueに出さない。
- 店舗の味・評判・混雑・移動時間を推測で補わない。距離は直線距離。家系判定の段階は画面に出さず、誤りの但し書き（報告の案内つき）と参考値の但し書きを維持する。
- issue駆動で進め、共通スキルを使う。マージの許可条件は各スキルに従い、レビューとCIを省略しない。
- 新しい依存・専用設定・APMを、この共通化のためだけに追加しない。個人設定はGitに入れない。
- 3031と8080の既存サーバーは停止しない。E2Eから公開Nominatimへ問い合わせない。

## 出力スタイル

読み手はADHDです。すぐ行動に移せるよう、回答は次の規則に従う。

1. 答えや次の行動から始め、コマンド・パス・コードを優先する。
2. 複数ステップは番号を付け、1ステップにつき明確な行動を1つにする。
3. 2分以内に完了できる具体的な次の行動を1つ提示して終える。
4. 新しい論点の前に現在の問題を解決する。
5. ターンごとに進捗を明記する。
6. 所要時間は分単位など具体的に示す。
7. 変更後に何が動作するようになったかを目に見える形で示す。
8. エラーは場所・原因・修正方法を淡々と伝える。
9. リストは最大5項目にする。
10. 前置き・要約・締めの挨拶は入れない。

解説を求められたら十分に説明する。破壊的操作の前には必ず確認を取る。修正に3回失敗したら停止して前提の誤りを指摘する。指示が曖昧なら短い質問を1つだけ行う。

**issue は `/create-issue` で作る。** `gh issue create` を直接叩かない（ラベルの無い
issue がたまる）。項目は [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/)、ラベルの基準は
[.github/LABELS.md](.github/LABELS.md)。

**issue を対応するときは `/ship-issue <番号…>`。** 読む → 作る → PR → Codex レビュー
（`scripts/wait-codex-review.sh` で待つ）→ squash してマージ → 本番で確かめる → 証拠を
書いて閉じる、までを通す。部品は `/codex-review-loop` と `/squash-and-merge`。
共通スキルの正本は `.agents/skills/`。Claude Code は `.claude/skills/` の相対シンボリックリンクから同じ本文を読む。Codex では `$ship-issue` のように呼び、Claude Code では `/ship-issue` のように呼ぶ。

## 次にやる issue の探し方

**対応順は GitHub の機能に分けて持たせてある。本文のチェックリストには書かない**
（順番を変えるたびに書き換えることになり、更新し忘れるとずれる）。

| 機能                   | 持たせるもの                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| マイルストーン         | 段階。「準備」→「段階 0: 足場」→ …「段階 4: 数字を見て伸ばす」の順（番号順） |
| 依存関係（blocked by） | 本当の前後関係だけ（#46 は #38 の後、など）。並び順のためには付けない        |
| サブ issue             | 親子関係。親（epic）は #50・#33。子の親は 1 つだけ                           |

**いちばん前の段階で、開いていて、依存関係で止められていないもの**が次の候補。
空なら次の段階へ進む。

```bash
for m in $(gh api 'repos/{owner}/{repo}/milestones?state=open' --jq 'sort_by(.number)[].title | @base64'); do
  t=$(echo "$m" | base64 -d)
  r=$(gh issue list --search "milestone:\"$t\" is:open -is:blocked" --json number,title --jq '.[] | "#\(.number) \(.title)"')
  [ -n "$r" ] && { echo "次の段階: $t"; echo "$r"; break; }
done
```

`-is:blocked` は**開いている**先の issue があるものだけを外す（先が閉じれば候補に戻る）。
依存関係を付けた直後は、検索に反映されるまで少しかかる（実測: 約 20 秒）。
同じ段階に候補が複数あるときの順番は、ユーザーに確かめる。

## コマンド

```bash
npm run build       # UI ビルド → HTML 埋め込み → 型チェック
npm run typecheck   # 型チェックのみ
npm run dev         # ローカル起動（http://localhost:3031/mcp）
npm run dev:worker  # workerd ランタイムで起動（Cloudflare 本番に近い）
npm run deploy      # ビルドして wrangler deploy（通常は不要。main へのマージで自動デプロイ）
npm run data:fetch   # OSM から再取得（20〜30 分。通常は実行不要）
npm run data:judge   # 家系判定（要 TYPESAFE_API_KEY）→ judged.json
npm run data:dedupe  # 重複判定（要 TYPESAFE_API_KEY）→ duplicates.json
npm run data:areas   # 住所の欠けている店を座標から逆引き（API キー不要・1.2 秒/件）→ areas.json
npm run data:rescore # 閾値だけ変えたとき（API 不要）
npm run data:build   # judged.json + osm-raw.json → shops.json（API 不要）

npm run doctor      # react-doctor（React 固有の壊れ方を見る）
npm test            # vitest（距離計算・家系判定・MCP サーバーの結合テスト）
npm run e2e         # playwright（basic-host 経由の実ブラウザテスト）
npm run lint        # oxlint（--deny-warnings。警告も落とす）
npm run format      # oxfmt（--check は format:check）
npm run knip        # 未使用のコード・依存の検出
npm run usage       # 週ごとの使われ方（Analytics Engine。要 CLOUDFLARE_ANALYTICS_TOKEN）
```

ポートは 3031。3001 はこの環境で別プロセスが使っている。

**Node のバージョンは [.nvmrc](.nvmrc) が 1 箇所の正。** CI もここを読む
（`setup-node` の `node-version-file`）。手元がずれると CI で再現しない不具合が出るので、
`nvm use` / `mise use node` などで揃えてから作業する。`@types/node` もここに合わせる。
型だけ先に上げると、実行環境に無い API が型として通ってしまう。

**検証の結果は最後まで見ること。** `oxlint` は警告があっても終了コード 0 を
返すので、出力を `error` だけで拾うと見落とす（実際に `no-await-in-loop` の
警告 10 件を「通過」と報告してしまい、CI の注釈で気付いた）。`npm run lint` に
`--deny-warnings` を付けてあるので、いまは警告も終了コードに出る。

コミット時に react-doctor がステージ済みファイルを見る（`.githooks/pre-commit`）。
`npm install` が `core.hooksPath` を張るので、clone 直後に 1 回入れれば効く。
急ぐときは `git commit --no-verify` で飛ばせる。
