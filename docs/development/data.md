# 店舗データ

## データ

店舗データは OpenStreetMap 由来の静的 JSON（564 店舗 / 40 都道府県）。
市区町村と町名だけは座標からの逆引きで補っている（[areas.json](../../data/areas.json)）。
店舗データ自体は実行時に書き換えない。訪問記録はD1の`visits`、匿名の訂正報告は
同じD1の`reports`に入る。報告から店舗データを自動で変更することはない。

- [scripts/data/overpass-query.mjs](../../scripts/data/overpass-query.mjs) — **Overpass のクエリと取得の手順は
  ここ 1 か所だけ。** 全国取得と取り直しが別々に写しを持っていて、条件を足したときに
  全国側だけ直していた（取り直した県だけ古い基準で拾ったデータが混ざる）。
  拾うのは「ラーメン店で店名に家」「店名に家系か既知ブランド」「**現地で入力された説明の欄が
  家系**」の 3 通り。3 つめが無いと、名前に「家」を持たない家系が落ちる
  （実測: 東京都だけで壱角屋・春樹・大和家）。
- [scripts/data/fetch-shops.mjs](../../scripts/data/fetch-shops.mjs) — Overpass API を都道府県ごとに並列 3 で叩く。
  1 県あたり 25〜80 秒かかり、たまに失敗する。失敗した県は
  `node scripts/data/fetch-missing.mjs 京都府 宮城県` で個別に再取得してマージする。
  **失敗が残っていれば異常終了する。** 成功と同じ終了コードで返すと、県ごと欠けた
  osm-raw.json をそのまま次の工程へ渡す。このファイルは gitignore なので控えが無く、
  欠けたまま上書きすると取り直すしかない（実測: 752 → 435 件にした）。
- **Overpass の失敗は 3 通りあり、2 つは黙って通る。**
  ① 504 などの状態コード ② **応答が返らない**（`fetch` が例外を投げるので、状態コードを
  見る再試行には入らない。実測: 落ちた 9 県のうち 7 県がこれ） ③ **area を引けなくても
  HTTP 200 と空配列**（実測: 茨城県が 0 件で「成功」し、投げ直すと 20 件返った）。
  ③ は本当に 0 件の県（富山県・高知県）と区別が付かないので、**0 件は別の
  エンドポイントで 1 度だけ疑い、2 回目も 0 なら受け入れる**。
- [scripts/data/judgments.mjs](../../scripts/data/judgments.mjs) — TypeSafe に投げる質問と閾値。
  **判定を変えるならこのファイルだけ見ればいい。** 他所に判定ルールを散らさないこと。
- [scripts/data/judge-all.mjs](../../scripts/data/judge-all.mjs) — 家系判定を実行して `judged.json` に保存。
  確率も保存するので、閾値だけ変えたときは `data:rescore` が API 無しで作り直す。
- [scripts/data/find-duplicates.mjs](../../scripts/data/find-duplicates.mjs) — 200m 以内のペアが同一店舗かを判定。
- [scripts/data/fill-areas.mjs](../../scripts/data/fill-areas.mjs) — 住所の欠けている店を座標から逆引きする
  （Nominatim）。**OSM のタグには住所がほとんど入っていない**（564 件中 87 件しか
  市区町村を持たず、東京都の町田商店 14 店は 1 件も持たない）ので、同名の店を
  見分けられない。**判定の後・整形の前に実行する**——shops.json を見る作りにすると
  「整形 → 逆引き → もう一度整形」になる。座標が動いた店は引き直す。
- [scripts/data/build-dataset.mjs](../../scripts/data/build-dataset.mjs) — 判定結果の整形と重複除去。判定は持たない。
  areas.json は**欠けているところだけ**に使う（現地で入力された OSM のタグを上書きしない）。

### 判定の段階と住所の出どころ（README から移した）

判定した結果の 564 軒 / 40 都道府県（家系 345・家系の可能性 7・家系か未判定 212。2026-10-11 の `data/shops.json`）。**段階は画面にも README にも出さない**（#144）。

