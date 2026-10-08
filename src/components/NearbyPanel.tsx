import { useEffect, useRef, useState } from "react";
import { originLabel } from "../lib/geo";
import type { Origin, OriginSource } from "../lib/types";
import { ORIGIN_NOTES } from "../lib/types";
import styles from "../mcp-app.module.css";
import { requestBrowserPosition } from "../lib/browser-position";

interface Props {
  /** 現在の基準地点。未取得なら undefined。 */
  origin?: Origin;
  /** 座標が決まったときに呼ぶ。 */
  onLocate: (lat: number, lon: number, label: string | undefined, source: OriginSource) => void;
  /**
   * 座標を渡さずにサーバーへ問い合わせる。
   * ホストが持っている大まかな現在地が使われる。
   * 位置情報が得られたかどうかを返す。
   */
  onLocateByHost: () => Promise<boolean>;
  /**
   * 地名を座標に直して、そこで探すところまで。
   *
   * **解決と検索を分けない。** 分けると、解決を待つ間にタブを移られたとき、
   * あとから検索だけが走って画面を引き戻す。見つからなければ null。
   */
  onSearchPlace: (query: string) => Promise<{ lat: number; lon: number; label: string } | null>;
  /** 親が保持する案内メッセージ。再マウントしても消えない。 */
  notice: string | null;
  busy: boolean;
}

/**
 * 現在地の指定 UI。
 *
 * 位置情報の取り方はホストによって違うので、3 段階で降りていく。
 *   1. ブラウザの位置情報（数十 m）
 *   2. ホストが渡す大まかな位置（市区町村レベル）
 *   3. 地名の手入力
 * ChatGPT はアプリの iframe に geolocation を許可しないため 1 は必ず失敗する。
 * それでもボタンを押せば 2 で結果が出るようにしてある。
 */
export function NearbyPanel({
  origin,
  onLocate,
  onLocateByHost,
  onSearchPlace,
  notice,
  busy,
}: Props) {
  const [place, setPlace] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  /*
   * 位置や地名を待っている間（サーバーを呼ぶ前）。呼び出しの数には入らないので、画面に
   * data-busy で出し、キーボードの焦点を戻す見守りが「まだ待っている」と分かるようにする（#156）。
   */
  const [waiting, setWaiting] = useState(false);
  const operation = useRef(0);
  useEffect(
    () => () => {
      // タブ移動・payloadの差し替えで、この画面から始めた位置取得を捨てる。
      operation.current += 1;
    },
    [],
  );

  // 待ちを外すのは、いちばん新しい操作が済んだときだけ（押し直すと前の取得が先に終わるため）。
  const settle = (started: number) => {
    if (operation.current === started) setWaiting(false);
  };

  // use 始まりにするとフックと見分けが付かない。これはクリックで走るただの関数。
  const startFromCurrentPosition = async () => {
    const started = ++operation.current;
    setStatus("現在地を取得中…");
    setWaiting(true);
    const pos = await requestBrowserPosition().finally(() => settle(started));
    if (operation.current !== started) return;
    if (pos) {
      setStatus(null);
      onLocate(pos.coords.latitude, pos.coords.longitude, "現在地", "precise");
      return;
    }

    // ブラウザから取れないホストでは、ホスト自身が持つ位置に頼る。
    // 結果の案内は親（再マウントされない側）が出すので、ここでは状態を畳むだけ。
    setStatus("おおよその現在地で検索中…");
    await onLocateByHost();
    if (operation.current === started) setStatus(null);
  };

  const searchPlace = async () => {
    const q = place.trim();
    if (!q) return;
    const started = ++operation.current;
    setStatus(`「${q}」を検索中…`);
    setWaiting(true);
    let hit;
    try {
      hit = await onSearchPlace(q).finally(() => settle(started));
    } catch (e) {
      if (operation.current !== started) return;
      // 理由（連打止め・Nominatim の不調）はサーバーの文をそのまま出す。
      setStatus(e instanceof Error ? e.message : String(e));
      return;
    }
    if (operation.current !== started) return;
    if (!hit) {
      setStatus(`「${q}」が見つかりませんでした。`);
      return;
    }
    setStatus(null);
  };

  return (
    <div className={styles.form} data-busy={waiting}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.button}
          onClick={() => void startFromCurrentPosition()}
          disabled={busy}
        >
          現在地で発券
        </button>
        <span className={styles.meta}>
          {origin
            ? `基準: ${originLabel(origin)}${
                origin.source === "precise" ? "" : `（${ORIGIN_NOTES[origin.source]}）`
              }`
            : "ボタンを押すか、地名を入力してください"}
        </span>
      </div>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="place">
          地名で指定
        </label>
        <input
          id="place"
          // Enter で結果が差し替わったあと、この欄へ焦点を戻す（use-result-handoff.ts）。
          data-result-input="place"
          className={styles.input}
          type="search"
          placeholder="横浜駅 / 新宿区 / 東京都港区…"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void searchPlace();
            }
          }}
        />
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={() => void searchPlace()}
          disabled={busy || place.trim() === ""}
        >
          この場所で発券
        </button>
      </div>
      {/*
       * 途中経過と失敗の行。読み上げの領域にするため、文が無いときも置いておく（#156）。
       * 空のときは .liveLine:empty が並びから外すので、間隔は増えない。
       */}
      <p role="status" className={`${styles.meta} ${styles.liveLine}`}>
        {status ?? notice ?? ""}
      </p>
    </div>
  );
}
