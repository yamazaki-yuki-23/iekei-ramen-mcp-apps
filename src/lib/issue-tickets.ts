import type { FormValues } from "../components/SearchForm";
import type { Where } from "../components/TicketMachine";
import { requestBrowserPosition } from "./browser-position";
import type { Origin } from "./types";

/**
 * 券売機の発券を、いまの基準地点とこの画面の操作に結び付ける。効いているキーワードは
 * 持ち越す（外すのは「このキーワードを外す」だけ。「次の 3 軒」と同じ扱い）。
 */
export function issueWith(
  origin: Origin | undefined,
  keyword: string | undefined,
  runDecide: (
    next: FormValues,
    origin: Origin | undefined,
    round: number,
    keyword?: string,
    near?: boolean,
  ) => void,
  reserveResult: () => Reservation,
) {
  return (where: Where, values: FormValues, isCurrent: () => boolean) => {
    // 位置待ちの予約は issueTickets の最初の await より前に取られるので、ここで掴める。
    let cancel: (() => void) | undefined;
    void issueTickets(where, values, origin, isCurrent, {
      decide: (next, at) => runDecide(next, at, 0, keyword),
      near: (next) => runDecide(next, undefined, 0, keyword, true),
      reserve: () => {
        const reservation = reserveResult();
        cancel = reservation.cancel;
        return reservation;
      },
    });
    return () => cancel?.();
  };
}

/** 位置を待つ間の通し番号（use-server-tools の reserveResult）。 */
type Reservation = { current: () => boolean; release: () => void; cancel: () => void };

/**
 * 券売機の「発券する」（#144）。選んだ「どこで」で 3 軒を出す。
 *
 * 近くでは基準地点を使う。まだ無ければブラウザの位置情報を 1 度だけ試し、
 * 取れない（ChatGPT は iframe に許可しない）ときは、サーバーにホストの位置・接続元の
 * 推定で現在地を探してもらう（near）。現在地の画面へは移らない——そこの検索は味の
 * 傾向を受け取らず、選んだ条件と 3 軒の約束が消えるため（#147）。
 */
async function issueTickets(
  where: Where,
  values: FormValues,
  origin: Origin | undefined,
  isCurrent: () => boolean,
  run: {
    decide: (next: FormValues, origin?: Origin) => void;
    near: (next: FormValues) => void;
    reserve: () => Reservation;
  },
) {
  // 都道府県でも、基準地点があれば持ち越す（県の中を近い順に）。何も変えずに発券して
  // 並びが近い順から営業時間順に変わらないように。
  if (where === "pref") return run.decide(values, origin);
  const anywhere = { ...values, prefecture: "" };
  if (where === "all") return run.decide(anywhere);
  if (origin) return run.decide(anywhere, origin);
  // 位置を待つ前に番号を取る。前から走っていた呼び出しの応答は、これで捨てられる（#146）。
  const reservation = run.reserve();
  let pos: GeolocationPosition | null;
  try {
    pos = await requestBrowserPosition();
  } finally {
    reservation.release();
  }
  // 待つ間に別の発券・キー・地図・タブ、または結果側の操作（次の 3 軒・キーワードを外す）
  // が走っていたら、古い発券で新しい操作を上書きしない。
  if (!isCurrent() || !reservation.current()) return;
  if (!pos) return run.near(anywhere);
  run.decide(anywhere, {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    label: "現在地",
    source: "precise",
  });
}
