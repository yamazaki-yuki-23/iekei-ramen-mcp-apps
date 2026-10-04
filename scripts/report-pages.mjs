const select = "SELECT id, kind, shop_id, name, location, received_at FROM reports";
const order = "ORDER BY received_at, id LIMIT 100";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function reportListQuery(cursor) {
  if (!cursor) return `${select} ${order}`;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor) || cursor.length > 256) throw new Error();
    const pair = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error();
    const [date, id] = pair;
    if (
      typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
      new Date(date).toISOString() !== date ||
      typeof id !== "string" ||
      !uuid.test(id)
    )
      throw new Error();
    // 日付とUUIDの形式を固定してからSQLへ入れる。自由記述は入れない。
    return `${select} WHERE received_at > '${date}' OR (received_at = '${date}' AND id > '${id}') ${order}`;
  } catch {
    throw new Error("カーソルが不正です。listの結果のnextCursorを指定してください");
  }
}

export function reportPage(reports) {
  const last = reports.at(-1);
  return {
    reports,
    nextCursor:
      reports.length === 100
        ? Buffer.from(JSON.stringify([last.received_at, last.id])).toString("base64url")
        : null,
  };
}
