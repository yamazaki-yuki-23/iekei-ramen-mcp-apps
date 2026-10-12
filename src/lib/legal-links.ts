/*
 * プライバシーポリシーと利用規約へのリンク（#198）。Web のすべてのページの下に出し、使い始める前に
 * 規約が目に入るようにする（docs/legal/README.md、民法 548 条の 2）。React の画面
 * （src/components/LegalLinks.tsx）と静的なページ（scripts/seo-pages.mjs・build-seo.mjs）の両方がここから描く。
 * 見た目は src/global.css の `.legal-links`（静的なページも seo-tokens.css として読む）。
 */

export const LEGAL_LINKS = [
  { href: "/privacy", label: "プライバシーポリシー" },
  { href: "/terms", label: "利用規約" },
] as const;

/** 静的なページ用の HTML。 */
export function legalLinksHtml(): string {
  return `<nav class="legal-links" aria-label="規約">${LEGAL_LINKS.map((l) => `<a href="${l.href}">${l.label}</a>`).join("")}</nav>`;
}
