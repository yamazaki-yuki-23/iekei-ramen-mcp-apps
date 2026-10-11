import { createElement } from "react";
import { ICON_SVG, type TabKey, TABS } from "../lib/tabbar";
import styles from "./TabBar.module.css";

const camel = (k: string) => k.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const props = (o: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [camel(k), v]));

/**
 * スマホ幅で画面の下に固定するタブバー（#194）。トップ・家系マッチ・家系カメラ・診断・都道府県・店のページから、
 * 目玉の機能を 1 回で開けるようにする（出すページはオーナーが決めた。/connect には出さない）。
 * パソコン幅では出さない（上のナビに同じ入口がある）。会話の中（MCP）には出さない。
 * 「探し方」（迷ったら・店名で・現在地から・地図で）は「探す」の画面の中の切り替えに残す。
 * 中身（アイコンの絵）は src/lib/tabbar.ts。都道府県・店の静的なページも同じものから描く。
 */
export function TabBar({ current }: { current: TabKey }) {
  return (
    <nav className={styles.bar} aria-label="機能" data-tabbar>
      <ul>
        {TABS.map((t) => (
          <li key={t.key}>
            <a href={t.href} aria-current={t.key === current ? "page" : undefined}>
              <svg {...props(ICON_SVG)} aria-hidden="true">
                {t.icon.map((s) =>
                  createElement(s.tag, { key: JSON.stringify(s.attrs), ...props(s.attrs) }),
                )}
              </svg>
              <span>{t.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
