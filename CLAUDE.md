# CLAUDE.md

家系ラーメンを探す MCP Apps。Cloudflare Workers にデプロイし、Claude などの
MCP Apps 対応ホストの中で UI が動く。

**issue は `/create-issue` で作る。** `gh issue create` を直接叩かない（ラベルの無い
issue がたまる）。項目は [.github/ISSUE_TEMPLATE/](.github/ISSUE_TEMPLATE/)、ラベルの基準は
[.github/LABELS.md](.github/LABELS.md)。

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

## アーキテクチャ

### MCP Apps の 2 部構成

tool と resource を `_meta.ui.resourceUri` で結び付けるのが MCP Apps の基本形。
UI 付き tool を足すときは、必ず既存の `resourceUri` を指すこと（UI は 1 つで
モードを切り替える設計なので、リソースを増やす必要はない）。

```
registerAppTool(..., { _meta: { ui: { resourceUri } } })
registerAppResource(server, resourceUri, ...)  // APP_HTML を返す
```

tool は 8 つ。UI 付き 7 つ（`search-iekei-ramen` / `find-nearby-iekei-ramen` /
`show-iekei-ramen-map` / `decide-iekei-ramen` と、サインインが要る
`stamp-iekei-ramen` / `show-visited-iekei-ramen` / `forget-my-iekei-ramen-visits`）、
UI 無しの `geocode-place`。

### UI へのデータ受け渡し

`structuredContent` に `PayloadSchema`（[src/lib/schema.ts](src/lib/schema.ts)）の形で載せる。
`outputSchema` を併記しないとホストに弾かれる。

**重要:** UI が `app.callServerTool()` で呼んだ結果には `ontoolresult` が発火しない。
戻り値から自分で `setPayload` する必要がある（[src/mcp-app.tsx](src/mcp-app.tsx) の `call`）。
`ontoolresult` はホスト（モデル）発の呼び出しにだけ来る。

### 迷ったら（3 軒に絞ってモデルに推させる）

**画面に出る名前は「迷ったら」。コード上の識別子は `decide` のまま**
（tool 名 `decide-iekei-ramen`、`DecidePanel`、`mode: "decide"`）。
文言だけ直したいときに、型や tool 名まで巻き込まないようにしてある。

564 件の一覧は選択肢地獄で、人は理由の無い長い一覧からは決められない。
3 軒まで落として、決める仕事はモデルに渡すのが `decide-iekei-ramen`。

- 候補の選び方は [src/lib/shortlist.ts](src/lib/shortlist.ts) に隔離してある。
  **勝手な「おすすめ順」を作らないこと。** このデータには評価も混雑も口コミも
  無いので、質の順位は付けられない。並べていいのは実際に持っている情報だけ
  （家系判定の段階・距離・営業時間の有無）。
- **乱数を使わない。**「別の候補を見る」は次の 3 軒であって、シャッフルではない。
  決定的なので、同じ条件なら毎回同じ並びになりテストできる。
- なぜこの 3 軒なのかは `describeBasis` が 1 文にする。**UI とモデルに同じ文を見せる。**
  別々に書くと、画面の説明と会話の説明がずれる。
- サーバーが返す text はモデルへの依頼文を兼ねている。使っていい材料を明示して
  縛らないと、モデルが「濃厚で人気」などと知識から補ってしまう。
- UI から呼ぶと `ontoolresult` が来ない＝依頼文がモデルに届かない。
  「この 3 軒から選ぶ」は `sendMessage` で候補ごと送り直す。

### まわる店（2〜3 軒の順路）

**画面に出る名前は「まわる店」。コード上の識別子は `route` / `stops`。**
「はしご」とは呼ばない——ラーメン好きの内輪語で、知らない人には梯子に読める。

決めたあと、ユーザーは必ずアプリを出て地図アプリを開く。そこが手作業のままだと
体験が途切れるので、順番・距離・地図アプリへの受け渡しまでを UI で完結させる。

- 順番の計算は [src/lib/route.ts](src/lib/route.ts) に隔離してある。
  上限 3 軒なので全順列（最大 6 通り）の総当たりで最短を選ぶ。**貪欲法は使わない**
  （1 軒目を間違えると戻る形になる）。同点は積んだ順を残すので、結果は決定的。