- 出典は [OpenStreetMap](https://www.openstreetmap.org/copyright) の contributors（ODbL）です。
- 家系判定は推定です。OSM のタグを [TypeSafe](https://typesafe.ai) に渡して
  ジャンルを判断させ、既知ブランドの対応表と突き合わせています。3 段階あります。
  - **家系** … 地図の記載が家系を名乗っている、または既知の家系ブランド
  - **家系の可能性** … 名乗ってはいないが、記載からジャンルを家系と推定できる
  - **家系か未判定** … ラーメン店で屋号が「〜家」だが、記載からは判断できない
  - 「記載」は店名だけではありません。OSM の説明欄（`description`）や
    `cuisine:ja` に「横浜家系ラーメン」と書かれている店も「家系」になります。
  - 別ジャンルだと判断できた店（博多・塩・味噌・つけ麺・中華料理店・食堂など）は
    一覧に載せていません。
- **味の傾向は参考値です。** OSM に味のデータは無いため、既知のブランドから
  `直系・濃厚` / `クリーミー` / `チェーン・万人向け` を割り当てています。
  判定できない店舗は `情報なし` になります。
- 営業時間・電話番号も OSM 由来で、実際と異なる場合があります。
- **市区町村と町名は座標から引いています。** OSM の店舗タグに住所はほとんど
  入っておらず（564 件中 87 件）、同じ名前のチェーン店を見分けられないためです。
  座標から補うのは**市区町村と町名まで**で、番地は足しません（店の位置を特定する
  ためではなく、見分けるためです）。**OSM のタグに番地が入っている店（89 件）は、
  そのタグの住所がそのまま出ます**——現地で入力された住所の方が確かなので、
  座標由来の地名で上書きしません。

### データを更新する

```bash
npm run data:fetch    # OSM から取得（20〜30 分）      → data/osm-raw.json
npm run data:judge    # 家系判定（要 TYPESAFE_API_KEY） → data/judged.json
npm run data:dedupe   # 重複判定（要 TYPESAFE_API_KEY） → data/duplicates.json
npm run data:areas    # 住所の逆引き（API キー不要）    → data/areas.json
npm run data:build    # 整形（API キー不要）            → data/shops.json
```

`data:judge` と `data:dedupe` は [TypeSafe](https://typesafe.ai) を使うので
`TYPESAFE_API_KEY` が要ります。`.dev.vars` に書いておけば読まれます
（`node --env-file-if-exists` を使うので Node 22.9 以降）。全件で $0.05 ほど。

`data:judge` は判定済みのものを飛ばすので、取り直しても差分だけで済みます
（タグが変わった要素は判定し直します）。判定されていない要素が残っていると
`data:build` はエラーで止まります。

判定に関わるファイルを変えたときに何を再実行するかは、変えた場所で決まります。
判定の材料（確率・スコア）は保存してあるので、方針を変えるだけなら API は要りません。

| 変えたもの                                                | 再実行するもの                                      | API  |
| --------------------------------------------------------- | --------------------------------------------------- | ---- |
| 家系判定の閾値（`CONFIRMED_AT` など）と `decide()`        | `data:rescore` → `data:areas` → `data:build`        | 不要 |
| `KNOWN_BRANDS` / `EXCLUDE`（`scripts/data/classify.mjs`） | `data:rescore` → `data:areas` → `data:build`        | 不要 |
| 重複の閾値（`SAME_SHOP_AT`）                              | `data:build` だけ                                   | 不要 |
| 質問文（`QUESTIONS`）、`shopState`                        | `data:judge -- --all` → `data:areas` → `data:build` | 要   |
| 重複判定の質問（`PAIR_QUESTION`）、`PAIR_RADIUS_M`        | `data:dedupe` → `data:build`                        | 要   |

**判定を変えたら `data:areas` を挟みます。** 判定が変わると、それまで一覧に
載っていなかった店が載ることがあり、その店の地名はまだ引いていません
（`data:areas` は「いま載る店」だけを対象にするため）。挟まないと、その店だけ
市区町村が空のまま出ます。引き直しは差分だけなので、数秒で終わります。

重複の閾値だけを変えるときは要りません。重複と判定された店も含めて引いてあるので、
どちらが残っても地名は揃っています。

`rescore` は保存済みの確率を `decide()` に通し直すだけで、モデルには問い合わせません。
質問文を変えたら確率そのものが変わるので `rescore` では反映されません。

**対応表（`KNOWN_BRANDS` / `EXCLUDE`）を変えたら `rescore` が要ります。**
表は `knownFacts()` 経由で判定と味の両方に効きますが、OSM のタグは変わらないので
`data:judge` は 1 件も処理しません。`data:build` も保存済みの判定を信じるため、
`rescore` を挟まないと古い分類のままビルドが成功してしまいます。

`SAME_SHOP_AT` は `data:build` が保存済みスコアに毎回当てるので、`rescore` も
`dedupe` も要りません。判定が古いまま進むことはなく、`osm-raw.json` と
食い違っていれば `data:build` がエラーで止まります。
