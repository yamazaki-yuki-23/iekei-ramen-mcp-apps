/**
 * 週ごとの使われ方を見る（Workers Analytics Engine の SQL API）。
 *
 *   npm run usage
 *
 * `.dev.vars` に次の 2 つを置く（**このチャットや issue には貼らない**）。
 *
 *   CLOUDFLARE_ACCOUNT_ID=…
 *   CLOUDFLARE_ANALYTICS_TOKEN=…   # 権限は「Account Analytics: Read」だけ
 *
 * wrangler のログイン（OAuth）では読めない。Analytics の権限が無く 403 になる。
 *
 * 書いている欄は src/lib/usage.ts の toDataPoint と揃えてある。
 *   blob1 = tool 名 / blob2 = member・anonymous / blob3 = スタンプの向き
 */
const DATASET = "iekei_ramen_usage";
const WEEKS = 12;

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
if (!account || !token) {
  console.error(
    ".dev.vars に CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_ANALYTICS_TOKEN（Account Analytics: Read）を置いてください。",
  );
  process.exit(1);
}

/*
 * 件数は `sum(_sample_interval)` で数える。Analytics Engine は量が多いと間引いて
 * 保存し、間引いた分を `_sample_interval` に持つので、行数を数えると少なく出る。
 */
const sql = `
SELECT
  toStartOfWeek(timestamp) AS week,
  blob1 AS tool,
  blob2 AS who,
  blob3 AS stamp,
  sum(_sample_interval) AS calls
FROM ${DATASET}
WHERE timestamp > now() - INTERVAL '${WEEKS * 7}' DAY
GROUP BY week, tool, who, stamp
ORDER BY week DESC, calls DESC
FORMAT JSON`;

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
  { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: sql },
);
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  process.exit(1);
}

const { data = [] } = JSON.parse(text);
if (data.length === 0) {
  console.log(`直近 ${WEEKS} 週の記録はありません。`);
} else {
  console.table(
    data.map((r) => ({
      週: String(r.week).slice(0, 10),
      tool: r.tool,
      誰: r.who === "member" ? "サインイン済み" : "匿名",
      スタンプ: r.stamp === "visited" ? "押した" : r.stamp === "unvisited" ? "外した" : "",
      件数: Number(r.calls),
    })),
  );
}
