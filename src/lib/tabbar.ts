/*
 * 下のタブバー（#194）の中身。React の画面（src/components/TabBar.tsx）と、都道府県・店の静的なページ
 * （scripts/seo-pages.mjs）の両方がここから描く（アイコンの絵を 2 か所に持たない）。
 */

export type TabKey = "search" | "match" | "camera" | "shindan";

export interface IconShape {
  tag: "circle" | "path" | "rect";
  attrs: Record<string, string | number>;
}

export const TABS: { key: TabKey; href: string; label: string; icon: IconShape[] }[] = [
  {
    key: "search",
    href: "/",
    label: "探す",
    icon: [
      { tag: "circle", attrs: { cx: 11, cy: 11, r: 6.5 } },
      { tag: "path", attrs: { d: "M16 16l5 5" } },
    ],
  },
  {
    key: "match",
    href: "/match/",
    label: "家系マッチ",
    icon: [
      {
        tag: "rect",
        attrs: { x: 3.5, y: 6, width: 11, height: 15, rx: 2, transform: "rotate(-8 9 13.5)" },
      },
      {
        tag: "rect",
        attrs: { x: 9.5, y: 3.5, width: 11, height: 15, rx: 2, transform: "rotate(8 15 11)" },
      },
    ],
  },
  {
    key: "camera",
    href: "/camera/",
    label: "家系カメラ",
    icon: [
      {
        tag: "path",
        attrs: {
          d: "M3 8.5a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
        },
      },
      { tag: "circle", attrs: { cx: 12, cy: 13, r: 3.5 } },
    ],
  },
  {
    key: "shindan",
    href: "/shindan/",
    label: "診断",
    icon: [
      { tag: "rect", attrs: { x: 5, y: 3.5, width: 14, height: 17.5, rx: 2 } },
      {
        tag: "path",
        attrs: { d: "M8.5 9.5l1.5 1.5 3-3M8.5 15.5l1.5 1.5 3-3M15 10h1.5M15 16h1.5" },
      },
    ],
  },
];

/** アイコンを囲む svg の決まった属性（線で描く）。 */
export const ICON_SVG = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.8,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
} as const;

const attrs = (o: Record<string, string | number>) =>
  Object.entries(o)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");

/** 静的なページ用の HTML（React を使わないページ）。 */
export function tabBarHtml(current: TabKey): string {
  const items = TABS.map((t) => {
    const icon = t.icon.map((s) => `<${s.tag} ${attrs(s.attrs)}/>`).join("");
    const here = t.key === current ? ' aria-current="page"' : "";
    return `<li><a href="${t.href}"${here}><svg ${attrs(ICON_SVG)} aria-hidden="true">${icon}</svg><span>${t.label}</span></a></li>`;
  }).join("");
  return `<nav class="tabbar" aria-label="機能" data-tabbar><ul>${items}</ul></nav>`;
}
