# テスト

**置き場:** 1 つのソースを確かめる単体テストはソースの隣に `<ソース名>.test.ts`、結合テストと補助（`fixtures/`）は `tests/`（決まりは [development/structure.md](structure.md) の「テストの置き場」、#222）。`npm test` は両方を流す。

## コマンド

```bash
npm test            # vitest距離計算・家系判定・MCP サーバーの結合テスト
npm run e2e         # playwright実ブラウザで 5 モード・順路・記録を操作する E2E
npm run lint        # oxlint
npm run format      # oxfmt（CI では format:check）
npm run knip        # 未使用のコード・依存の検出
```

E2E は MCP Apps SDK の basic-host を `e2e-host/` に取得して使います
（`npm run e2e:setup` が自動で行います）。記録まわりだけは、偽のサインイン済み
利用者で動くサーバー（`IEKEI_DEV_VISITOR`）を別のポートで立てて確かめています。
**この道は `main.ts` にしかなく、本番には出ません。**
すべて [GitHub Actions](../../.github/workflows/ci.yml) で実行しています。

**OAuthの実HTTP経路は `tests/oauth-consent.test.ts` で検証する。**
本番の `OAuthAuthorizationServer` とWorkerを、使い捨てのローカルKV/D1で動かす。
client登録・同意・Google callback・PKCEによるtoken取得・認証済みMCP呼び出しを
通し、D1の利用者IDまで照合する。未登録clientと偽造・改変Bearer tokenは拒否する。
Googleのtoken交換だけをテスト専用Workerで固定し、リクエスト内容も検証する。
それ以外の外部通信はテストで失敗させる。互換設定だけを本番configから読み、
資格情報・本番KV・個人用 `.dev.vars` は使わない。既存の `npm test` とCIで動く。
匿名検索と高速な認証ヘルパーテストも維持する。

| 種類     | 場所                               | 対象                                                                                                       |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| ユニット | ソースの隣（`<ソース名>.test.ts`） | 1 つのソースだけを確かめる（距離計算・3 軒の選び方・家系判定の文言など）                                   |
| 結合     | `tests/`                           | 2 つ以上のソースの組み合わせ、MCP サーバー（InMemoryTransport で直結）・Worker・ビルド・設定・構造の決まり |
| E2E      | `e2e/`                             | 実ブラウザ + basic-host + 実サーバーで 3 モードを操作                                                      |

