import { describe, expect, it } from "vitest";
// @ts-expect-error データ作成スクリプトはJavaScript。
import { applyCorrections } from "../scripts/corrections.mjs";
const evidence = { reason: "公式情報で確認", source: "公式サイト", date: "2026-10-04" };
const shop = { id: "node/1", name: "試験家", prefecture: "神奈川県", lat: 35.46, lon: 139.62 };
describe("個別補正", () => {
  it("除外・閉店を再取得後にも適用し、他の店を維持する", () => {
    const original = [shop, { ...shop, id: "way/2" }, { ...shop, id: "node/3" }];
    const corrections = [
      { action: "exclude", id: "node/1", ...evidence },
      { action: "closed", id: "way/2", ...evidence },
    ];
    expect(applyCorrections(original, corrections)).toEqual([original[2]]);
    expect(applyCorrections(original, corrections)).toEqual([original[2]]);
    expect(original).toHaveLength(3);
  });
  it("未掲載の店を安定IDと味情報なしで追加し、後のOSM取得では二重登録しない", () => {
    const correction = { action: "add", ...shop, ...evidence };
    const added = applyCorrections([], [correction]);
    expect(added[0]).toMatchObject({ name: shop.name, taste: "unknown", confidence: "confirmed" });
    expect(added[0].id).toMatch(/^manual\/[0-9a-f]{20}$/);
    expect(applyCorrections([], [correction, correction])).toEqual(added);
    expect(applyCorrections([shop], [correction])).toEqual([shop]);
    expect(applyCorrections(added, [correction])).toEqual(added);
  });
  it.each(["reason", "source", "date"])("監査用の%sが欠けたら失敗する", (field) => {
    expect(() =>
      applyCorrections([], [{ action: "add", ...shop, ...evidence, [field]: undefined }]),
    ).toThrow(field);
  });
  it.each([{ date: "2026-02-30" }, { lat: NaN }, { lon: 181 }, { name: " " }, { action: "typo" }])(
    "不正な補正を公開しない: %j",
    (invalid) => {
      expect(() =>
        applyCorrections([], [{ action: "add", ...shop, ...evidence, ...invalid }]),
      ).toThrow();
    },
  );
});
