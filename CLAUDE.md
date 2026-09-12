# CLAUDE.md

家系ラーメンを探す MCP App。Cloudflare Workers にデプロイし、Claude などの
MCP Apps 対応ホストの中で UI が動く。

## コマンド

```bash
npm run build       # UI ビルド → HTML 埋め込み → 型チェック
npm run typecheck   # 型チェックのみ
npm run dev         # ローカル起動（http://localhost:3031/mcp）
npm run dev:worker  # workerd ランタイムで起動（Cloudflare 本番に近い）
npm run deploy      # ビルドして wrangler deploy
npm run data:fetch  # OSM から再取得（20〜30 分。通常は実行不要）
npm run data:build  # osm-raw.json → shops.json の生成
```

ポートは 3031。3001 はこの環境で別プロセスが使っている。

## アーキテクチャ

### MCP App の 2 部構成

tool と resource を `_meta.ui.resourceUri` で結び付けるのが MCP App の基本形。
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

### データ

店舗データは OpenStreetMap 由来の静的 JSON（646 店舗 / 39 都道府県）。
DB もストレージも使わない。実行時の書き込みは無い。

- [scripts/fetch-shops.mjs](scripts/fetch-shops.mjs) — Overpass API を都道府県ごとに並列 3 で叩く。
  1 県あたり 25〜80 秒かかり、たまに失敗する。失敗した県は
  `node scripts/fetch-missing.mjs 京都府 宮城県` で個別に再取得してマージする。
- [scripts/build-dataset.mjs](scripts/build-dataset.mjs) — 家系判定と正規化。

## 気をつけること

**家系判定はヒューリスティック。** `confirmed`（店名に「家系」/ 既知ブランド）と
`likely`（cuisine=ramen かつ店名が「家」で終わる）の 2 段階で、UI ではバッジで区別する。
判定を変えるときは `KNOWN_BRANDS` / `EXCLUDE` / `OTHER_GENRES` を触る。

**味の傾向は参考値。** OSM に味のデータは無く、既知ブランドから割り当てているだけ。
646 件中 237 件は `unknown`。これを事実として断定する文言を UI に書かないこと。

**都道府県の enum は固定の 47 件**（`ALL_PREFECTURES`）。データ由来にすると
店舗 0 件の県が消えてスキーマが不安定になる。UI のプルダウンだけ
`PREFECTURES_WITH_SHOPS` で絞っている。

**外部通信には CSP 宣言が必要。** 地図タイルも位置情報も `uiResourceMeta` に
書いていないと動かない（`csp.resourceDomains` と `permissions.geolocation`）。
新しいドメインを叩くときはここに追加する。

**地図のマーカーは `L.circleMarker`。** Leaflet のデフォルトアイコンは PNG を
外部参照するため、単一 HTML に固められない。アイコンを使いたくなったら
data URI にすること。

## 動作確認

```bash
npm run dev
# 別ターミナル
cd /tmp/mcp-ext-apps/examples/basic-host && SERVERS='["http://localhost:3031/mcp"]' npm run start
# → http://localhost:8080
```

basic-host が無ければ
`git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps`。

Cloudflare 側の確認は `npm run dev:worker`。バンドルサイズは gzip で 3 MiB が無料枠の上限、
現状 407 KiB。

## コード規約

- コメントは日本語。「なぜそうしたか」を書く。何をしているかはコードで表す。
- UI の文言も日本語。
- 型は [src/lib/types.ts](src/lib/types.ts) に集約。zod スキーマは
  [src/lib/schema.ts](src/lib/schema.ts) で、両者は手で同期させている。
