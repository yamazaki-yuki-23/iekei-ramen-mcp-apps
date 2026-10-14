# 計測

## 使われているかを数える（Workers Analytics Engine）

tool の呼び出しを受け付けるたびに、worker.ts が 1 件書く（[server/lib/usage.ts](../../server/lib/usage.ts)）。
**数える口は server.ts の `registerTool` 1 か所（`onToolCall`）。** SDK が引数を検査した後に
呼ばれるので、引数が足りず弾かれた呼び出しは数えない（本文を読んで数えると入ってしまう）。
週ごとの件数は `npm run usage`。

- **書くのは tool 名・サインインの有無・スタンプの向き（押した／外した）だけ。**
  IP・生の `sub`・訪問者の id・引数（地名・座標・都道府県・店）は書かない。地名や
  座標は居場所に近く、店と時刻が並ぶと通う店が分かる。tests/usage.test.ts と
  tests/worker.test.ts が、書いた中身にこれらが無いことを確かめる
- **tool 名は決まった一覧（`COUNTED_TOOLS`）にあるものだけ書く。** 本文の tool 名は
  呼ぶ側が自由に書けるので、そのまま書くと任意の文字列が入る。tool を足したら
  一覧にも足す（サーバーの tool と食い違うとテストが落ちる）
- **401 を返した呼び出しは数えない。** 匿名でスタンプを押そうとしただけでは、まだ使われていない
- **書けなくても検索は止めない。** 無料枠は書き込み 1 日 10 万件・読み取り 1 日 1 万回。
  超えたときの挙動はドキュメントに無いので、`writeDataPoint` が投げても握りつぶす
- 手元の Node サーバー（main.ts）には binding が無いので、何も書かない
- **アカウントで Analytics Engine を有効にしないと、デプロイごと落ちる。**
  ダッシュボードの「Analytics Engine」で Enable を押す（続いて出るデータセット作成の
  画面は閉じてよい。データセットは最初の 1 件で自動で作られる）。有効にする前は
  `wrangler deploy` が「You need to enable Analytics Engine」で止まり、SQL API も
  権限が正しいトークンに 403 を返す（実測。権限不足と見分けが付かない）
- **読むには「Account Analytics: Read」の API トークンが要る。** wrangler のログイン
  （OAuth）には権限が無く、SQL API が 403 を返す。日本語の画面では「アカウント」→
  「アカウント分析」→「読み取り」。`.dev.vars` に `CLOUDFLARE_ACCOUNT_ID` と
  `CLOUDFLARE_ANALYTICS_TOKEN` を置く
- 件数は `sum(_sample_interval)` で数える。量が多いと間引いて保存されるので、行数を
  数えると少なく出る
- Web のページ閲覧（Cloudflare Web Analytics）は、Web 公開（#34）のときに足す
