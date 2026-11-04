/**
 * 市区町村の名前を、総務省の全国地方公共団体コードの名前にそろえる（#349）。
 *
 * OSM の `addr:city` は入力した人によって、町名や番地まで入っていたり（「酒田市上安町」）、
 * 「市」が無かったり（「横手」）、政令市の区だけだったり（「中区」）する。市区町村のページは
 * この名前でまとめるので、そのままだと 1 軒だけの壊れたページができる。
 * 政令市は区ではなく市でまとめ（今の一覧と同じ）、区と町名は住所の頭に回す。
 *
 * `data/municipalities.json` は、都道府県 → 名前 → 読み（カタカナ）。政令市の区は
 * 「横浜市中区」の形で入っている。
 */

/** 政令市の区（「横浜市中区」）なら、市と区に分ける。 */
const wardOf = (names, name) => {
  const match = /^(.+?市)(.+区)$/.exec(name);
  return match && names[match[1]] ? [match[1], match[2]] : undefined;
};

/**
 * 一覧の市区町村名と、住所の頭に回す残りを返す。一覧のどれにも当てられなければ undefined。
 * @returns {{ city: string, rest: string } | undefined}
 */
export function officialCity(municipalities, prefecture, city) {
  const names = municipalities[prefecture] ?? {};
  const text = city.trim().replace(new RegExp(`^${prefecture}\\s*`), "");
  // 長い名前から当てる（「熊本市中央区」を「熊本市」より先に。区を住所に回すため）。
  const prefix = Object.keys(names)
    .filter((name) => text.startsWith(name))
    .toSorted((a, b) => b.length - a.length)[0];
  if (prefix) {
    const ward = wardOf(names, prefix);
    const rest = text.slice(prefix.length).trim();
    return ward ? { city: ward[0], rest: ward[1] + rest } : { city: prefix, rest };
  }
  if (names[`${text}市`]) return { city: `${text}市`, rest: "" };
  // 区だけ（「中区」）。同じ県に同じ名前の区が 2 つあれば（「緑区」）決められない。
  const wards = Object.keys(names)
    .map((name) => wardOf(names, name))
    .filter((ward) => ward?.[1] === text);
  return wards.length === 1 ? { city: wards[0][0], rest: text } : undefined;
}

/** 店の市区町村を一覧の名前にし、残りを住所の頭に付ける。当てられなければ undefined。 */
export function withOfficialCity(municipalities, shop) {
  if (!shop.city) return shop;
  const found = officialCity(municipalities, shop.prefecture, shop.city);
  if (!found) return undefined;
  if (found.city === shop.city) return shop;
  // 番地で終わる残りと住所の間だけ空ける（「湯川町財部70-8 薗」）。
  const gap = /\d$/.test(found.rest) && shop.address ? " " : "";
  const address = `${found.rest}${gap}${shop.address ?? ""}`;
  return { ...shop, city: found.city, ...(address ? { address } : {}) };
}