- **距離は直線距離。徒歩◯分に換算しない。** 経路探索のデータを持っていないので、
  時間を出すと「間に合うか」の判断材料に化ける。画面にも直線距離だと書く。
- 積んだ店は外側の `IekeiApp` が持ち、**検索し直しても消さない**。別の条件で
  見つけた店を足していくものなので、payload ごとに消すと組み立てられない。
  選択（1 軒・モデルに渡す）とは寿命も役割も別。
- **出発点も一緒に持つ。今の payload から取らない。** 店だけ残して出発点を
  payload 由来にすると、基準地点を持たないモード（検索フォーム・地図）へ移った
  瞬間に出発点が消え、順路が並べ替わる（実測: 「壱八家 → ありがた家・合計 918m」
  がタブを押しただけで「ありがた家 → 壱八家・合計 646m」になった）。最初の
  1 軒を入れたときの基準地点を、空になるまで持ち続ける。
- **渡せる先は Google マップだけ。Apple マップは載せない。** Google は
  `waypoints`（パイプ区切り、モバイルで 3 件まで）が公式にあり、3 軒の順路が
  そのまま開く（実測: 出発点 + 経由地 2 + 目的地で徒歩 28 分 / 1.9km）。
  **Apple の URL には経由地にあたるパラメータが無い。** `daddr` は目的地 1 つ
  だけで、Google 由来の `daddr=A+to:B` は 1 つの住所文字列として扱われ、解決
  できずに 1 軒目すら開かない（実測: `destination=35.5...%20to%3A35.4...`）。
  1 軒目までなら渡せるが、それでは「まわる店」の用を成さないので**ボタンごと
  置いていない**。Apple 側が経由地を受け取れるようになるまで戻さないこと。
- **渡すのは座標で、店名は渡さない。** 地図アプリ側は受け取った座標を自前の
  POI に寄せて表示するので、**同じ場所なのに別の店名で出ることがある**
  （実測: 壱八家の座標が「築地食堂源ちゃん 横浜スカイビル店」と表示された。
  同じ建物の別テナント）。店名で渡すと曖昧で別の店へ案内しかねないので、
  位置が確実な座標を優先する。
- 地図に線を引く節は、**「選んだ店へ寄せる」より後に置くこと。** 同じ更新で
  両方走ると後の地図移動が勝ち、前に置くと順路が画面の外へ出る。

### 訪問スタンプ（サインインが要る唯一の機能）

**匿名の検索は止めない。** `/mcp` は誰でも叩け、記録の 3 tool（`MEMBER_TOOLS`）
だけが、トークンの無い呼び出しに 401 を返す。ホストはこの 401 を見て
「アクセス権を更新」を出す（ChatGPT で実測）。

- 身元は Google に委ねる（`openid` だけ。**審査不要の範囲**）。受け取った `sub` は
  専用の鍵で HMAC してから保存し、**生の sub は持たない**。この鍵
  （`VISITOR_ID_PEPPER`）は二度と変えられない——変えると全員の記録が迷子になる
- 記録は D1、認可の状態は KV。認可サーバーは `@cloudflare/workers-oauth-provider` の
  `OAuthAuthorizationServer`。**`OAuthProvider` は使えない**（apiRoute の未認証を
  ハンドラ手前で 401 にするので、匿名が通らなくなる）
- **`/.well-known/oauth-protected-resource` は自分で返す**（[oauth.ts](oauth.ts)）。
  ライブラリは認可サーバー側の文書しか出さず、任せると 401 の指す先が 404 になる
- ライブラリは `cloudflare:workers` を取り込むので**動的 import**。KV の無い環境
  （Node の手元サーバー）では読み込ませず 501 を返す。読み込むとプロセスごと落ちる
  （ESM ローダの失敗は try/catch で拾えない）
- **UI から記録の tool を呼べるのはサインイン済みのときだけ。** 匿名で呼んでも
  401 を受けるだけで、ホストはサインインの画面を出さない（出すのはモデル発の
  呼び出しに対してだけ）。匿名の「行った」は `sendMessage` でモデルに頼み直す
  （文面は [shop-brief.ts](src/lib/shop-brief.ts)）
