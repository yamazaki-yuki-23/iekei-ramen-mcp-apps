import { LEGAL_LINKS } from "../lib/legal-links";

/** Web の各画面の下に置く、規約へのリンク（#198）。会話の中（MCP）には出さない。 */
export function LegalLinks() {
  return (
    <nav className="legal-links" aria-label="規約">
      {LEGAL_LINKS.map((l) => (
        <a key={l.href} href={l.href}>
          {l.label}
        </a>
      ))}
    </nav>
  );
}
