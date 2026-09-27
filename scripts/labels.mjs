/**
 * 一覧で同名の店を見分けられるか、材料の側から確かめる。
 *
 * **UI の出し方（src/lib/same-name.ts）が頼っている前提を、ここで守る。**
 * UI は市区町村で足りなければ町名まで降りるので、同名の店どうしで
 * (市区町村, 町名) が重なっていなければ必ず見分けが付く。重なっていたら、
 * どう出しても同じ文字列になる。
 */
export function findAmbiguous(shops) {
  const byName = new Map();
  for (const shop of shops) {
    const key = `${shop.prefecture}\u0000${shop.name}`;
    byName.set(key, [...(byName.get(key) ?? []), shop]);
  }

  const ambiguous = [];
  for (const [key, group] of byName) {
    if (group.length < 2) continue;
    const seen = new Map();
    for (const shop of group) {
      const label = `${shop.city ?? ""} ${shop.address ?? ""}`.trim();
      seen.set(label, [...(seen.get(label) ?? []), shop.id]);
    }
    for (const [label, ids] of seen) {
      if (ids.length > 1) {
        const [prefecture, name] = key.split("\u0000");
        ambiguous.push({ prefecture, name, label, ids });
      }
    }
  }
  return ambiguous;
}
