# Web の静的ページと外向けの案内

## Web の静的ページ

`npm run dev:worker` を実行し、Wranglerが表示するURLの `/` を開く。
既存の3031・8080はそのまま使い、Wrangler用の空いているポートを使う。
`/mcp` は同じoriginのMCPエンドポイントで、認可・メタデータ・health・whereamiも
Workerが返す。`wrangler.jsonc` の `assets.run_worker_first` にその経路を並べている。

`npm run build:ui` はMCP用の単一HTMLを埋め込んだ後、`index.html` と
`src/features/search/main-web.tsx` を `dist/web/` にビルドする。CIと通常のデプロイも同じコマンドを使う。
Static Assetsはこのディレクトリだけを配信するので、MCPの埋め込みHTMLやソースは配信しない。
**Webの最初のJSに入れないもの**（#154）: MapLibre（地図を開くまで要らない。`ResultView.tsx` の
`React.lazy` で分け、結果を出した後の空き時間に先読みする）、zod（画面は報告の受付文
`src/utils/report-accepted.ts` だけを読む）。MCPクライアントは `src/features/search/components/WebConnection.tsx` の読み込み時に取りに行く。
未定義のURLには404を返し、MCPや認可の誤ったURLにWebのHTMLを返さない。ブラウザで開いた
（`Accept: text/html` の GET）存在しないページにだけ、`worker.ts` が `ASSETS` から `404.html` を
状態 404 で返す（#169。Worker があると `not_found_handling` は効かない）。`/.well-known/*` は除く。
`/assets/*`（名前に中身のハッシュが入る）だけを `public/_headers` で1年・`immutable` にする。
HTMLやハッシュの無いファイルは既定の `max-age=0` のまま（#153）。
トップの `#root` は画面1枚分を空けておく（`src/features/search/styles/main-web.css`）。JSより先に描かれる下のリンクが
押し下げられて CLS が 0.33 になっていた。接続できなかった画面（`data-connection="failed"`）は短いので空けない。つながった後の警告では空けたまま。
本番は#41の決定に従い `https://iekeiramen.com/`。workers.devは再開しない。
http で来たら https へ送る（#168）。Worker を通る経路（`run_worker_first`）は `worker.ts` が
GET/HEAD を 301・それ以外を 308 で送る（認可のメタデータが http の URL を案内しないように）。
静的ページは Worker より先に返るので、ゾーン `iekeiramen.com` の「SSL/TLS → エッジ証明書 →
Always Use HTTPS」をオンにして送る。HSTS は `public/_headers`（`includeSubDomains`・`preload` なし）。

静的ページには `public/_headers` で CSP と `frame-ancestors 'none'`（`X-Frame-Options: DENY`）を付ける（#268）。
読み込むのは自分の origin だけで、例外は地図（MapLibre）のワーカーとカメラの画像に要る `blob:`・`data:` と、
React と `/match/` のインラインのスタイルと、Cloudflare Web Analytics（`static.cloudflareinsights.com` の
スクリプトと `cloudflareinsights.com` への送信）。Web Analytics はエッジが差し込むので E2E には出ず、
許し忘れると本番だけ計測が消える（#268 で一度止めた）。**読み込み先を足したら CSP も足す。** vite preview は `_headers`
を読まないので、`e2e/csp.spec.ts` が同じ値を付けて主なページを開き、違反 0 件を確かめる。zod は eval を
試して違反を出すので、Web の入口の最初で `src/utils/zod-jitless.ts` を読み込む。会話の中（MCP Apps）の
画面はホストの枠で動き、`_headers` は効かない。

## 検索エンジン向けの静的ページ

`npm run build:ui` の最後に `scripts/build/build-seo.mjs` が `data/shops.json` から
都道府県・市区町村・店舗のHTML、`sitemap.xml`、`robots.txt`を `dist/web/` に生成する。
生成物はGitに入れず、データの補正がマージされれば次のビルドで更新される。
Web用Viteの出力を消す処理の後に生成し、WorkerのAPI経路は変更しない。

