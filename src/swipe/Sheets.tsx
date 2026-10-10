import { useState } from "react";
import { formatDistance } from "../lib/geo";
import { describeLeg, googleMapsRouteUrl, MAX_STOPS, planRoute } from "../lib/route";
import { exitFor, shareText } from "../lib/swipe";
import type { Origin, Shop } from "../lib/types";
import styles from "./swipe.module.css";

/*
 * 山の上に重ねる紙。見終わったとき・「今日はここ」・行きたいリスト・読み込み中・失敗。
 * 見出しに焦点を移して、何が出たかを読み上げる。
 */

const mapUrl = (s: Shop) => `https://www.google.com/maps/search/?api=1&query=${s.lat}%2C${s.lon}`;
const SITE = "https://iekeiramen.com/match/";

/**
 * 決まった店のシェア（文字だけ）。画像つきのカードは #46 のシェアの仕組みと合流させる
 * （二重に作らない）。文は決めた事実と場所だけで、店の評価は書かない。
 */
function Share({ names }: { names: string[] }) {
  const text = shareText(names);
  const x = `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url: SITE })}`;
  const threads = `https://www.threads.net/intent/post?${new URLSearchParams({ text: `${text} ${SITE}` })}`;
  return (
    <div className={styles.row}>
      <a className={styles.btn} href={x} target="_blank" rel="noopener noreferrer">
        X でシェア
      </a>
      <a className={styles.btn} href={threads} target="_blank" rel="noopener noreferrer">
        Threads でシェア
      </a>
    </div>
  );
}

const focusHeading = (el: HTMLHeadingElement | null) => el?.focus();

function Sheet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.sheet} aria-labelledby="sheet-title">
      <h2 id="sheet-title" tabIndex={-1} ref={focusHeading}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function StatusSheet({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <Sheet title={title}>
      <p>{text}</p>
      {action && <div className={styles.row}>{action}</div>}
    </Sheet>
  );
}

/** 見終わったとき。続きの取得に失敗していたら、「全部見た」と言わずに取り直しを出す。 */
export function EndSheet({
  count,
  more,
  failed,
  onWider,
  onRetry,
  onWants,
}: {
  count: number;
  more: boolean;
  failed: boolean;
  onWider(): void;
  onRetry(): void;
  onWants(): void;
}) {
  if (failed)
    return (
      <Sheet title="続きを読み込めませんでした">
        <p>この範囲の {count} 軒は見ました。通信の状態を確かめて、もう一度読み込んでください。</p>
        <div className={styles.row}>
          <button type="button" className={styles.btnPrimary} onClick={onRetry}>
            もう一度読み込む
          </button>
          <button type="button" className={styles.btn} onClick={onWants}>
            行きたいリストを見る
          </button>
        </div>
      </Sheet>
    );
  return (
    <Sheet title={`この範囲の ${count} 軒は、全部見ました`}>
      <p>もっと遠くまで見るか、「行きたい」に入れた店から決めましょう。</p>
      <div className={styles.row}>
        <button type="button" className={styles.btnPrimary} onClick={onWider} disabled={!more}>
          範囲を広げる
        </button>
        <button type="button" className={styles.btn} onClick={onWants}>
          行きたいリストを見る
        </button>
      </div>
    </Sheet>
  );
}

/** onClear は「行きたい」リストから開いたときだけ渡す（何軒でも空にできるように、#180）。 */
export function TodaySheet({
  shop,
  onBack,
  onClear,
}: {
  shop: Shop;
  onBack(): void;
  onClear?(): void;
}) {
  return (
    <Sheet title={`今日は「${shop.name}」`}>
      <p>
        {shop.distanceKm !== undefined && `直線 ${formatDistance(shop.distanceKm)}。`}
        初めてなら、麺の硬さも味の濃さも油の量も「普通」で頼むのが定番です。
      </p>
      <div className={styles.row}>
        <a
          className={styles.btnPrimary}
          href={mapUrl(shop)}
          target="_blank"
          rel="noopener noreferrer"
        >
          地図アプリで開く
        </a>
        <button type="button" className={styles.btn} onClick={onBack}>
          続けて見る
        </button>
        {onClear && (
          <button type="button" className={styles.btn} onClick={onClear}>
            リストを空にする
          </button>
        )}
      </div>
      <Share names={[shop.name]} />
    </Sheet>
  );
}

