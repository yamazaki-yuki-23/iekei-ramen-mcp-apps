/**
 * 選択した店をホストのモデルコンテキストに載せる／外す。
 *
 * 画面の組み立てから切り出してあるのは、失敗したときの後始末に順番の約束が
 * あるからで、そこだけを取り出して試せるようにするため。
 */
import { describeShop } from "./shop-brief";
import type { Shop } from "./types";

/** 受け渡しに使う最小限の口。テストから差し替えられるようにしてある。 */
export interface ContextHost {
  updateModelContext(update: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface ContextResult {
  /** 望んだ状態にできたか。できなければ、質問に詳細を同梱するなどで補う。 */
  ok: boolean;
  /**
   * ホストが今この店を持っているか。
   * undefined は「分からないので、呼び出し側は記録を触らない」。
   */
  delivered?: boolean;
}

/**
 * 選択を渡す（null なら外す）。
 *
 * **戻り値は、後始末まで終わってから返すこと。** 失敗した時点で先に知らせると、
 * 解除を待っている側が「もう消えた」と思って次へ進み、古い店の文脈が残ったまま
 * 依頼が飛ぶ。実際に「3 軒から選ぶ」がその競合に当たる。
 */
export async function deliverSelection(
  host: ContextHost,
  shop: Shop | null,
): Promise<ContextResult> {
  try {
    await host.updateModelContext(
      shop
        ? {
            content: [{ type: "text", text: describeShop(shop) }],
            structuredContent: { selectedShop: shop },
          }
        : { content: [] },
    );
    return { ok: true, delivered: shop !== null };
  } catch {
    /*
     * 渡せなかったときは、ホストに残っている前の店を消しに行く。解除の失敗も
     * 差し替えの失敗もここを通る。残したままだと、ホストは古い店を持ち続け、
     * ユーザーが次に打った質問にその店が混ざる。差し替えの失敗なら、質問には
     * 新しい店の詳細が同梱されるので、古い店と食い違うことにもなる。
     */
    try {
      await host.updateModelContext({ content: [] });
      return { ok: false, delivered: false };
    } catch {
      // これも失敗したら記録は触らない。前に渡したものが残っている可能性が
      // あるので、次の解除でまた消しに行く。
      return { ok: false };
    }
  }
}

/** 直近の受け渡し。どの店を、どの約束で渡したか。 */
interface Delivery {
  shopId: string | null;
  done: Promise<boolean>;
  /**
   * 渡せなかったもの。「もう積んである」としては数えない。
   *
   * 記録を null に書き換えて無かったことにすると、それが「解除を積んだ」と
   * 同じ形になる。渡すのも後始末も失敗した直後は、ホストが前の店を持ったまま
   * のことがあり、そこで解除を重複と見なすと誰も消しに行かなくなる。
   */
  failed: boolean;
}

export interface DeliveryQueue {
  /** 受け渡しを積む。解決値は「モデルに届いたか」。 */
  enqueue(host: ContextHost, shop: Shop | null): Promise<boolean>;
  /**
   * ホストがもう何も持っていないか。
   *
   * 渡せなかったときは delivered だけ false になる。その状態で解除の到着を
   * 待つと、送るものが無いので誰も知らせてくれず、上限まで空回りする
   * （実測 2.4 秒。updateModelContext に対応しないホストでは毎回）。
   */
  isEmpty(): boolean;
  /** その状態の受け渡しを、もう積んであるか。同じ往復を 2 回走らせないために見る。 */
  hasQueued(shopId: string | null): boolean;
  /** その店の詳細がモデルに届いたか。待つ間に選択が変わっていたら false。 */
  hasDelivered(shopId: string): Promise<boolean>;
}

/**
 * 受け渡しの列。
 *
 * 並行に投げると完了順が入れ替わる。古い受け渡しが遅れて失敗すると、その
 * 後始末が、先に成功していた新しい受け渡しを消してしまう。1 本の列に積んで
 * 順番に流すことでこれを防ぐ。
 *
 * 画面の組み立てから切り出してあるのは、失敗したあとの記録の扱いに約束が
 * あり、そこだけを取り出して試せるようにするため。
 */
export function createDeliveryQueue(): DeliveryQueue {
  /** ホストが店を持っているか（成功が確定したものだけ数える）。 */
  let delivered = false;
  /** 送信中・列に並んでいる受け渡しの数。これを見ないと消し忘れる。 */
  let pending = 0;
  // 起動直後。何も渡していないので「空を積んである」のと同じ状態から始める。
  let last: Delivery = { shopId: null, done: Promise.resolve(false), failed: false };
  let tail: Promise<unknown> = Promise.resolve();

  return {
    enqueue(host, shop) {
      pending += 1;
      // 対応していないホストでも UI は動かし続ける。失敗は質問側で吸収する。
      // Promise の executor は同期に走るので、次の行で必ず入る。
      let settle!: (ok: boolean) => void;
      const mine: Delivery = {
        shopId: shop?.id ?? null,
        done: new Promise<boolean>((resolve) => {
          settle = resolve;
        }),
        failed: false,
      };
      last = mine;

      tail = tail.then(async () => {
        try {
          // 後始末まで終わってから知らせる。先に知らせると、解除を待っている側が
          // 古い店の文脈が残ったまま次へ進む。
          const result = await deliverSelection(host, shop);
          if (result.delivered !== undefined) delivered = result.delivered;
          /*
           * 失敗した受け渡しは「積んである」として数えない。数えると、同じ店を
           * 選び直しても送らず、画面は選択中なのにモデルには何も無いままになる。
           * あとから積まれた分があれば、それが新しい記録なので触らない。
           */
          if (!result.ok && last === mine) last = { ...mine, failed: true };
          settle(result.ok);
        } finally {
          pending -= 1;
        }
      });

      return mine.done;
    },

    isEmpty: () => !delivered && pending === 0,

    hasQueued: (shopId) => !last.failed && last.shopId === shopId,

    async hasDelivered(shopId) {
      if (last.shopId !== shopId) return false;
      const ok = await last.done;
      return ok && last.shopId === shopId;
    },
  };
}