- **サインインしているかは `payload.visited` の有無で判る。** 匿名ではこの欄ごと
  落としてあるので、「1 軒も行っていない人」（空配列）と混ざらない
- **スタンプの結果で画面を差し替えない。** この tool の payload は
  `mode: "visited"` なので、素直に反映すると検索結果を見ていた人が「行った店」へ
  飛ばされる。記録（`visited` / `progress`）だけを差す（`applyVisits`）
- 制覇率の計算は [src/lib/progress.ts](src/lib/progress.ts)。**順位も称号も作らない**
  ——持っているのは軒数だけで、頑張りの度合いを語る材料が無い

### 使われているかを数える（Workers Analytics Engine）

tool の呼び出しを受け付けるたびに、worker.ts が 1 件書く（[src/lib/usage.ts](src/lib/usage.ts)）。
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

店舗データは OpenStreetMap 由来の静的 JSON（564 店舗 / 40 都道府県）。
市区町村と町名だけは座標からの逆引きで補っている（[areas.json](data/areas.json)）。
店舗データ自体は実行時に書き換えない。**書き込むのは訪問記録だけ**で、
そこだけ D1（`visits` テーブル）に入る（下の「訪問スタンプ」を参照）。

- [scripts/overpass-query.mjs](scripts/overpass-query.mjs) — **Overpass のクエリと取得の手順は
  ここ 1 か所だけ。** 全国取得と取り直しが別々に写しを持っていて、条件を足したときに
  全国側だけ直していた（取り直した県だけ古い基準で拾ったデータが混ざる）。
  拾うのは「ラーメン店で店名に家」「店名に家系か既知ブランド」「**現地で入力された説明の欄が
  家系**」の 3 通り。3 つめが無いと、名前に「家」を持たない家系が落ちる
  （実測: 東京都だけで壱角屋・春樹・大和家）。
- [scripts/fetch-shops.mjs](scripts/fetch-shops.mjs) — Overpass API を都道府県ごとに並列 3 で叩く。
  1 県あたり 25〜80 秒かかり、たまに失敗する。失敗した県は
  `node scripts/fetch-missing.mjs 京都府 宮城県` で個別に再取得してマージする。
  **失敗が残っていれば異常終了する。** 成功と同じ終了コードで返すと、県ごと欠けた
  osm-raw.json をそのまま次の工程へ渡す。このファイルは gitignore なので控えが無く、
  欠けたまま上書きすると取り直すしかない（実測: 752 → 435 件にした）。
- **Overpass の失敗は 3 通りあり、2 つは黙って通る。**
  ① 504 などの状態コード ② **応答が返らない**（`fetch` が例外を投げるので、状態コードを
  見る再試行には入らない。実測: 落ちた 9 県のうち 7 県がこれ） ③ **area を引けなくても
  HTTP 200 と空配列**（実測: 茨城県が 0 件で「成功」し、投げ直すと 20 件返った）。
  ③ は本当に 0 件の県（富山県・高知県）と区別が付かないので、**0 件は別の
  エンドポイントで 1 度だけ疑い、2 回目も 0 なら受け入れる**。
- [scripts/judgments.mjs](scripts/judgments.mjs) — TypeSafe に投げる質問と閾値。
  **判定を変えるならこのファイルだけ見ればいい。** 他所に判定ルールを散らさないこと。
- [scripts/judge-all.mjs](scripts/judge-all.mjs) — 家系判定を実行して `judged.json` に保存。
  確率も保存するので、閾値だけ変えたときは `data:rescore` が API 無しで作り直す。
- [scripts/find-duplicates.mjs](scripts/find-duplicates.mjs) — 200m 以内のペアが同一店舗かを判定。
- [scripts/fill-areas.mjs](scripts/fill-areas.mjs) — 住所の欠けている店を座標から逆引きする
  （Nominatim）。**OSM のタグには住所がほとんど入っていない**（564 件中 87 件しか
  市区町村を持たず、東京都の町田商店 14 店は 1 件も持たない）ので、同名の店を
  見分けられない。**判定の後・整形の前に実行する**——shops.json を見る作りにすると
  「整形 → 逆引き → もう一度整形」になる。座標が動いた店は引き直す。
