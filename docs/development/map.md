# 地図（MapLibre＋Protomaps、#246）

地図の背景は、自分たちで色を決めた地図。見た目の決まりは [DESIGN.md](../../DESIGN.md) の「地図」。

## 作り

| 何                 | どこ                                                                                                      | 置き場所                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 地図の部品         | MapLibre GL JS 6 系（`maplibre-gl`。描画の Worker は 1 枚の HTML に埋め込む）と、PMTiles を読む `pmtiles` | Web は地図を開いたときだけ読む別のファイル。会話の中は 1 枚の HTML に入る              |
| 地図のデータ       | Protomaps の basemap（OSM 由来）を、日本の範囲だけ切り出した `japan.pmtiles`（約 3.6GB、ズーム 15 まで）  | R2 のバケット `iekei-ramen-map`。Worker が `/map/japan.pmtiles` で範囲指定に答えて返す |
| 文字（英数字）     | Protomaps の公開している Noto Sans のグリフ（OFL）。4 範囲（0-255・256-511・8192-8447・65280-65535）だけ  | `public/map/fonts/`（静的ファイル）                                                    |
| 文字（漢字・かな） | 端末の丸ゴシック（`localIdeographFontFamily`）。置かない                                                  | —                                                                                      |
| 印の絵             | canvas で描いて `addImage`（[map-images.ts](../../src/features/search/lib/map-images.ts)）                | —                                                                                      |
| 背景の色と層       | [map-style.ts](../../src/features/search/utils/map-style.ts)                                              | —                                                                                      |

- **置いていない文字の範囲は、端末の書体で描き直される**（MapLibre が警告を出して、その場で描く）。
  地名・駅名に出る範囲だけを置いている
- **会話の中（MCP）は本番のドメインから取る。** ホストが用意した別のドメインの枠で動くので、
  `https://iekeiramen.com/map/` を見に行く。CSP の `connectDomains` に `https://iekeiramen.com` を入れてある
  （地図データも文字も `fetch` なので connect-src）。`/map/japan.pmtiles` と `/map/fonts/*` は CORS を許す
- **R2 の binding（`MAP_TILES` → バケット `iekei-ramen-map`）は、wrangler.jsonc のトップレベル（本番）と
  `env.staging` の両方に書く。** binding は env へ引き継がれない。確認用も、読むだけなので本番と同じバケットを使う
  （`tests/deploy-workflow.test.ts` が本番の分を見張る）
- **地図のデータが取れなくても、店のピン・塊・順路は出る**（GeoJSON なので）。R2 をつないでいない環境
  （手元・E2E）では `/map/japan.pmtiles` は 404 になり、背景だけが無い
- **E2E は地図のデータと文字を取りに行かない**（`e2e/fixtures.ts` の `noMapData`）。外部の地図サービスに
  問い合わせないため

## 出典

地図の右下の「i」（最初から畳む）に、`© OpenStreetMap contributors` と `Protomaps` を出す。地図データが
取れなかったときも出るよう、データの側ではなく出典の欄に直接書く（`customAttribution`）。

## PMTiles の作り直し方

日本の範囲を、Protomaps の日次ビルドから切り出す。**新しい依存は足さない**（pmtiles の CLI は単体の実行
ファイルで、リポジトリには入れない）。

1. pmtiles の CLI を取る（[go-pmtiles のリリース](https://github.com/protomaps/go-pmtiles/releases)。
   mac の Apple シリコンなら `go-pmtiles-<版>_Darwin_arm64.zip`）
2. 最新のビルドの名前を見る: `curl -s https://build-metadata.protomaps.dev/builds.json | tail -c 400`
   （`20261016.pmtiles` のような名前）
3. 切り出す（15〜30 分、約 3.8GB を取りに行く）

   ```bash
   ./pmtiles extract https://build.protomaps.com/<ビルド名>.pmtiles japan.pmtiles \
     --bbox=122.9,24.0,146.0,45.6 --maxzoom=15 --download-threads=4
   ./pmtiles show japan.pmtiles   # bounds と max zoom 15 を確かめる
   ```

4. R2 に置く（同じ名前で上書きする。ETag が変わるので、地図の部品は読み直す）。
   **`wrangler r2 object put` とダッシュボードは 300MB までしか置けない**（wrangler 4.136 の
   `MAX_UPLOAD_SIZE_BYTES`）。約 3.6GB のファイルは、分割して送れる S3 互換の道具 `rclone` で置く
   （手元に入れる道具で、リポジトリの依存には入れない。`brew install rclone`）

   1. ダッシュボードの「R2」→「API トークンを管理」で、バケット `iekei-ramen-map` に読み書きできる
      トークンを作る。アクセスキー ID とシークレットは**チャット・issue・コミットに出さない**
   2. 手元の端末の環境変数にだけ入れて送る（`<アカウント ID>` は wrangler.jsonc と同じアカウント）

      ```bash
      export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
      export RCLONE_CONFIG_R2_ENDPOINT=https://<アカウント ID>.r2.cloudflarestorage.com
      read -rs RCLONE_CONFIG_R2_ACCESS_KEY_ID && export RCLONE_CONFIG_R2_ACCESS_KEY_ID
      read -rs RCLONE_CONFIG_R2_SECRET_ACCESS_KEY && export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY
      rclone copyto japan.pmtiles r2:iekei-ramen-map/japan.pmtiles --s3-chunk-size 100M --s3-no-check-bucket --progress
      rclone lsl r2:iekei-ramen-map   # 大きさが手元のファイルと同じこと
      ```

      `--s3-no-check-bucket` は外さない。バケットに限ったトークンでは、rclone が送る前にバケットを作ろうと
      して 403 になる（実測、2026-10-17）

5. 本番で確かめる: 横浜駅のまわりで、背景・駅名・道路名が出ること

**作り直す目安:** 半年に 1 回か、新しい駅・道路が目立つとき。店のデータ（`data/shops.json`）とは別で、
作り直さなくても店は最新のまま出る。

## 費用（R2・Workers の無料枠）

| 何                       | 使う量                                                         | 無料枠                    |
| ------------------------ | -------------------------------------------------------------- | ------------------------- |
| R2 の保存                | 3.6GB                                                          | 10GB/月                   |
| R2 の読み出し（Class B） | 地図を 1 回見ると 50〜150 回（タイル 1 枚につき範囲指定 1 回） | 1,000 万回/月             |
| R2 の転送                | —                                                              | 無料（R2 は転送料が無い） |
| Worker の呼び出し        | 読み出しと同じ回数                                             | Workers の契約による      |

- 読み出しの無料枠は、地図の表示にして月 6.6 万〜20 万回ぶん。使われ方は `npm run usage` で見る
- **Worker の呼び出しも同じ回数だけ増える。** 無料の契約（10 万回/日）だと、1 日に 700〜2,000 回の地図の
  表示で上限に届く。超えそうなら、R2 の公開バケットに独自のドメインを付けて、Worker を通さずに返す
  （Cloudflare のキャッシュも効く）
