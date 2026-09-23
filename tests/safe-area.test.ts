import { describe, expect, it } from "vitest";
import { safeAreaStyle } from "../src/lib/safe-area";

describe("safeAreaStyle", () => {
  it("padding を直接書かない（インラインは CSS より強く、0 のホストで余白が消える）", () => {
    // ChatGPT は desktop でも 4 辺 0 を送ってくる。ここで padding を返すと
    // `.main { padding: var(--space-4) }` が丸ごと上書きされる。
    const style = safeAreaStyle({ top: 0, right: 0, bottom: 0, left: 0 });

    expect(Object.keys(style).some((key) => key.toLowerCase().startsWith("padding"))).toBe(false);
  });

  it("寸法は CSS 変数で渡す（CSS 側で足せるように）", () => {
    expect(safeAreaStyle({ top: 44, right: 0, bottom: 34, left: 0 })).toEqual({
      "--safe-area-top": "44px",
      "--safe-area-right": "0px",
      "--safe-area-bottom": "34px",
      "--safe-area-left": "0px",
    });
  });

  it("送ってこないホストでは何も置かず、CSS のフォールバックに任せる", () => {
    expect(safeAreaStyle(undefined)).toEqual({});
  });
});