- [scripts/build-dataset.mjs](scripts/build-dataset.mjs) — 判定結果の整形と重複除去。判定は持たない。
  areas.json は**欠けているところだけ**に使う（現地で入力された OSM のタグを上書きしない）。

## 気をつけること

**家系判定は推定。** OSM のタグを TypeSafe に渡してジャンルを判断させ、既知ブランドの
対応表と突き合わせている。3 段階あり、UI ではバッジで区別する。

|             | 件数 | 意味                                                           |
| ----------- | ---: | -------------------------------------------------------------- |
| `confirmed` |  345 | 家系だと名乗っている、または既知の家系ブランド                 |
| `likely`    |    7 | 名乗ってはいないが、ジャンルを家系と推定できる                 |
| `candidate` |  212 | ラーメン店で屋号が「〜家」だが、家系かどうかまでは判断できない |

**「家系ではない」と「判断できない」を混ぜないこと。** 前者は一覧に載せず、後者が
`candidate`。この区別のために段階を 3 つにしてある。**家系が最有力なのに確信が
足りない店も候補に入れる**——不明が低くても、別のジャンルと拮抗しているなら
判断は付いていない（実測: ラーメン三浦家 は家系 0.53 / 博多とんこつ 0.46 /
不明 0.01 で、家系ではないと判定した店と同じ扱いで消えていた）。

**名乗りは店名だけに書かれているとは限らない。** `description` や `cuisine:ja`、
`official_name` にも家系だと書いてある（実測: 8 件がこれで「判断できない」から
確定へ動いた）。**現地で入力された文字は、店名からの推測より強い。**
[shopState](scripts/judgments.mjs) が渡す欄を減らすと、判定材料ごと消える。

判定を変えるときは [scripts/judgments.mjs](scripts/judgments.mjs) の質問文か閾値を触る。
`KNOWN_BRANDS` と `EXCLUDE`（[scripts/classify.mjs](scripts/classify.mjs)）は事実の
対応表なのでコードに残してあり、モデルの判断より優先する。ジャンル語のリストは
質問の選択肢に移したので無い。**判定できない件数が多いときは、閾値ではなく
選択肢の不足か、渡していない欄を疑うこと**（中華料理店の選択肢が無くて `unclear` に
溜まっていた例、`description` を渡していなくて候補に溜まっていた例がある）。

**味の傾向は参考値。** OSM に味のデータは無く、既知ブランドから割り当てているだけ。
564 件中 377 件は `unknown`。これを事実として断定する文言を UI に書かないこと。
モデルに味を推測させたことがあるが、家系を名乗る店へ一律 `rich` を返してきたので
質問ごと外した。味は対応表からだけ取る。

**都道府県の enum は固定の 47 件**（`ALL_PREFECTURES`）。データ由来にすると
店舗 0 件の県が消えてスキーマが不安定になる。UI のプルダウンだけ
`PREFECTURES_WITH_SHOPS` で絞っている。

**ホストから来た寸法をインラインの style に直接書かない。** インラインは
CSS より強いので、ホストが 0 を送ってくるだけで見た目が壊れる。実際に
`safeAreaInsets` を `padding` に写していて、4 辺 0 を送る ChatGPT では
`.main` の `--space-4` がまるごと消えていた（Claude は `safeAreaInsets` を
送ってこないため React が属性を省き、こちらでは正常に見えていた）。
寸法は CSS 変数で渡し、足し算は CSS 側で `calc` する
（[src/lib/safe-area.ts](src/lib/safe-area.ts)）。**ホスト差は「片方で動いた」では
確かめられない。値を送ってこないホストは、間違いを隠す。**

**外部通信には CSP 宣言が必要。** 地図タイルも位置情報も `uiResourceMeta` に
書いていないと動かない（`csp.resourceDomains` と `permissions.geolocation`）。
新しいドメインを叩くときはここに追加する。

### 地図モード

- 重なる店は塊にまとめる（[src/lib/cluster.ts](src/lib/cluster.ts)）。**画面上の
  距離でまとめる。** 緯度経度の差で切ると、経度 1 度の長さが緯度で変わるので
  北と南で塊の大きさが変わる。並びは入力順のままで、乱数も並べ替えも使わない