都道府県は `/area/kanagawa/` のような固定の英字、市区町村はその下の日本語名を
URLエンコードする。住所から区を推測せず、逆引きを反映した `shops.json` の `city` を使う。
店舗は `/shop/node-1774529495/` のように安定IDの `/` を `-` にしたURLを使う。
市区町村がない手動追加店も都道府県・店舗のページに載せる。

`candidate` の店舗には `noindex` を付け、sitemapから除く。判定の段階はページに出さない
（#144）。代わりに各ページの但し書きで「家系ではない店が混ざりうる」ことと、アプリの
「店舗情報を報告する」への道を案内する。RestaurantのJSON-LDは店名・住所・座標だけに
限り、評価・価格・営業情報を追加しない。各ページに推定の但し書きとOSMの出典を出す。
変更日時の根拠がないため、sitemapにビルド時刻を `lastmod` として載せない。
**店が全部 `candidate` の県・市区町村ページも `noindex` にし、sitemapから外す**（#155）。
未判定の店しか無い一覧は、検索に載せない店へのリンクだけの薄いページになる（実測: 61ページ）。
**市区町村ページは、未判定でない店が 2 軒未満なら `noindex` にし、sitemapから外す**（#169）。
1 軒だけのページは中身がその店のページとほぼ同じになる（実測: index する市区町村 149 → 53）。
県ページからのリンクは残す。
**系列のページ（`/chain/machida-shoten/` のような英字）は、店が 2 軒以上の系列だけ作る**（#309）。
英字の名前は `seo-pages.mjs` の `chainSlugs` が持つ（#326）。表記は系列の公式サイトのドメイン・英字表記に合わせ、無ければヘボン式。
**表に無い系列にページが要るとビルドが止まる**ので、`chainSlugs` に足す。#309 で公開した日本語の URL（`/chain/%E7%94%BA…/`）は、
`build-seo.mjs` が `dist/web/_redirects` に足した行で 301 にする（`_redirects` は届いたままのエンコード済みのパスと突き合わせる）。
系列は `data/verified.json` の記録（`basis: chain`・`status: open`）で決め、`shops.json` の `brand`
（店名からの推定）では決めない（記録と 25 軒食い違う）。中身は都道府県ごとの店のカードで、
`/area/` の「系列」の段から辿れる。系列の説明・歴史・味は書かない。
市区町村と店舗のページには、見えている「◯◯の一覧」のリンクと同じ階層の `BreadcrumbList` を
付ける。全ページの OGP はトップと同じ `og-card.png` を使い、文言は title と description に合わせる。

アプリへのリンクは、URL の形で最初に開くものが決まる（`src/features/search/utils/web-entry.ts`）。

| URL                                    | 開くもの                                                           |
| -------------------------------------- | ------------------------------------------------------------------ |
| `/?prefecture=神奈川県&keyword=横浜市` | 既存の匿名検索（`search-iekei-ramen`）                             |
| `/?prefecture=神奈川県`                | その県の「迷ったら」（`decide-iekei-ramen`、#152）                 |
| `/?prefecture=神奈川県&view=map`       | その県の地図（`show-iekei-ramen-map`、県のページの主ボタン、#307） |
| `/`（引数なし）                        | 「迷ったら」。接続元から推定した地域の 3 軒（#144・#152）          |

不正な県・100文字を超えるキーワードはトップと同じ入口へ戻す。市区町村・店名は既存の部分一致検索なので、同名の店舗も
結果に含まれる場合がある。

アイコンは大きさで描き分ける（#130）。タブ・検索結果（16〜96px）は `public/favicon.svg`
（看板の黄に海苔3枚。ロゴのピンと丼は16pxで潰れるため）、ホーム画面・ディレクトリ用は
`scripts/assets/icons/logo-icon.svg`（ロゴそのもの）が正本。`node scripts/assets/render-favicon.mjs` で
96pxのPNG・180pxのホーム画面用PNG・512pxのディレクトリ用PNG（`icon-512.png`）を作る。
OGPは `scripts/assets/og-card.svg` が正本で、`node scripts/assets/render-og-card.mjs` で作る。
再生成にはPlaywrightのChromiumが必要。通常のCIではコミット済み画像を配信する。

