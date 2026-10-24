# デプロイ

**main にマージすると本番へ自動で出る。** CI の `deploy` ジョブが、テストが通ってから
`wrangler deploy` を実行し、`/health` が 200 を返すまで確認する。
認証は Environment「production」のシークレット（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`）。
Environment は `main` からしか使えないので、ほかのブランチのワークフローからは読めない（#260）。
入れ直すときは `gh secret set <名前> --env production`。
**このトークンには「ゾーン → Workers ルート → 編集」（`iekeiramen.com`）も要る。** アカウントの
権限だけだと、Worker の upload は通るのに、続くゾーンのルートの読み取りで
「No access to the specified resource」になり、デプロイが失敗する（実測: #70 のマージ後）。

手元から出したいときだけ `npm run deploy`。戻すときは `npx wrangler rollback`。

## 確認用の環境（staging、#192）

**本番に出す前に、オーナーがスマホで https の条件で確かめる場所。** カメラ・位置情報・共有の画面
（Web Share API）は https でしか動かないので、手元の見本では確かめられない。

|              |                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| URL          | `https://iekei-ramen-staging.yamazaki-dev.workers.dev/`（Worker `iekei-ramen-staging`）                               |
| 守り         | Cloudflare Access（Worker の「Access」タブ、スコープ「すべての Traffic」、ポリシー「Cloudflare アカウント」）         |
| データ       | D1 `iekei-ramen-visits-staging`・KV・Durable Object・Analytics Engine `iekei_ramen_usage_staging`・連打止めは本番と別 |
| サインイン   | 動かない（秘密の値を入れていない）。匿名の機能だけを確かめる                                                          |
| 検索エンジン | `robots.txt` で全拒否、全ページに `X-Robots-Tag: noindex`                                                             |

```bash
npm run deploy:staging   # いまの作業ツリーを上げる（どのブランチからでも。CI からは上げない）
```

`scripts/dev/deploy-staging.mjs` が、ビルド → `dist/web` を `dist/staging` に写して検索エンジン避けを足す →
確認用の D1 に `migrations/` を当てる → `wrangler deploy --env staging`、の順に行う。上げたものは
次に誰かが上げるまで残る（**上げる前に、いまの中身を確かめ終えたか聞く**）。

**オーナーに確かめてもらうときに伝えること:**

1. URL と、Cloudflare のアカウントでログインすること
2. 何を確かめるか（issue の完了条件）と、押してはいけない操作は無いこと（本番のデータには触らない）
3. 終わったら知らせてほしいこと

**本番の Worker（`iekei-ramen-mcp`）の「Access」タブで「すべての Traffic」を選ばない。** 本番の
iekeiramen.com が Access の後ろに入り、誰も使えなくなる。Access を付けるのは確認用の Worker だけ。

**本番の Worker ではプレビュー版（Version URLs）を使わない。** Durable Object（`GeocodeGate`）を持つ
Worker には作られない（開くと "There is nothing here yet"）。`wrangler.jsonc` で `preview_urls: false`。

**初めて作るとき（済み、2026-10-12）:** 確認用の Worker を `workers_dev: false` で上げる（誰も開けない）→
オーナーがその Worker に Access を付ける → `workers_dev: true` にして上げる。逆にすると、Access が付くまで
誰でも開ける。

## 自分のアカウントへ出す・実行時の外部経路・記録の置き場

```bash
npx wrangler login
npm run deploy
```

本番の URL は `https://iekeiramen.com/mcp` です。自分のアカウントへデプロイするときは、[wrangler.jsonc](../../wrangler.jsonc) の `routes` を自分のドメインに変えるか、消してください（消すと `https://iekei-ramen-mcp.<account>.workers.dev/mcp` になります）。

**店舗データはコードに埋め込むので、DB もストレージも要りません**（検索・絞り込み・
「迷ったら」「まわる店」は、この埋め込みデータだけで完結します）。

ただし**実行時に外へ出る経路が 2 つ**あります。落ちているとその機能だけが使えません（他の機能は動きます）。

| 経路                                                               | 使う場面                                   | 失敗すると                                 |
| ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
| Nominatim（`geocode-place`）                                       | 「現在地から探す」で地名・駅名を入れたとき | その地名を座標にできない                   |
| R2 の地図データ（`/map/japan.pmtiles`、binding `MAP_TILES`、#246） | 「地図から探す」の背景                     | 地図の背景が出ない（ピン・塊・順路は出る） |

地図の作り直し方と費用は [map.md](map.md)。

記録（行った店）を動かすときは、Cloudflare の無料枠に収まる範囲で次を使います。

| 使うもの     | 何を置くか                                            |
| ------------ | ----------------------------------------------------- |
| D1           | 訪問記録（`migrations/` のスキーマ）                  |
| KV           | サインインの状態（トークン・認可）                    |
| Google OAuth | 身元の確認（`openid` だけ。メールも名前も保存しない） |

**表は出す前に作ります。** `npm run deploy` も CI も、`wrangler deploy` の前に
`npm run db:migrate`（`migrations/` を D1 へ適用）を通します。逆にすると、
出た直後のリクエストがまだ無い表を触ります。

`GOOGLE_CLIENT_ID` は `wrangler.jsonc` の `vars`、`GOOGLE_CLIENT_SECRET` と
`VISITOR_ID_PEPPER` は `npx wrangler secret put` で登録します。
**`VISITOR_ID_PEPPER` は変えられません**（変えると全員の記録が迷子になります）。

認証なしで叩ける入口のうち、外部や KV へ書くものには、接続元（`CF-Connecting-IP`）ごとの連打止めを付けています（`wrangler.jsonc` の `ratelimits`）。

| binding            | 入口                     | 上限       | 理由                                                                                                                                                  |
| ------------------ | ------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEOCODE_LIMITER`  | `geocode-place`          | 5 回 / 分  | Nominatim の利用規約。キャッシュに無い地名だけ数える                                                                                                  |
| `REPORT_LIMITER`   | `POST /reports`          | 5 回 / 分  | 誤りの報告を D1 へ書く                                                                                                                                |
| `REGISTER_LIMITER` | `POST /register`（#259） | 30 回 / 分 | 登録 1 回ごとに KV へ書く。連打で書き込み枠を使い切らせない。Claude・ChatGPT は自社のサーバーから登録し、多くの利用者が同じ IP になるので緩くしてある |

`REGISTER_LIMITER` は数えられないときは通します（止めるとサインインの入口が塞がるため）。