**訪問記録のSQLは `tests/visits-runtime.test.ts` でローカルD1を通す。**
既存Wranglerの `createTestHarness` を使い、各テストで使い捨てのworkerdとDBを作る。
本番の互換設定だけを読み、テスト用bindingへ実際の `migrations/` を適用して
Workerの中で本番の `d1Visits()` を呼ぶ。保存・一覧・削除・初回日時・利用者分離を
検証する。本番DBや個人用 `.dev.vars` は使わず、資格情報は不要。
`npm test` と既存CIで実行し、高速な `memoryVisits()` のtoolテストも維持する。
APIの手順は [Cloudflareのテスト状態の準備](https://developers.cloudflare.com/workers/testing/test-harness/prepare-test-state/) を参照。

**0件・1件・最終巡は実店舗データの分布から選ばない。**
`e2e/fixtures/shops-boundaries.json` の固定データ（北海道1軒・青森県4軒・岩手県5軒・秋田県0軒・山形県に「家系か未判定」1軒）を
`tests/server-boundaries.test.ts` と `e2e/boundaries.spec.ts` で使う。
サーバー結合テストでは `createServer({ shops })` で渡す。
E2E は `main.ts` の `IEKEI_SHOP_FIXTURE` で3133に起動し、対象ページのPOSTだけを
実ホストからその実MCPへ送る。8080の登録や再起動は不要。
Workerにはファイル／環境変数によるデータ差し替えを追加しない。
実店舗データの整合性とsmokeは既存のテストで維持し、件数は現在のデータと照合する。
`total > 500` などの下限はデータ品質の要件ではないため、全件一致で検証する。

`npm run e2e` は `e2e-host/` に MCP Apps SDK の basic-host を取得して使う。
版は `package-lock.json` の `@modelcontextprotocol/ext-apps` と同じタグに固定する。
`npm run e2e:setup` は既存 checkout のコミットと、依存・ビルド状態、両 HTML の
ハッシュを検証する。SDK の版が変われば checkout を更新し、上流の lockfile で
`npm ci` して再ビルドする。レジストリの最新版は参照しない。
未コミットの tracked ファイルがある場合は上書きせず、その場所を示して停止する。
検証済みの状態は `e2e-host/setup-state.json` に保存し、CI は SDK の固定版・
セットアップスクリプト・lockfile・Node 版をキーにキャッシュする。

- **ドット始まりのディレクトリに置かないこと。** express の `sendFile` が dotfile 扱いで
  404 を返すため、`.e2e/` ではなく `e2e-host/` にしている。
- basic-host の `npm run start` は bun を要求するので、Playwright からは
  ビルド済みの `serve.ts` を tsx で直接起動している。
- サンドボックスの origin が `http://localhost:8081` にハードコードされているため、
  ホスト側のポートは 8080 / 8081 から変えられない。

**検証ホスト（8080）はプレビューと共用する。止めない。**
サンドボックスの origin が `dist` に焼き込まれているため basic-host は同時に
1 つしか動かせず、E2E のたびに立て直すと見ている画面が数分消える。代わりに
**1 つのホストへ MCP サーバーを 2 つ登録**し、E2E は名前で選び分ける。

```bash
SERVERS='["http://localhost:3031/mcp","http://localhost:3131/mcp","http://localhost:3132/mcp"]' \
  npx tsx e2e-host/ext-apps/examples/basic-host/serve.ts
```

**会員機能は「サインイン済みのサーバー」で確かめる。** 匿名とサインイン済みを
1 つのプロセスで兼ねられないので、`IEKEI_DEV_VISITOR=誰か` を付けたもう 1 本
（3132）を並べ、E2E は名前で選ぶ（`MEMBER_SERVER_NAME`）。**この偽サインインの
道は [main.ts](../../server/main.ts) にしかない。** worker.ts に入れると、環境変数ひとつで
認証を迂回できる口を本番へ置くことになる。

**E2E は 1 件ずつ並列に流す（`fullyParallel`、CI は 4 worker）。** 1 本ずつ流すと
111 件で 4 分かかっていた。遅いのはテストではなく、CPU を 1 つしか使っていないこと
だった。`fullyParallel` が無いと並列はファイル単位になり、大半が入っている
app.spec.ts が 1 つの worker に偏って縮まない。

**CI では、さらに 3 つのジョブに分ける（`--shard`）。** 4 worker でも CI では 111 件に
163 秒かかり、2 分を切れなかった（ランナーが手元の約半分の速さで、1 本あたりの
「開いてアプリを呼ぶ」手間が均等に効く）。2 つでは、サインイン済み（順に流す 10 本）が
入る方が 89〜109 秒で、上限まで余裕が無かった。**必須チェックの名前「E2E (Playwright)」は
取りまとめのジョブが名乗る**——分けたジョブには「1/3」が付くため。取りまとめは
`if: always()` で必ず走らせ、分けたジョブの結果を自分で確かめる。スキップされると、
GitHub はスキップした必須チェックを「通った」と扱い、落ちた E2E が素通りする
（tests/deploy-workflow.test.ts が見張る）。

**ただし「サインイン済み」の describe だけは並列にしない**
（[e2e/visits.spec.ts](../../e2e/visits.spec.ts) の `mode: "default"`）。記録は 3132 の
プロセスに 1 つしか無く、各テストの頭で消してから始めるので、同時に流すと互いの記録を
消し合う（実測: この 1 行を外すと 4 worker に散って 3 件落ちた）。**3132 を使う
テストを足すときは、必ずこの describe の中に置くこと。**

**固定時間で待たない。** 遅い CI では待ちが先に切れ、偽の合格・偽の失敗が出る。
遅らせた応答で「引き戻されないこと」を見るときは、届いた合図を待ってから
`afterDelivered`、地図のアニメーションは `waitForMapSettled`（どちらも
[e2e/helpers.ts](../../e2e/helpers.ts)）。**待ち方を変えたら、直したはずの不具合を戻して
落ちるか確かめる。** 地図のテストは、待ち方を直したついでに縮める回数が変わり、
壊した実装でも通るようになっていた（縮めすぎて範囲が世界全体になり、確かめたい
経路を通らなくなる）。

**起動完了はtool結果の受信で判断する。** 初期画面でもタブは見えるため、タブの
可視確認だけでは結果を受け取ったとは言えない。`main[data-tool-result-ready]` と
`data-mode` を1回のブラウザ評価で読み、`waitForApp` は15秒の期限で待ち直す。
地図なら、その後に既存の初期寄せ・描き直しの完了まで待つ。

**E2Eの証跡は再試行で成功しても保存する。** 通常のspecは `e2e/fixtures.ts` の
`test` を使い、各試行にframeのattach/navigation/detach履歴を添付する。
URLのquery・本文・引数・認証値は保存しない。CIはHTML・全試行のtrace/画像・JSON結果を
shardごとに7日保存する。`e2e/evidence.spec.ts` が、使い捨ての子テストを1回失敗させて
次の試行で成功させ、最初の失敗の証跡が残ることを検証する。

**並列にしたら、速いときにだけ通っていたテストが出てくる。** CI で 4 worker を
同時に動かすと 1 本あたりが遅くなり、手元の 1 本ずつでは起きない順番が起きる。
実際に踏んだもの:

- **地図は開いた直後に一度描き直す。** 最初の 1 回だけ塊をズーム 5 の細かさで描き、
  地図のズーム（4）に合わせて描き直す。速いと描き直す前の小さい塊を押せてしまい、
  「先頭の塊を押せば寄る」が通っていた。止まった後の先頭は日本のほぼ全体を含む塊で、
  押しても寄らない。**押して寄せたいときは `smallestCluster` を使う**
- **地図の枠が画面に見切れていると、押下が空振りしていた（#58・直した）。** Leaflet は
  押下で枠へ `focus()` し、ブラウザが外側のページをスクロールするので、離した位置が
  ずれていた。いまは Leaflet より先にスクロールさせずに焦点を置く
  （[map-layers.ts](../../src/features/search/lib/map-layers.ts) の `focusWithoutScrolling`）。
  見切れた状態での押下は [e2e/map-offscreen.spec.ts](../../e2e/map-offscreen.spec.ts) が
  高さ 720 で意図して作って確かめる。**Playwright の click は押す前に対象を画面へ
  収めようとしてページを動かす**ので、押下のせいと取り違えないよう先に収めてから測る。
  `waitForApp` は地図で開いたら、止まるまで待つ
- **E2E から公開の Nominatim へ問い合わせない。** 地名の解決は決まった応答で返す
  （`IEKEI_GEOCODE_FIXTURE` と [e2e/fixtures/nominatim.json](../../e2e/fixtures/nominatim.json)）。
  並列の E2E から同時に問い合わせると規約（全体で 1 秒 1 回）を破る（実測: 2 本が
  70ms 間隔で出ていた）。手元のサーバーにも本番と同じ列（`GeocodeGate`）を置いたが、
  列はプロセスに 1 つで、2 つのジョブ（別々のマシン）や同時に走る PR の間は
  並べられない。列は `npm run dev` を規約に沿わせるために残してある。
  **新しい地名で検索するテストを書くときは、応答を fixtures に足すこと**（知らない地名は
  0 件で返る）

**落ちているサーバーは外されるが、CORS で弾かれるサーバーは一覧ごと止める。**
接続拒否なら黙って外れる（実測: 3132 を止めると残り 2 本が並んだ）。一方、
繋がるのに CORS の返事が無いと、選択欄が `Loading…` のまま止まり**どのサーバーも
選べなくなる**（実測: OPTIONS を横取りして CORS ヘッダを落としていた 3132 で発生）。
サーバーを足すときは、まず `OPTIONS /mcp` が `Access-Control-Allow-Origin` を
返すか確かめる。

- プレビュー用は 3031（`npm run dev`）、E2E 用は 3131（Playwright が毎回ビルドして起動）、
  **サインイン済みの検証用は 3132**（`IEKEI_DEV_VISITOR` を付けた同じサーバー）
- E2E 用だけ `IEKEI_SERVER_NAME` で名乗りを変え、`e2e/helpers.ts` が**名前で**選ぶ
- **並び順や option の数で選ばないこと。** 切り替えが反映される前に次へ進むと、
  古いサーバーのまま tool を呼び、**古いビルドを検証して通る**（実際に踏んだ）
- ホストは接続に失敗したサーバーを黙って外す（`allSettled`）ので、E2E 用が
  落ちていてもプレビューは壊れない

アプリはサンドボックス iframe の中の iframe で動くので、E2E のロケータは
`page.frameLocator("iframe").first().frameLocator("iframe").first()` になる。
この出入りは `e2e/helpers.ts` に隔離してある。
