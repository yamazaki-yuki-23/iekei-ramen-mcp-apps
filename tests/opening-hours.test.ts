import { describe, expect, it } from "vitest";
import { formatOpeningHours, openingHoursLabel } from "../src/lib/opening-hours";

describe("営業時間を人が読める表記にする", () => {
  it.each([
    ["11:00-21:30; Mo off", "11:00〜21:30／月曜定休"],
    ["11:00-20:00,Mo off", "11:00〜20:00／月曜定休"],
    ["Tu-Su 11:00-02:00, Mo off", "火〜日 11:00〜2:00／月曜定休"],
    ["Mo-Su 11:00-22:00; We off", "11:00〜22:00／水曜定休"],
    ["Mo-Su,PH 10:00-23:00", "毎日 10:00〜23:00"],
    ["Su-Sa 11:00-22:00", "毎日 11:00〜22:00"],
    ["Mo-Su 11:30-00:00", "毎日 11:30〜24:00"],
    ["11:00-15:00, 17:00-23:00", "11:00〜15:00、17:00〜23:00"],
    [
      "Mo-Fr 11:00-15:00,17:00-23:00; Sa,Su,PH 11:00-23:00",
      "月〜金 11:00〜15:00、17:00〜23:00／土・日・祝 11:00〜23:00",
    ],
    ["Sa-Su 11:30-15:00", "土・日 11:30〜15:00"],
    ["We-Mo 11:00-01:30", "水〜月 11:00〜1:30"],
    ["Sa, Su, PH off", "土・日・祝 休み"],
    ["11:00-27:00", "11:00〜27:00"],
    ["24/7", "24時間営業"],
  ])("%s → %s", (raw, expected) => {
    expect(formatOpeningHours(raw)).toBe(expected);
  });

  it.each([
    "Mo-We,Fr-Su 11:30-20:00; We[3] closed",
    "Mo-Su, PH 11:00-22:00; Dec 31- Jan 1 off",
    "PH,Mo-We,Fr-Su 11:00-15:00,17:00-03:00; PH -1 day,We closed",
    "Mo-Th,Sa-Su",
    "",
  ])("読み取れない書式は訳さない: %s", (raw) => {
    expect(formatOpeningHours(raw)).toBeNull();
  });

  it("読み取れないときは元の文字を出し、読めなかったと添える", () => {
    expect(openingHoursLabel("Mo-Th,Sa-Su")).toBe("Mo-Th,Sa-Su（書式を読み取れませんでした）");
    expect(openingHoursLabel("11:00-21:30; Mo off")).toBe("11:00〜21:30／月曜定休");
  });
});
