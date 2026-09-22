# CLAUDE.md

家系ラーメンを探す MCP Apps。Cloudflare Workers にデプロイし、Claude などの
MCP Apps 対応ホストの中で UI が動く。

## コマンド

```bash
npm run build       # UI ビルド → HTML 埋め込み → 型チェック
npm run typecheck   # 型チェックのみ
npm run dev         # ローカル起動（http://localhost:3031/mcp）
npm run dev:worker  # workerd ランタイムで起動（Cloudflare 本番に近い）
npm run deploy      # ビルドして wrangler deploy
npm run data:fetch   # OSM から再取得（20〜30 分。通常は実行不要）
npm run data:judge   # 家系判定（要 TYPESAFE_API_KEY）→ judged.json
npm run data:dedupe  # 重複判定（要 TYPESAFE_API_KEY）→ duplicates.json
npm run data:rescore # 閾値だけ変えたとき（API 不要）
npm run data:build   # judged.json + osm-raw.json → shops.json（API 不要）

npm run doctor      # react-doctor（React 固有の壊れ方を見る）
npm test            # vitest（距離計算・家系判定・MCP サーバーの結合テスト）
npm run e2e         # playwright（basic-host 経由の実ブラウザテスト）
npm run lint        # oxlint
npm run format      # oxfmt（--check は format:check）
npm run knip        # 未使用のコード・依存の検出
```

ポートは 3031。3001 はこの環境で別プロセスが使っている。

コミット時に react-doctor がステージ済みファイルを見る（`.githooks/pre-commit`）。
`npm install` が `core.hooksPath` を張るので、clone 直後に 1 回入れれば効く。
急ぐときは `git commit --no-verify` で飛ばせる。

## アーキテクチャ

### MCP Apps の 2 部構成

tool と resource を `_meta.ui.resourceUri` で結び付けるのが MCP Apps の基本形。
UI 付き tool を足すときは、必ず既存の `resourceUri` を指すこと（UI は 1 つで
モードを切り替える設計なので、リソースを増やす必要はない）。

```
registerAppTool(..., { _meta: { ui: { resourceUri } } })
registerAppResource(server, resourceUri, ...)  // APP_HTML を返す
```

tool は 4 つ。UI 付き 3 つ（`search-iekei-ramen` / `find-nearby-iekei-ramen` /
`show-iekei-ramen-map`）と、UI 無しの `geocode-place`。

### UI へのデータ受け渡し

`structuredContent` に `PayloadSchema`（[src/lib/schema.ts](src/lib/schema.ts)）の形で載せる。
`outputSchema` を併記しないとホストに弾かれる。

**重要:** UI が `app.callServerTool()` で呼んだ結果には `ontoolresult` が発火しない。
戻り値から自分で `setPayload` する必要がある（[src/mcp-app.tsx](src/mcp-app.tsx) の `call`）。
`ontoolresult` はホスト（モデル）発の呼び出しにだけ来る。

### UI の選択をモデルに返す

UI で選んだ 1 軒は `app.updateModelContext()` でモデルに渡す。これが無いと、
地図で店を選んだ直後に「この店は？」と聞かれてもモデルは何も知らない。

- 文面は [src/lib/shop-brief.ts](src/lib/shop-brief.ts) に集約する。判定も味も推定なので、
  **但し書きごとモデルに渡す。** ここを削るとモデルが推定を事実として話す。
- 選択状態は外側の `IekeiApp` が持つ。`IekeiAppInner` は payload ごとに key で
  作り直されるので、内部に置くと検索のたびに消える。
- 選択を外すときは `{ content: [] }` を送る。空の content が「消す」の意味になる。
- `sendMessage` は即座にモデルを動かし、`updateModelContext` は次の発話まで待つ。
  詳細は context 側に置き、`sendMessage` には短い一文だけ流す。

### ビルドチェーン

```
src/mcp-app.tsx ─vite+singlefile→ dist/mcp-app.html ─embed-html.mjs→ src/generated/app-html.ts
                                                                              ↓ server.ts が import
data/shops.json ──────────────────────────────────────────────────→ wrangler が Worker にバンドル
```

Workers にはファイルシステムが無いので、HTML もデータもコードに埋め込む。
`src/generated/` は自動生成なので編集しない（gitignore 済み）。

**UI を変更したら `npm run build:ui` を実行しないとサーバーに反映されない。**
`server.ts` は `src/generated/app-html.ts` を読むので、vite ビルドだけでは足りない。
**さらに、起動中の `npm run dev` は再起動しないと古い HTML を返し続ける**
（起動時に import した文字列を持っているため）。動作確認を頼む前に入れ替えること。

### データ

店舗データは OpenStreetMap 由来の静的 JSON（558 店舗 / 37 都道府県）。
DB もストレージも使わない。実行時の書き込みは無い。

- [scripts/fetch-shops.mjs](scripts/fetch-shops.mjs) — Overpass API を都道府県ごとに並列 3 で叩く。
  1 県あたり 25〜80 秒かかり、たまに失敗する。失敗した県は
  `node scripts/fetch-missing.mjs 京都府 宮城県` で個別に再取得してマージする。
