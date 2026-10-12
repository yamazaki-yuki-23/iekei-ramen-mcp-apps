/*
 * 規約の正本（docs/legal/*.md）を、/privacy・/terms の HTML にする（#198）。
 * 依存を足さないため、規約で使う書式だけを読む: 見出し（##・###）・段落・表・箇条書き
 * （- と 1.、字下げで入れ子）・**太字**・`コード`・[リンク](URL)。HTML のコメントは捨てる。
 * それ以外の書式を規約に書いたら、ここに足すこと（読めない行は段落としてそのまま出る）。
 */

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

/** 規約の中のファイルへのリンクは、公開する URL に置き換える。 */
const LINKS = { "privacy-policy.md": "/privacy", "terms.md": "/terms" };

function inline(text) {
  return escape(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const url = LINKS[href] ?? href;
      return `<a href="${url}">${label}</a>`;
    });
}

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

function table(lines) {
  const [head, , ...rows] = lines;
  const th = cells(head)
    .map((cell) => `<th scope="col">${inline(cell)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${cells(row)
          .map((cell) => `<td>${inline(cell)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  // 狭い画面では表だけ横に送る（ページ全体を横に動かさない）。キーボードでも送れるよう焦点を受ける。
  return `<div class="seo-table" tabindex="0" role="region" aria-label="表"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const LIST_ITEM = /^(\s*)(-|\d+\.) (.*)$/;

/** 字下げで入れ子にする。同じ深さの項目が続く間を 1 つの ul / ol にまとめる。 */
function list(lines, start = 0, indent = lines[start].match(LIST_ITEM)[1].length) {
  const ordered = /\d/.test(lines[start].match(LIST_ITEM)[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = lines[i].match(LIST_ITEM);
    if (!m) {
      // 項目の続きの行（字下げした文）は、直前の項目に足す。
      items[items.length - 1] += inline(lines[i].trim());
      i += 1;
      continue;
    }
    if (m[1].length < indent) break;
    if (m[1].length > indent) {
      const [html, next] = list(lines, i, m[1].length);
      items[items.length - 1] += html;
      i = next;
      continue;
    }
    items.push(inline(m[3]));
    i += 1;
  }
  const tag = ordered ? "ol" : "ul";
  return [`<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`, i];
}

/** 規約の Markdown を HTML にする。最初の `# 見出し` は返す title に分ける（ページの h1 にする）。 */
export function legalMarkdown(markdown) {
  const source = markdown.replace(/<!--[\s\S]*?-->/g, "").trim();
  const blocks = source.split(/\n\s*\n/);
  let title = "";
  const html = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim());
    if (lines.length === 0) continue;
    const first = lines[0];
    if (first.startsWith("# ")) {
      title = first.slice(2).trim();
      continue;
    }
    const heading = first.match(/^(#{2,3}) (.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      if (lines.length > 1) html.push(`<p>${lines.slice(1).map(inline).join("")}</p>`);
      continue;
    }
    if (first.trim().startsWith("|")) html.push(table(lines));
    else if (LIST_ITEM.test(first)) html.push(list(lines)[0]);
    // 和文は行の途中で折り返して書いてあるので、空白を挟まずにつなぐ。
    else html.push(`<p>${lines.map((line) => inline(line.trim())).join("")}</p>`);
  }
  return { title, html: html.join("") };
}