- **升目に振り分けたら終わりにしない。** 境目を挟んだ数 px の 2 軒が別々の塊に
  なると、印は重なって読めないのに、まとまってもいない（実測: zoom 5 で 5 組・
  最接近 9.9px）。最後に代表点どうしの距離で寄せ直す
- **外から来た文字を Leaflet にそのまま渡さない。** `bindTooltip` は文字列を
  HTML として描く。基準地点の表示名は tool の引数と geocode の結果なので、
  文字として出す要素を組んでから渡す（[map-layers.ts](src/components/map-layers.ts)
  の `textTooltip`）
- **経度は丸めずに折り返す。** Leaflet は世界を横に繰り返して描くので、隣の
  複製まで動かすと経度が 480〜510 になる。両端を 180 に丸めると幅ゼロの範囲に
  なり、日本が見えているのに「この範囲で探す」が 0 件を返す（実測）。地図側は
  `worldCopyJump` で正規の世界へ戻す（ピンは複製に描かれないため）
- **地図の印はキーボードからも押せる。** 一覧は 20 件で切れるので、地図が
  唯一の入口になる店が出る。Leaflet は円（SVG の path）にも divIcon にも
  tabindex と Enter を付けないので、`makeActivatable` で足す
- **塊はキーボードからも開ける。** 一覧は 20 件で切れるので、塊を開けないと
  大半の店へ辿り着けない。`keyboard: true` が付けるのは tabindex だけで、
  **Enter で開く処理は Leaflet に無い**（keypress を見ているのはポップアップの
  都合）。自分で受けること
- **塊を開くときに引き戻さない。** 寄る上限を固定にすると、すでに 18〜19 まで
  寄っているところで押したときに 17 へ戻される（実測）。寄り切っても解けない
  塊があるので、開くたびに遠ざかることになる
- **塊は寄れば解ける、とは限らない。** 実データには 5.2m しか離れていない 2 軒が
  あり（ろくの家 / 稲和家ラーメン）、最大ズーム 19 でも 21.1px で塊のまま。
  押した塊の中身は必ず一覧にも出すこと。寄せるだけの逃げ道しか無いと、
  その 2 軒は地図から永久に選べない
- **効いている条件はすべて名乗る。** 範囲と都道府県は同時に効くことがあり
  （モデルは両方付きで呼べる）、絞り込みは両方の重なりになる。範囲だけを
  名乗ると、枠が県境をまたいだときに県外の店が黙って落ちているのに
  「見えている範囲の全部」と読めてしまう（「地図に出ている範囲（神奈川県）」）
- **「どこ」を表す語は [src/lib/scope.ts](src/lib/scope.ts) から取る。** 画面の
  見出しとモデルへの文で同じものを使う。別々に書いたら、画面に「全国の家系
  ラーメン 489 件」と出ているのにモデルには「地図に出ている範囲」と伝わっていた
- Leaflet に触る部分は [src/components/map-layers.ts](src/components/map-layers.ts)
  に集める。MapView が持つのは「いつ描くか」だけ
- **「この範囲で探す」は押した瞬間の範囲を読む。** 直近の移動を覚えておく形に
  すると、寄せ終わる前に押されたときに古い範囲で探す（実測: 塊を押した直後に
  押すと全国 564 件のまま返った）
- **いま効いている範囲は payload だけで判断しない。** 「この範囲で探す」の応答が
  返る前に味を変えると、そのときの payload にはまだ範囲が入っていない。payload 頼りだと
  2 本目が全国検索になり、**あとから返った方が勝つ**ので範囲の結果が捨てられる
  （実測: 応答を 1.5 秒遅らせて味を押すと見出しが「全国」に戻った）。押した時点で
  [use-mode-switch](src/hooks/use-mode-switch.ts) が覚え、落とすときも同じ場所で落とす
- **範囲と基準地点は payload から地図の初期表示に渡す。** payload が差し替わると
  `IekeiAppInner` ごと作り直されるので、地図は毎回新品で生まれる。覚えていた
  つもりの画角は残らない（実測: 489 件に絞った直後、もう一度押すと 564 件）
