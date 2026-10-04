/**
 * OSM の opening_hours を、人が読める日本語にする。
 *
 * 地図データの書式（`11:00-21:30; Mo off`）のまま出すと「Mo off」が読めない。
 * 読み解けるのは、曜日・祝日・時刻・休みの組み合わせだけ。
 * 第 n 週（`We[3]`）や日付（`Dec 31`）などは訳さずに null を返し、
 * 呼び出し側が元の文字を出す。**推測で埋めない**（読めなかったと言う方が誠実）。
 */

const DAYS: Record<string, string> = {
  Mo: "月",
  Tu: "火",
  We: "水",
  Th: "木",
  Fr: "金",
  Sa: "土",
  Su: "日",
  PH: "祝",
};
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)";
const DAY_ITEM = new RegExp(`^(${DAY})(?:-(${DAY}))?$`);
const TIME = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

/** 「Mo-Su」「Su-Sa」のように 7 日を一巡する範囲。 */
function isEveryDay(from: string, to: string): boolean {
  const a = WEEK.indexOf(from);
  const b = WEEK.indexOf(to);
  return a >= 0 && b >= 0 && (a - b + 7) % 7 === 1;
}

function formatDays(selector: string): string | null {
  const items = selector.split(/\s*,\s*/);
  const out: string[] = [];
  for (const item of items) {
    const m = DAY_ITEM.exec(item);
    if (!m) return null;
    const [, from, to] = m;
    if (to === undefined) out.push(DAYS[from]);
    else if (from === "PH" || to === "PH") return null;
    else if (isEveryDay(from, to)) out.push("毎日");
    // 隣り合う 2 日は「土〜日」ではなく「土・日」。
    else if ((WEEK.indexOf(to) - WEEK.indexOf(from) + 7) % 7 === 1)
      out.push(`${DAYS[from]}・${DAYS[to]}`);
    else out.push(`${DAYS[from]}〜${DAYS[to]}`);
  }
  // 「毎日」に祝日は含まれる。「毎日・祝」と並べない。
  return out.includes("毎日") ? "毎日" : out.join("・");
}

function formatTimes(spec: string): string | null {
  const out: string[] = [];
  for (const range of spec.split(/\s*,\s*/)) {
    const m = TIME.exec(range);
    if (!m) return null;
    const [, h1, m1, h2, m2] = m;
    // 終わりの 00:00 は「その日の終わり」。0:00 と書くと開店前に見える。
    const end = Number(h2) === 0 && m2 === "00" ? "24:00" : `${Number(h2)}:${m2}`;
    out.push(`${Number(h1)}:${m1}〜${end}`);
  }
  return out.join("、");
}

function formatRule(rule: string): string | null {
  if (rule === "24/7") return "24時間営業";
  const off = /^(.+?)\s+(?:off|closed)$/.exec(rule);
  if (off) {
    const days = formatDays(off[1]);
    if (days === null) return null;
    // 曜日 1 つなら「月曜定休」。複数は「土・日・祝 休み」。
    return /^[月火水木金土日]$/.test(days) ? `${days}曜定休` : `${days} 休み`;
  }
  const withDays = new RegExp(
    `^(${DAY}(?:-${DAY})?(?:\\s*,\\s*${DAY}(?:-${DAY})?)*)\\s+(.+)$`,
  ).exec(rule);
  if (withDays) {
    const days = formatDays(withDays[1]);
    const times = formatTimes(withDays[2]);
    return days === null || times === null ? null : `${days} ${times}`;
  }
  return formatTimes(rule);
}

/**
 * 読めたら日本語、読めなければ null。
 *
 * 規則の区切りは `;`。`11:00-20:00,Mo off` のように `,` で次の規則を続ける
 * 書き方もあるので、時刻か off の直後で曜日が始まる `,` も区切りとみなす。
 */
export function formatOpeningHours(raw: string): string | null {
  const rules = raw
    .trim()
    .split(new RegExp(`\\s*;\\s*|(?<=\\d|off|closed)\\s*,\\s*(?=${DAY}\\b)`))
    .filter((rule) => rule !== "");
  if (rules.length === 0) return null;
  const out: string[] = [];
  for (const rule of rules) {
    const text = formatRule(rule);
    if (text === null) return null;
    out.push(text);
  }
  // 定休日があるのに「毎日 11:00〜22:00／水曜定休」と書くと食い違って見える。
  const hasOff = out.some((text) => /(定休|休み)$/.test(text));
  return out.map((text) => (hasOff ? text.replace(/^毎日 /, "") : text)).join("／");
}

/** 画面とモデルへの文に出す 1 行。読めないときは元の文字に、読めなかったと添える。 */
export function openingHoursLabel(raw: string): string {
  return formatOpeningHours(raw) ?? `${raw}（書式を読み取れませんでした）`;
}
