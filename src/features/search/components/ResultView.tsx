import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { focusLabel, mapListShops } from "../utils/map-list";
import type { Bounds, Origin, SearchMode, Shop } from "../../../types";
import styles from "../styles/search.module.css";
import { MapToolbar, type FullscreenControl } from "./MapToolbar";
import { MapView } from "../lib/lazy-map";
import { MapLoadBoundary } from "./MapLoadBoundary";
import { ShopList } from "./ShopList";
import { Pending } from "../../../components/Pending";
import type { ResultLook } from "../../../utils/skeleton";

/*
 * 円の意味は画面に書く。**直線距離だと明示する**（徒歩◯分に換算する材料は
 * 持っていないので、黙っていると「歩いて 6 分」と読まれる）。
 */
const RING_NOTE = "点線の円は基準地点からの直線距離 500m と 1km です。";
/* 印の意味は画面に書く。色や形だけでは伝わらない。 */
const VISITED_NOTE = "右上に印のあるピンは、行ったことのある店です。";

const EMPTY_MESSAGE: Record<SearchMode, string> = {
  form: "条件に合う店舗が見つかりませんでした。",
  nearby: "現在地を指定すると近い順に 5 件表示します。",
  map: "この条件では地図に表示できる店舗がありません。",
  // 「迷ったら」は専用の画面が自前で出すので、ここは使わない。
  decide: "条件に合う店舗が見つかりませんでした。",
  // 「行った店」は検索ではないので、0 件は失敗ではなくこれからの状態。
  visited: "まだ記録がありません。店を選んで「行った」を押すと、ここに並びます。",
};

interface Props {
  mode: SearchMode;
  shops: Shop[];
  selectedId?: string;
  onSelect: (shop: Shop) => void;
  /** 選択中のカードの直下に出すもの。 */
  detail?: ReactNode;
  /** 「まわる店」の順路。地図にだけ線を引く。 */
  route?: Shop[];
  routeOrigin?: { lat: number; lon: number };
  /** 地図の全画面化。ホストが対応していなければ渡ってこない。 */
  fullscreen?: FullscreenControl;
  /** 地図に出ている範囲で探し直す。 */
  onSearchArea?: (bounds: Bounds) => void;
  /** 範囲で絞った結果なら、その範囲。地図の初期表示に使い、寄せ直しもしない。 */
  bounds?: Bounds;
  /** 基準地点。地図に印と同心円を出す。 */
  origin?: Origin;
  busy?: boolean;
  /** 訪問済みの店舗 ID。カードのバッジと地図の印に使う。 */
  visitedIds?: ReadonlySet<string>;
  /** 地図と一覧の間に置くもの（Web の地図では絞り込み、#125）。 */
  belowMap?: ReactNode;
  /** 検索が空のときに添える、報告の口への案内。報告できないホストでは渡さない。 */
  reportHint?: string;
  /** 読み込み中・失敗の表示。あれば地図と一覧の代わりに出す（絞り込みは残す）。 */
  status?: ReactNode;
  /** 結果の領域の見え方（#214）。骨組みの間は地図を描かず、同じ大きさの箱で場所を取る。 */
  look?: ResultLook;
}

/** 地図の欄。同じ探し方で取り直す間は押せず（inert）、300ms を過ぎたら薄くする（#214）。 */
function mapMainProps(look: ResultLook) {
  const waiting = look === "hold" || look === "dim";
  return {
    className: look === "dim" ? `${styles.mapMain} pending-dim` : styles.mapMain,
    inert: waiting,
  };
}

/**
 * 地図の下の、印の説明。同心円は基準地点があるとき、行った印は出ている店に 1 軒でも記録が
 * あるときだけ書く（無いと読む意味が無い）。
 */
function MapNotes({ rings, visited }: { rings: boolean; visited: boolean }) {
  return (
    <>
      {rings && <p className={styles.mapNote}>{RING_NOTE}</p>}
      {visited && <p className={styles.mapNote}>{VISITED_NOTE}</p>}
    </>
  );
}