- 全画面は `requestDisplayMode`。**返ってきた mode を正とする**（要求と違う
  モードが返ることがある）。`availableDisplayModes` に無いホストでは釦ごと出さない
- **広げる対象が消えたら畳む。** 畳む釦は地図モードにしか無いので、全画面のまま
  別のタブへ移ると釦ごと消え、ホストは全画面のままなのに戻せなくなる。押した
  場所ではなく「いま広げる対象があるか」で畳む（モデルが別の tool を呼んだ
  ときも同じことが起きるため）

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
道は [main.ts](main.ts) にしかない。** worker.ts に入れると、環境変数ひとつで
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
（[e2e/visits.spec.ts](e2e/visits.spec.ts) の `mode: "default"`）。記録は 3132 の
プロセスに 1 つしか無く、各テストの頭で消してから始めるので、同時に流すと互いの記録を
消し合う（実測: この 1 行を外すと 4 worker に散って 3 件落ちた）。**3132 を使う
テストを足すときは、必ずこの describe の中に置くこと。**

**固定時間で待たない。** 遅い CI では待ちが先に切れ、偽の合格・偽の失敗が出る。
遅らせた応答で「引き戻されないこと」を見るときは、届いた合図を待ってから
`afterDelivered`、地図のアニメーションは `waitForMapSettled`（どちらも
[e2e/helpers.ts](e2e/helpers.ts)）。**待ち方を変えたら、直したはずの不具合を戻して
落ちるか確かめる。** 地図のテストは、待ち方を直したついでに縮める回数が変わり、
壊した実装でも通るようになっていた（縮めすぎて範囲が世界全体になり、確かめたい
経路を通らなくなる）。

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
  （[map-layers.ts](src/components/map-layers.ts) の `focusWithoutScrolling`）。
  見切れた状態での押下は [e2e/map-offscreen.spec.ts](e2e/map-offscreen.spec.ts) が
  高さ 720 で意図して作って確かめる。**Playwright の click は押す前に対象を画面へ
  収めようとしてページを動かす**ので、押下のせいと取り違えないよう先に収めてから測る。
  `waitForApp` は地図で開いたら、止まるまで待つ
- **E2E から公開の Nominatim へ問い合わせない。** 地名の解決は決まった応答で返す
  （`IEKEI_GEOCODE_FIXTURE` と [e2e/fixtures/nominatim.json](e2e/fixtures/nominatim.json)）。
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

## 動作確認

```bash
npm run dev
# 別ターミナル
npm run e2e:setup
SERVERS='["http://localhost:3031/mcp"]' npx tsx e2e-host/ext-apps/examples/basic-host/serve.ts
# → http://localhost:8080
```

Cloudflare 側の確認は `npm run dev:worker`。バンドルサイズは gzip で 3 MiB が無料枠の上限、
現状 413 KiB。

## デプロイ

**main にマージすると本番へ自動で出る。** CI の `deploy` ジョブが、テストが通ってから
`wrangler deploy` を実行し、`/health` が 200 を返すまで確認する。
認証はリポジトリのシークレット（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`）。

手元から出したいときだけ `npm run deploy`。戻すときは `npx wrangler rollback`。

## デザイン

**見た目の決まりは [DESIGN.md](DESIGN.md) に全部書いてある。UI を足す前に読むこと。**

デジタル庁デザインシステム（DADS）の基礎に倣った 3 段構造（プリミティブ →
セマンティック → 部品）で、色だけ家系の茶赤に置き換えている。
値は [src/global.css](src/global.css) のトークンから取り、部品側に生の px と色を書かない。

`npx react-doctor design` が UI 側の作法（見出しの絵文字など）を見る。

## コード規約

- コメントは日本語。「なぜそうしたか」を書く。何をしているかはコードで表す。
- UI の文言も日本語。**続く 1 文は改行で分けない**（JSX の改行は空白 1 個に
  畳まれ、和文だと語の途中に隙間が空く）。長い文は定数に出す。
- 型は [src/lib/types.ts](src/lib/types.ts) に集約。zod スキーマは
  [src/lib/schema.ts](src/lib/schema.ts) で、両者は手で同期させている。
