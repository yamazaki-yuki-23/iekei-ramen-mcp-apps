import { describe, expect, it } from "vitest";
import { readLimited } from "./read-limited";

const post = (bytes: number) =>
  new Request("http://localhost/mcp", { method: "POST", body: Buffer.alloc(bytes, 120) });

describe("本文を上限まで読む（#429）", () => {
  it("上限の中は文字にし、超えたら null。本文が無ければ空", async () => {
    expect(await readLimited(post(10).body, 10)).toBe("x".repeat(10));
    expect(await readLimited(post(11).body, 10)).toBeNull();
    expect(await readLimited(null, 10)).toBe("");
  });

  it("複製の側だけを読んで超えても、元の側を読まずに止まらず返る（Node の手元のサーバー）", async () => {
    // Node の複製（tee）は、片方の読み取りを止める（cancel）のを待つと、もう片方が読み終わるまで終わらない。
    const request = post(70_000);
    const result = await Promise.race([
      readLimited(request.clone().body, 64 * 1024),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 2000)),
    ]);
    expect(result).toBeNull();
  });
});