/**
 * 地図の置き場所。地図を待つ間は、道具の帯を押せない状態で出し、地図と同じ大きさの箱で場所を取る（#154）。
 * 地図の部品を読み込む間（Suspense）と、違う探し方から移ってきて結果を待つ間（骨組み・#214）の両方で同じ箱。
 */
function MapArea({
  placeholder,
  fullscreen,
  onSearchArea,
  children,
}: {
  placeholder: boolean;
  fullscreen?: FullscreenControl;
  onSearchArea?: (bounds: Bounds) => void;
  children: ReactNode;
}) {
  const box = (
    <>
      <MapToolbar fullscreen={fullscreen} busy onSearchArea={onSearchArea && (() => {})} />
      <div className={styles.mapStage}>
        <div
          className={fullscreen?.expanded ? `${styles.map} ${styles.mapExpanded}` : styles.map}
        />
      </div>
    </>
  );
  if (placeholder) return box;
  return (
    <MapLoadBoundary>
      <Suspense fallback={box}>{children}</Suspense>
    </MapLoadBoundary>
  );
}

/**
 * 検索結果の表示。地図モードだけ地図と一覧を並べる。
 */
export function ResultView({
  reportHint,
  belowMap,
  status,
  look = "live",
  mode,
  shops,
  selectedId,
  onSelect,
  detail,
  route,
  routeOrigin,
  fullscreen,
  onSearchArea,
  bounds,
  origin,
  busy = false,
  visitedIds,
}: Props) {
  /*
   * いま地図に出ている範囲の読み取り口。**値ではなく読み方を持つ。**
   * 値で持つと、寄せ終わる前に押されたときに古い範囲で探してしまう。
   */
  const getBoundsRef = useRef<(() => Bounds) | null>(null);
  /*
   * 押した塊の中身。
   *
   * **寄れば解ける、とは限らない。** 5.2m しか離れていない 2 軒は、地図の
   * 最大ズームでもまとまったままで、寄せるだけだと永久に選べない
   * （実測: ろくの家 / 稲和家ラーメンは zoom 19 でも 21.1px）。
   * 押した塊の中身を一覧に出せば、どの塊にも必ず行き先がある。
   */
  const [focused, setFocused] = useState<Shop[] | null>(null);
  /*
   * この画面では地図を描けない（#246）。地図の場所は案内に替わるので、地図の道具（範囲で発券・
   * 全画面）も外す。残すと、押しても何も起きないか、壊した地図の範囲を読みに行く。
   */
  const [mapFailed, setMapFailed] = useState(false);
  /*
   * 塊をキーボードで開いたとき、焦点の行き先。
   *
   * **開くと地図が寄り、塊ごと描き直されるので、押していた要素は消える。**
   * 焦点が body に落ちると、次の Tab が画面の先頭から始まる。出したばかりの
   * 一覧の見出しへ送れば、何が起きたかも読み上げられる。
   */
  const focusHeadRef = useRef<HTMLSpanElement>(null);
  const wantHeadFocus = useRef(false);
  useEffect(() => {
    if (!focused || !wantHeadFocus.current) return;
    focusHeadRef.current?.focus();
    wantHeadFocus.current = false;
  }, [focused]);
  if (mode === "map") {
    return (
      <div className={styles.mapLayout}>
        {/*
         * 読み込み中・失敗のあいだは、地図と一覧だけを状態の表示に差し替える。
         * **絞り込み（belowMap）は同じ位置に残す。** 置き場所を変えると、押していた
         * 選択肢ごと作り直されて焦点が消え、失敗したときは条件を変え直す口も消える。
         */}
        {/*
         * 同じ探し方で取り直す間（この範囲で発券）は、前の結果の地図も押せない（#214）。一覧だけ止めると、
         * 古いピンを選べてしまい、取り直しが失敗したときに選んだ店がモデルに残ったままになる。
         */}
        <div {...mapMainProps(look)}>
          {status ?? (
            <>
              {/*
               * **道具の帯（「この範囲で発券」）も地図と一緒に待つ。** 地図より先に出すと、
               * 地図の範囲を読めないうちに押せてしまい、押しても何も起きない（#154）。
               * 待つ間は同じ帯を押せない状態で出し、地図と同じ大きさの箱を置いて配置を動かさない。
               */}
              <MapArea
                placeholder={look === "skeleton" || look === "reserve"}
                fullscreen={fullscreen}
                onSearchArea={onSearchArea}
              >
                {!mapFailed && (
                  <MapToolbar
                    fullscreen={fullscreen}
                    busy={busy}
                    onSearchArea={
                      onSearchArea &&
                      (() => {
                        const shown = getBoundsRef.current?.();
                        if (shown) onSearchArea(shown);
                      })
                    }
                  />
                )}
                <div className={styles.mapStage}>
                  <MapView
                    shops={shops}
                    selectedId={selectedId}
                    /*
                     * **塊の外を選んだら、その塊の一覧は畳む。** 出したままだと
                     * 「この地点の 3 軒」の下に 4 枚並び、見出しの数も「この地点」という
                     * まとまりも嘘になる。外を選んだ時点で、その塊の話は終わっている。
                     */
                    onSelect={(shop) => {
                      if (focused && !focused.some((s) => s.id === shop.id)) setFocused(null);
                      onSelect(shop);
                    }}
                    route={route}
                    routeOrigin={routeOrigin}
                    expanded={fullscreen?.expanded ?? false}
                    onClusterSelect={(group, viaKeyboard) => {
                      wantHeadFocus.current = viaKeyboard;
                      setFocused(group);
                    }}
                    onReady={(getBounds) => (getBoundsRef.current = getBounds)}
                    initialBounds={bounds}
                    refit={!bounds}
                    origin={origin}
                    visitedIds={visitedIds}
                    onCannotDraw={() => {
                      getBoundsRef.current = null;
                      setMapFailed(true);
                      if (fullscreen?.expanded) fullscreen.onToggle();
                    }}
                  />
                </div>
              </MapArea>
              {/* 描けないときは、地図の上の印の説明を出さない（説明する印が無い）。 */}
              {!mapFailed && (
                <MapNotes
                  rings={Boolean(origin)}
                  visited={shops.some((s) => visitedIds?.has(s.id))}
                />
              )}
            </>
          )}
        </div>
        {belowMap}
        {status ? null : (
          <div className={styles.mapSide}>
            {focused && (
              <div className={styles.focusHead}>
                <span className={styles.focusHeadLabel} ref={focusHeadRef} tabIndex={-1}>
                  {focusLabel(focused.length)}
                </span>
                <button
                  type="button"
                  className={styles.buttonSecondary}
                  onClick={() => setFocused(null)}
                >
                  すべて表示
                </button>
              </div>
            )}
            <Pending look={look}>
              <ShopList
                shops={mapListShops(focused ?? shops, selectedId)}
                ranked
                ticket
                selectedId={selectedId}
                onSelect={onSelect}
                detail={detail}
                emptyMessage={EMPTY_MESSAGE.map}
                emptyHint={reportHint}
                visitedIds={visitedIds}
              />
            </Pending>
          </div>
        )}
      </div>
    );
  }

  return (
    <Pending look={look}>
      <ShopList
        shops={shops}
        // 店名・現在地の結果も食券で出す（#144）。現在地は半券に直線距離を書く。
        ranked={mode !== "visited"}
        ticket={mode !== "visited"}
        stub={mode === "nearby" ? "distance" : "number"}
        selectedId={selectedId}
        onSelect={onSelect}
        detail={detail}
        emptyMessage={EMPTY_MESSAGE[mode]}
        emptyHint={mode === "form" ? reportHint : undefined}
        visitedIds={visitedIds}
      />
    </Pending>
  );
}
