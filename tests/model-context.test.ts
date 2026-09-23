import { describe, expect, it } from "vitest";
import { createDeliveryQueue, deliverSelection, type ContextHost } from "../src/lib/model-context";
import type { Shop } from "../src/lib/types";

const SHOP: Shop = {
  id: "node/1",
  name: "壱八家",
  taste: "creamy",
  confidence: "confirmed",
  prefecture: "神奈川県",
  lat: 35.4657,
  lon: 139.622,
  osmUrl: "https://www.openstreetmap.org/node/1",
};

/** 別の店。記録の取り違えを見るために使う。 */
const OTHER: Shop = { ...SHOP, id: "node/2", name: "王道家" };

/** 呼ばれた順番と中身を覚えるだけのホスト。 */
function fakeHost(behavior: Array<"ok" | "fail" | "slow-ok">): ContextHost & {
  calls: Array<{ cleared: boolean }>;
  finished: string[];
} {
  const calls: Array<{ cleared: boolean }> = [];
  const finished: string[] = [];
  return {
    calls,
    finished,
    async updateModelContext(update) {
      const i = calls.length;
      calls.push({ cleared: update.content.length === 0 });
      const how = behavior[i] ?? "ok";
      if (how === "slow-ok") await new Promise((r) => setTimeout(r, 20));
      if (how === "fail") {
        finished.push(`reject:${i}`);
        throw new Error("host rejected");
      }
      finished.push(`resolve:${i}`);
      return undefined;
    },
  };
}

describe("deliverSelection", () => {
  it("店を渡せたら、ホストが持っている状態として返す", async () => {
    const host = fakeHost(["ok"]);
    const result = await deliverSelection(host, SHOP);
    expect(result).toEqual({ ok: true, delivered: true });
    expect(host.calls).toEqual([{ cleared: false }]);
  });

  it("空を渡せたら、持っていない状態として返す", async () => {
    const host = fakeHost(["ok"]);
    const result = await deliverSelection(host, null);
    expect(result).toEqual({ ok: true, delivered: false });
    expect(host.calls).toEqual([{ cleared: true }]);
  });

  it("失敗したら、残っているものを消しに行く", async () => {
    const host = fakeHost(["fail", "ok"]);
    const result = await deliverSelection(host, SHOP);
    expect(result).toEqual({ ok: false, delivered: false });
    expect(host.calls).toEqual([{ cleared: false }, { cleared: true }]);
  });

  it("後始末が終わってから返す（先に返すと古い文脈が残ったまま進む）", async () => {
    /*
     * ここが要点。失敗した時点で呼び出し側へ返してしまうと、解除を待っている
     * 「3 軒から選ぶ」が「もう消えた」と思って依頼を送り、ホストには前の店が
     * 載ったままになる。
     */
    const host = fakeHost(["fail", "slow-ok"]);
    await deliverSelection(host, null);
    expect(host.finished).toEqual(["reject:0", "resolve:1"]);
  });

  it("後始末にも失敗したら、状態は分からないものとして返す", async () => {
    const host = fakeHost(["fail", "fail"]);
    const result = await deliverSelection(host, SHOP);
    // delivered を触らないことで、次の解除でまた消しに行ける。
    expect(result).toEqual({ ok: false });
    expect(host.calls).toHaveLength(2);
  });
});

