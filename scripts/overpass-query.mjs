/**
 * Overpass に投げるクエリ。**1 か所しか持たない。**
 *
 * 全国取得（fetch-shops）と失敗県の取り直し（fetch-missing）が別々に同じ
 * クエリを抱えていて、条件を足したときに全国側だけ直していた。取り直した県は
 * 古い条件のまま混ざるので、**どの県かによって拾う基準が違うデータ**ができる。
 * 判定ルールを judgments.mjs 1 つに集めているのと同じ理由で、ここも 1 つにする。
 */

/**
 * 現地で入力された説明の欄。**店名だけを見ていると取りこぼす。**
 *
 * これを足すまで、名前に「家」を持たない家系が落ちていた（実測: 東京都だけで
 * 壱角屋・春樹・大和家 の 3 件。壱角屋は屋号が「〜屋」、春樹は既知ブランドなのに
 * 店名に手がかりが無く、大和家は cuisine が ramen でなかった）。
 */
const DECLARING_TAGS = [
  "cuisine:ja",
  "description",
  "description:ja",
  "loc_name",
  "official_name",
  "branch",
];

/**
 * 家系だと名乗っている綴り。判定（judgments.mjs の name_declares_iekei）が
 * 名乗りと見なす**正しい綴り**と揃える。
 *
 * 取得が「家系」の 3 文字だけを探していると、判定は「横浜ラーメン」を名乗りと
 * 見なすのに、`description` にそう書いただけの店はそもそも取ってこない。
 *
 * **誤記はここに並べない。** 判定は「家系」の誤記も名乗りと見なすが、誤記の
 * 種類には限りが無い。誤記は「家」の字を残すので、**ラーメン店の店名にあれば
 * 最初の条件（ラーメン店で店名に家）で入る**（実測: 「横浜家糸ラーメン」は
 * そこから入り、判定が誤記を名乗りと読んで確定になった。屋号が〜家の確率は
 * 0.25 しか無く、誤記を読まなければ候補にも残らない）。取りこぼすのは
 * 説明の欄にだけ誤記がある店で、いまのデータに実例は無い。
 * だから判定の側から誤記の受け入れを外すこともしない——入ってきた店を落とす。
 */
export const DECLARES = "家系|横[浜濱](ラーメン|らーめん|らあめん)";

/** 1 県分のクエリ。拾うのは「ラーメン店で店名に家」「店名が名乗るか既知ブランド」「説明が名乗る」。 */
export const query = (pref) => `
[out:json][timeout:180];
area["admin_level"="4"]["name"="${pref}"]->.a;
(
  nwr["cuisine"~"ramen"]["name"~"家"](area.a);
  nwr["name"~"${DECLARES}|町田商店"](area.a);
${DECLARING_TAGS.map((t) => `  nwr["${t}"~"${DECLARES}"](area.a);`).join("\n")}
);
out center tags;
`;

/**
 * 予備を含めたエンドポイント。1 本目が混んでいるときに 2 本目へ回す。
 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** 諦めるまでに投げる回数。 */
const ATTEMPTS = 5;

/**
 * 1 県分を取得する。**取得の手順もここ 1 か所に置く。**
 *
 * 取り直し側（fetch-missing）は再試行も予備エンドポイントも持っていなかったので、
 * 混んでいる時間に叩くと 504 を 1 回受けただけで諦めていた。全国取得が落ちるのは
 * だいたい混んでいるときなので、**取り直しこそ粘る必要がある**。
 *
 * **落ちる形は 3 通りあり、2 つは成功に見える。**
 * ① 状態コードが 5xx ② 応答が返らない（`fetch` が例外を投げる）
 * ③ 状態コードは 200 だが本文が途中で切れている（`res.json()` が失敗する）。
 * ②③ を拾わないと、その県だけ予備エンドポイントにも残りの試行にも回らない。
 *
 * @param pref   都道府県名
 * @param offset 最初に使うエンドポイントの番号。**試行回数とは別に数える**——
 *               全国取得は並列の枠番号をここへ渡してくるので、同じ数で数えると
 *               枠によって粘る回数が変わり（枠 2 は 3 回で諦めていた）、同じ
 *               通信の不調でも落ちる県と落ちない県が出る。
 */
export async function fetchPref(pref, offset = 0) {
  let retriedEmpty = false;
  let reason = "原因不明";

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 5000 * attempt));

    let elements;
    try {
      const res = await fetch(ENDPOINTS[(offset + attempt) % ENDPOINTS.length], {
        method: "POST",
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "User-Agent": "iekei-ramen-mcp-apps/0.1 (data build script)",
        },
        body: query(pref),
      });
      if (!res.ok) {
        reason = `${res.status} ${res.statusText}`;
        continue;
      }
      elements = (await res.json()).elements ?? [];
    } catch (error) {
      // 応答が返らない、または本文が壊れている。どちらも状態コードには出ない。
      reason = error.message;
      continue;
    }

    /*
     * **0 件は 1 度だけ疑う。**
     *
     * Overpass は area の解決に失敗しても、エラーではなく HTTP 200 と空の結果を
     * 返すことがある。504 より悪い——成功として数えられ、その県が丸ごと静かに
     * 消える（実測: 茨城県が 0 件で返り、同じクエリを投げ直したら 20 件返った。
     * 公開中のデータでは 12 店ある県）。
     *
     * **本当に 0 件の県もある**ので（富山県・高知県）、0 件を失敗とは扱わない。
     * 別のエンドポイントで一度だけ確かめ、それでも 0 なら 0 として受け入れる。
     */
    if (elements.length === 0 && !retriedEmpty) {
      retriedEmpty = true;
      continue;
    }
    return elements;
  }

  throw new Error(`${pref}: ${reason}`);
}

/** Overpass の要素を、保存する形に直す。座標を持たないものは捨てる。 */
export function toElement(el, pref) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  return { osmType: el.type, osmId: el.id, lat, lon, prefecture: pref, tags: el.tags ?? {} };
}