- [scripts/judgments.mjs](scripts/judgments.mjs) — TypeSafe に投げる質問と閾値。
  **判定を変えるならこのファイルだけ見ればいい。** 他所に判定ルールを散らさないこと。
- [scripts/judge-all.mjs](scripts/judge-all.mjs) — 家系判定を実行して `judged.json` に保存。
  確率も保存するので、閾値だけ変えたときは `data:rescore` が API 無しで作り直す。
- [scripts/find-duplicates.mjs](scripts/find-duplicates.mjs) — 200m 以内のペアが同一店舗かを判定。
- [scripts/build-dataset.mjs](scripts/build-dataset.mjs) — 判定結果の整形と重複除去。判定は持たない。

## 気をつけること

**家系判定は推定。** OSM のタグを TypeSafe に渡してジャンルを判断させ、既知ブランドの
対応表と突き合わせている。3 段階あり、UI ではバッジで区別する。

|             | 意味                                                   |
| ----------- | ------------------------------------------------------ |
| `confirmed` | 店名が家系を名乗っている、または既知の家系ブランド     |
| `likely`    | 名乗ってはいないが、店名からジャンルを家系と推定できる |
| `candidate` | ラーメン店で屋号が「〜家」だが、店名からは判断できない |

**「家系ではない」と「判断できない」を混ぜないこと。** 前者は一覧に載せず、後者が
`candidate`。この区別のために段階を 3 つにしてある。

判定を変えるときは [scripts/judgments.mjs](scripts/judgments.mjs) の質問文か閾値を触る。
`KNOWN_BRANDS` と `EXCLUDE`（[scripts/classify.mjs](scripts/classify.mjs)）は事実の
対応表なのでコードに残してあり、モデルの判断より優先する。ジャンル語のリストは
質問の選択肢に移したので無い。**判定できない件数が多いときは、閾値ではなく
選択肢の不足を疑うこと**（中華料理店の選択肢が無くて `unclear` に溜まっていた例がある）。

**味の傾向は参考値。** OSM に味のデータは無く、既知ブランドから割り当てているだけ。
558 件中 372 件は `unknown`。これを事実として断定する文言を UI に書かないこと。
モデルに味を推測させたことがあるが、家系を名乗る店へ一律 `rich` を返してきたので
質問ごと外した。味は対応表からだけ取る。

**都道府県の enum は固定の 47 件**（`ALL_PREFECTURES`）。データ由来にすると
店舗 0 件の県が消えてスキーマが不安定になる。UI のプルダウンだけ
`PREFECTURES_WITH_SHOPS` で絞っている。

**外部通信には CSP 宣言が必要。** 地図タイルも位置情報も `uiResourceMeta` に
書いていないと動かない（`csp.resourceDomains` と `permissions.geolocation`）。
新しいドメインを叩くときはここに追加する。

**地図のマーカーは `L.circleMarker`。** Leaflet のデフォルトアイコンは PNG を
外部参照するため、単一 HTML に固められない。アイコンを使いたくなったら
data URI にすること。

## テスト

| 種類            | 場所     | 対象                                                         |
| --------------- | -------- | ------------------------------------------------------------ |
| ユニット / 結合 | `tests/` | 距離計算、家系判定、MCP サーバー（InMemoryTransport で直結） |
| E2E             | `e2e/`   | 実ブラウザ + basic-host + 実サーバーで 3 モードを操作        |

`npm run e2e` は `e2e-host/` に MCP Apps SDK の basic-host を取得して使う。

- **ドット始まりのディレクトリに置かないこと。** express の `sendFile` が dotfile 扱いで
  404 を返すため、`.e2e/` ではなく `e2e-host/` にしている。
- basic-host の `npm run start` は bun を要求するので、Playwright からは
  ビルド済みの `serve.ts` を tsx で直接起動している。
- サンドボックスの origin が `http://localhost:8081` にハードコードされているため、
  ホスト側のポートは 8080 / 8081 から変えられない。

**E2E を流す前に、動作確認用に立てた basic-host（8080）を止めること。**
`reuseExistingServer` が効くので、動かしたままだと Playwright がそれを再利用する。
そのホストは 3031 の開発サーバーを指しているため、**古いビルドのアプリを検証してしまい、
新しく足した UI が「見つからない」で落ちる。**

アプリはサンドボックス iframe の中の iframe で動くので、E2E のロケータは
`page.frameLocator("iframe").first().frameLocator("iframe").first()` になる。
この出入りは `e2e/helpers.ts` に隔離してある。

## 動作確認

```bash
npm run dev
# 別ターミナル
npm run e2e:setup
SERVERS='["http://localhost:3031/mcp"]' npx tsx e2e-host/ext-apps/examples/basic-host/serve.ts
# → http://localhost:8080
```

Cloudflare 側の確認は `npm run dev:worker`。バンドルサイズは gzip で 3 MiB が無料枠の上限、
現状 407 KiB。

## コード規約

- コメントは日本語。「なぜそうしたか」を書く。何をしているかはコードで表す。
- UI の文言も日本語。
- 型は [src/lib/types.ts](src/lib/types.ts) に集約。zod スキーマは
  [src/lib/schema.ts](src/lib/schema.ts) で、両者は手で同期させている。