Search Consoleの所有権は2026-10-04に確認済み。DNSのTXTレコードを消さない。
ページ公開後、オーナーがドメイン `iekeiramen.com` の「サイトマップ」で
`https://iekeiramen.com/sitemap.xml` を送信し、送信日をissueに残す。

## プライバシーポリシーと利用規約（`/privacy`・`/terms`、#198）

正本は `docs/legal/*.md`。`npm run build:ui` の最後に `scripts/build/build-seo.mjs` が `legalPages`（`scripts/build/seo-pages.mjs`）で
`dist/web/privacy.html`・`terms.html` を作る（静的アセットが `/privacy`・`/terms` で返す）。`【` が残っているとビルドが止まる。
Web のすべてのページの下と `/connect` のフッターに 2 つへのリンクを出す（`src/utils/legal-links.ts`）。
**保存するもの・外部に送る先・端末に残すものを変えたら、規約も直す**（直す箇所の表は [docs/legal/README.md](../legal/README.md)）。

## ChatGPT のディレクトリへの申請（#47）

申請は ZIP のアップロード（platform.openai.com/plugins）。中身の正本は `submission/chatgpt/`（`plugin.json`・`mcp.json`・
`assets/logo.png`）で、`npm run submission:chatgpt` が `dist/iekei-ramen-chatgpt.zip` を作る。上限と形は
`tests/chatgpt-submission.test.ts` が見る（公式: developers.openai.com/plugins/deploy/submission）。
**審査用のアカウント・審査の方へのメモ・動画の URL は ZIP に入れず、申請画面で入れる**（ZIP に入れると拒否される）。
掲載の文・画像・tool を変えたら ZIP を作り直して上げ直す（MCP サーバーの変更は OpenAI が毎日読み直す）。

ドメインの確認は `/.well-known/openai-apps-challenge` が、Worker の Secret `OPENAI_APPS_CHALLENGE` の文字列だけを
`text/plain` で返す（`worker.ts`）。申請画面で受け取った文字列を、Cloudflare のダッシュボード（Workers → `iekei-ramen-mcp` →
設定 → 変数とシークレット → 追加、種類は「シークレット」）に入れれば、デプロイ無しで返る。vars に書くと CI のデプロイで上書きされる。

## チャットへの接続案内

チャットへの接続案内は `public/connect.html` を `/connect` で配信する。
トップの静的ナビゲーションからリンクし、MCPの `/mcp` は変更しない。
登録URLのコピーは `public/connect.js`。Clipboard APIを使えない場合は入力欄を
選択して手動コピーを案内する。JavaScriptが無効でもURLと説明を読める。
ホストへの追加手順は実機で確認してから載せ、確認日をissueに残す。
検索用の接続は「認証なし」を先に案内する。訪問記録を使う人向けのOAuth接続は
別の手順にし、検索を始める段階でGoogleへのサインインを要求しない。
Claudeの本番URL追加は未確認であることをページにも明記する。

## 看板の書体（#301）

トップの一言の看板だけ、Dela Gothic One（OFL）を使う。全体は 2.5MB あるので、一言に使う字だけを切り出した
`public/fonts/dela-gothic-one-catch.woff2`（2.8KB）を置いている。ライセンスは同じ場所の `dela-gothic-one-OFL.txt`。

- **一言（`PromiseHero` の文字）を変えたら、切り出し直す。** 入っていない字は端末の書体で描かれ、1 文字だけ形が変わる
- 読み込みは `main-web.css` の `@font-face`（`font-display: optional`）と、`index.html` の preload。間に合わなければ
  端末の書体のまま描き、あとから入れ替えない（ずれを出さない）
- npm の依存は足さない。切り出しは手元で 1 回だけ行う

```bash
curl -sLO https://github.com/google/fonts/raw/main/ofl/delagothicone/DelaGothicOne-Regular.ttf
uvx --from 'fonttools[woff]' pyftsubset DelaGothicOne-Regular.ttf \
  --text="近くに、まだ知らない家系がある。" --flavor=woff2 --layout-features='*' --no-hinting \
  --output-file=public/fonts/dela-gothic-one-catch.woff2
```