function RouteSheet({
  shops,
  origin,
  onBack,
  onClear,
}: {
  shops: Shop[];
  origin?: Origin;
  onBack(): void;
  onClear?(): void;
}) {
  const route = planRoute(shops, origin);
  return (
    <Sheet title={`まわる店（${route.legs.length} 軒）`}>
      <p>順番は、合計の直線距離が短くなる並びです。線は直線で、道のりではありません。</p>
      <ol className={styles.list}>
        {route.legs.map((leg, i) => (
          <li key={leg.shop.id}>
            <strong>{i + 1}</strong>
            <span>
              {leg.shop.name}
              <small>{describeLeg(leg, i, origin)}</small>
            </span>
            <a
              className={styles.btn}
              href={mapUrl(leg.shop)}
              target="_blank"
              rel="noopener noreferrer"
            >
              地図
            </a>
          </li>
        ))}
      </ol>
      <div className={styles.row}>
        <a
          className={styles.btnPrimary}
          href={googleMapsRouteUrl(route, origin)}
          target="_blank"
          rel="noopener noreferrer"
        >
          順路を地図アプリで開く
        </a>
        <button type="button" className={styles.btn} onClick={onBack}>
          食券に戻る
        </button>
        {onClear && (
          <button type="button" className={styles.btn} onClick={onClear}>
            リストを空にする
          </button>
        )}
      </div>
      <Share names={route.legs.map((leg) => leg.shop.name)} />
    </Sheet>
  );
}

function PickSheet({
  shops,
  onPick,
  onBack,
  onClear,
}: {
  shops: Shop[];
  onPick(picked: Shop[]): void;
  onBack(): void;
  onClear(): void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((now) =>
      now.includes(id) ? now.filter((p) => p !== id) : [...now, id].slice(0, MAX_STOPS),
    );
  const chosen = new Set(picked);
  return (
    <Sheet title={`行きたい ${shops.length} 軒`}>
      <p>まわるなら {MAX_STOPS} 軒まで選んでください。選ばなかった店もリストに残ります。</p>
      <ul className={styles.list}>
        {shops.map((s) => {
          const on = chosen.has(s.id);
          return (
            <li key={s.id}>
              <input
                type="checkbox"
                id={`want-${s.id}`}
                checked={on}
                disabled={!on && picked.length >= MAX_STOPS}
                onChange={() => toggle(s.id)}
              />
              <span>
                <label htmlFor={`want-${s.id}`}>{s.name}</label>
                <small>
                  {s.distanceKm !== undefined && `直線 ${formatDistance(s.distanceKm)}・`}
                  {s.city ?? s.prefecture}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={picked.length === 0}
          onClick={() => onPick(shops.filter((s) => chosen.has(s.id)))}
        >
          選んだ店で順路にする
        </button>
        <button type="button" className={styles.btn} onClick={onBack}>
          食券に戻る
        </button>
        <button type="button" className={styles.btn} onClick={onClear}>
          リストを空にする
        </button>
      </div>
    </Sheet>
  );
}

/** 「行きたい」の数で出口が変わる（1 軒 → 地図アプリ / 2〜3 軒 → まわる店 / 4 軒以上 → 3 軒まで選ぶ）。 */
export function WantsSheet({
  wants,
  origin,
  onBack,
  onClear,
}: {
  wants: Shop[];
  origin?: Origin;
  onBack(): void;
  onClear(): void;
}) {
  const [route, setRoute] = useState<Shop[] | null>(null);
  const sorted = wants.toSorted((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  if (route) return <RouteSheet shops={route} origin={origin} onBack={onBack} />;
  switch (exitFor(sorted.length)) {
    case "none":
      return (
        <StatusSheet
          title="行きたいリストは空です"
          text="気になる店を右に払うと、ここにたまります。"
          action={
            <button type="button" className={styles.btn} onClick={onBack}>
              食券に戻る
            </button>
          }
        />
      );
    case "map":
      return <TodaySheet shop={sorted[0]} onBack={onBack} onClear={onClear} />;
    case "route":
      return <RouteSheet shops={sorted} origin={origin} onBack={onBack} onClear={onClear} />;
    default:
      return <PickSheet shops={sorted} onPick={setRoute} onBack={onBack} onClear={onClear} />;
  }
}

/**
 * 接続元の推定もブラウザの位置も取れなかったとき。ここで地名・駅名を入れて、その近くから探す。
 * 見つからない・地名検索の失敗は、言い分けて同じ場所に出す（入力は消さない）。
 */
export function PlaceSheet({ onSearch }: { onSearch(query: string): Promise<boolean> }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote("");
    try {
      if (!(await onSearch(q)))
        setNote(`「${q}」は見つかりませんでした。駅名や市区町村名で試してください。`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "地名の検索に失敗しました。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="現在地が分かりませんでした">
      <p>地名や駅名を入れると、その近くから探せます。</p>
      <form className={styles.row} onSubmit={submit}>
        <label className={styles.placeLabel} htmlFor="swipe-place">
          地名・駅名
        </label>
        <input
          id="swipe-place"
          className={styles.placeInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="横浜駅 / 新宿区"
          autoComplete="off"
        />
        <button type="submit" className={styles.btnPrimary} disabled={busy || query.trim() === ""}>
          {busy ? "探しています…" : "この場所で探す"}
        </button>
      </form>
      <p role="status">{note}</p>
    </Sheet>
  );
}
