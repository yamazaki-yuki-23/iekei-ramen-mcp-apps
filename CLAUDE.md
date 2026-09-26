# CLAUDE.md

家系ラーメンを探す MCP Apps。Cloudflare Workers にデプロイし、Claude などの
MCP Apps 対応ホストの中で UI が動く。

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
npm run data:rescore # 閾値だけ変えたとき（API 不要）
npm run data:build   # judged.json + osm-raw.json → shops.json（API 不要）

npm run doctor      # react-doctor（React 固有の壊れ方を見る）
npm test            # vitest（距離計算・家系判定・MCP サーバーの結合テスト）
npm run e2e         # playwright（basic-host 経由の実ブラウザテスト）
npm run lint        # oxlint（--deny-warnings。警告も落とす）
npm run format      # oxfmt（--check は format:check）
npm run knip        # 未使用のコード・依存の検出
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

tool は 5 つ。UI 付き 4 つ（`search-iekei-ramen` / `find-nearby-iekei-ramen` /
`show-iekei-ramen-map` / `decide-iekei-ramen`）と、UI 無しの `geocode-place`。

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

558 件の一覧は選択肢地獄で、人は理由の無い長い一覧からは決められない。
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
- **塊はキーボードからも開ける。** 一覧は 20 件で切れるので、塊を開けないと
  大半の店へ辿り着けない。`keyboard: true` が付けるのは tabindex だけで、
  **Enter で開く処理は Leaflet に無い**（keypress を見ているのはポップアップの
  都合）。自分で受けること
- **塊は寄れば解ける、とは限らない。** 実データには 5.2m しか離れていない 2 軒が
  あり（ろくの家 / 稲和家ラーメン）、最大ズーム 19 でも 21.1px で塊のまま。
  押した塊の中身は必ず一覧にも出すこと。寄せるだけの逃げ道しか無いと、
  その 2 軒は地図から永久に選べない
- **「どこ」を表す語は [src/lib/scope.ts](src/lib/scope.ts) から取る。** 画面の
  見出しとモデルへの文で同じものを使う。別々に書いたら、画面に「全国の家系
  ラーメン 489 件」と出ているのにモデルには「地図に出ている範囲」と伝わっていた
- Leaflet に触る部分は [src/components/map-layers.ts](src/components/map-layers.ts)
  に集める。MapView が持つのは「いつ描くか」だけ
- **「この範囲で探す」は押した瞬間の範囲を読む。** 直近の移動を覚えておく形に
  すると、寄せ終わる前に押されたときに古い範囲で探す（実測: 塊を押した直後に
  押すと全国 558 件のまま返った）
- **いま効いている範囲は payload だけで判断しない。** 「この範囲で探す」の応答が
  返る前に味を変えると、そのときの payload にはまだ範囲が入っていない。payload 頼りだと
  2 本目が全国検索になり、**あとから返った方が勝つ**ので範囲の結果が捨てられる
  （実測: 応答を 1.5 秒遅らせて味を押すと見出しが「全国」に戻った）。押した時点で
  [use-mode-switch](src/hooks/use-mode-switch.ts) が覚え、落とすときも同じ場所で落とす
- **範囲と基準地点は payload から地図の初期表示に渡す。** payload が差し替わると
  `IekeiAppInner` ごと作り直されるので、地図は毎回新品で生まれる。覚えていた
  つもりの画角は残らない（実測: 489 件に絞った直後、もう一度押すと 558 件）
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
SERVERS='["http://localhost:3031/mcp","http://localhost:3131/mcp"]' \
  npx tsx e2e-host/ext-apps/examples/basic-host/serve.ts
```

- プレビュー用は 3031（`npm run dev`）、E2E 用は 3131（Playwright が毎回ビルドして起動）
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