describe("createDeliveryQueue", () => {
  it("渡せたら、その店は届いたものとして扱う", async () => {
    const host = fakeHost(["ok"]);
    const queue = createDeliveryQueue();
    await queue.enqueue(host, SHOP);
    expect(await queue.hasDelivered(SHOP.id)).toBe(true);
    expect(queue.isEmpty()).toBe(false);
  });

  it("同じ状態は積み直さない（同じ往復が 2 回走る）", async () => {
    const host = fakeHost(["ok"]);
    const queue = createDeliveryQueue();
    await queue.enqueue(host, SHOP);
    expect(queue.hasQueued(SHOP.id)).toBe(true);
    expect(queue.hasQueued(null)).toBe(false);
  });

  it("渡せなかった店は記録に残さない（選び直したら送り直す）", async () => {
    /*
     * 受け渡しに失敗しても後始末は成功する、という形。記録にその店が残ると、
     * 同じカードを選び直しても「もう積んである」と見なして送らず、画面は
     * 選択中なのにモデル側は空のまま——そのあとの会話が選択を指せなくなる。
     */
    const host = fakeHost(["fail", "ok"]);
    const queue = createDeliveryQueue();
    expect(await queue.enqueue(host, SHOP)).toBe(false);

    expect(queue.hasQueued(SHOP.id)).toBe(false);
    expect(await queue.hasDelivered(SHOP.id)).toBe(false);
    // 後始末が済んでいるので、解除のために待つ必要も無い。
    expect(queue.isEmpty()).toBe(true);
  });

  it("渡せなかった店の記録を、解除を積んだものと取り違えない", async () => {
    /*
     * A を渡したあと、B の受け渡しも後始末も失敗した形。ホストは A を
     * 持ったままかもしれない。ここで記録を「解除を積んだ」と同じ形に
     * してしまうと、ユーザーが選択を外しても重複と見なして消しに行かず、
     * A が黙って残り続ける。
     */
    const host = fakeHost(["ok", "fail", "fail"]);
    const queue = createDeliveryQueue();
    await queue.enqueue(host, SHOP);
    expect(await queue.enqueue(host, OTHER)).toBe(false);

    expect(queue.isEmpty()).toBe(false);
    expect(queue.hasQueued(null)).toBe(false);
  });

  it("あとから積まれた分は、古い失敗で消さない", async () => {
    /*
     * 1 本目（失敗）が片付く時点で、2 本目はもう積まれている。失敗した分を
     * 記録から外すとき、いま並んでいるのが自分のものか確かめずに消すと、
     * 新しい店の記録まで消える。以後その店は「積んでいない」扱いになり、
     * 届いているのに質問へ詳細を二重に同梱する。
     */
    const host = fakeHost(["fail", "ok", "ok"]);
    const queue = createDeliveryQueue();
    const first = queue.enqueue(host, SHOP);
    const second = queue.enqueue(host, OTHER);
    await Promise.all([first, second]);

    expect(queue.hasQueued(OTHER.id)).toBe(true);
    expect(await queue.hasDelivered(OTHER.id)).toBe(true);
  });

  it("送るものも待つものも無ければ、解除の到着を待たない", async () => {
    const queue = createDeliveryQueue();
    // 起動直後。渡したものが無いので、消しに行く往復も要らない。
    expect(queue.isEmpty()).toBe(true);

    const host = fakeHost(["ok", "ok"]);
    await queue.enqueue(host, SHOP);
    expect(queue.isEmpty()).toBe(false);
    await queue.enqueue(host, null);
    expect(queue.isEmpty()).toBe(true);
  });

  it("列に並んでいる間は、空とは見なさない", () => {
    const host = fakeHost(["slow-ok"]);
    const queue = createDeliveryQueue();
    void queue.enqueue(host, SHOP);
    // 送信中に選択を外すと、これを見ていないと消し忘れる。
    expect(queue.isEmpty()).toBe(false);
  });

  it("並行に積んでも、積んだ順に流す", async () => {
    // 1 本目を遅くしても、2 本目が追い越さない。
    const host = fakeHost(["slow-ok", "ok"]);
    const queue = createDeliveryQueue();
    const first = queue.enqueue(host, SHOP);
    const second = queue.enqueue(host, null);
    await Promise.all([first, second]);
    expect(host.finished).toEqual(["resolve:0", "resolve:1"]);
  });

  it("待つ間に別の店へ移っていたら、届いたとは言わない", async () => {
    const host = fakeHost(["slow-ok", "ok"]);
    const queue = createDeliveryQueue();
    const asked = queue.hasDelivered(SHOP.id);
    void queue.enqueue(host, SHOP);
    // 先に積まれていないので、この問い合わせは false。
    expect(await asked).toBe(false);
  });
});
