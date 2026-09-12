# 家系ラーメンを探す MCP App

家系ラーメン店を「検索フォーム」「現在地から探す」「地図から探す」の 3 モードで
探せる MCP App です。Claude などの MCP Apps 対応ホストの中で UI が動きます。

## 構成

| ファイル                    | 役割                                                              |
| --------------------------- | ----------------------------------------------------------------- |
| `server.ts`                 | MCP サーバー本体。3 つの UI 付き tool と補助 tool を登録          |
| `worker.ts`                 | Cloudflare Workers エントリ（`/mcp` で Streamable HTTP を受ける） |
| `main.ts`                   | ローカル実行エントリ（HTTP / stdio）                              |
| `src/mcp-app.tsx`           | UI のシェル。モード切り替えと tool 呼び出し                       |
| `src/components/`           | 検索フォーム / 一覧 / 現在地パネル / 地図                         |
| `scripts/fetch-shops.mjs`   | OpenStreetMap から店舗データを取得                                |
| `scripts/build-dataset.mjs` | 取得データを家系判定して `data/shops.json` を生成                 |

## tool 一覧

| tool                      | 内容                                        |
| ------------------------- | ------------------------------------------- |
| `search-iekei-ramen`      | 都道府県 / 味の傾向 / キーワードで絞り込み  |
| `find-nearby-iekei-ramen` | 緯度経度から近い順に 5 件（既定）           |
| `show-iekei-ramen-map`    | 日本地図にプロット                          |
| `geocode-place`           | 地名 → 緯度経度（UI が内部で使う。UI なし） |

## セットアップ

```bash
npm install
npm run data:fetch   # OSM から取得（数分かかる。data/osm-raw.json ができる）
npm run data:build   # 家系判定して data/shops.json を生成
npm run build        # UI をビルドして HTML をコードに埋め込み、型チェック
```

`data/shops.json` はリポジトリにコミットされるので、通常の開発では
`data:fetch` / `data:build` を再実行する必要はありません（データ更新時のみ）。

## ローカルで動かす

```bash
npm run dev
```

`http://localhost:3031/mcp` で MCP サーバーが起動します。
UI つきで確認する場合は MCP Apps SDK の basic-host が使えます。

```bash
git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host && npm install
SERVERS='["http://localhost:3031/mcp"]' npm run start   # → http://localhost:8080
```

Cloudflare のローカルランタイム（workerd）で確認する場合:

```bash
npm run dev:worker
```

## Cloudflare にデプロイ

```bash
npx wrangler login
npm run deploy
```

デプロイ後の URL は `https://iekei-ramen-mcp.<account>.workers.dev/mcp` です。
Workers の無料枠（1 日 10 万リクエスト）で動く構成で、外部 DB もキーも使いません。

## Claude に接続する

Claude の Connectors 設定で、デプロイ先の `/mcp` URL をカスタムコネクタとして追加します。

## データについて

現在のデータ: **646 店舗 / 39 都道府県**（うち「家系確定」409 件、「家系の可能性」237 件）

- 出典は [OpenStreetMap](https://www.openstreetmap.org/copyright) の contributors（ODbL）です。
- 家系判定はヒューリスティックです。
  - **確定** … 店名 / ブランドに「家系」を含む、または既知の家系ブランドと一致
  - **家系の可能性** … `cuisine=ramen` かつ店名が「家」で終わる
- **味の傾向は参考値です。** OSM に味のデータは無いため、既知のブランドから
  `直系・濃厚` / `クリーミー` / `チェーン・万人向け` を割り当てています。
  判定できない店舗は `情報なし` になります。
- 営業時間・電話番号も OSM 由来で、実際と異なる場合があります。

データを更新したいときは `npm run data:fetch && npm run data:build` を実行してください。
