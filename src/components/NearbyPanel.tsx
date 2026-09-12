import { useState } from "react";
import styles from "../mcp-app.module.css";

interface Props {
  /** 現在地の表示名。未取得なら undefined。 */
  originLabel?: string;
  /** 緯度経度が決まったら呼ぶ。 */
  onLocate: (lat: number, lon: number, label?: string) => void;
  /** 地名を緯度経度に解決する（サーバーの geocode-place を呼ぶ）。 */
  onGeocode: (query: string) => Promise<{ lat: number; lon: number; label: string } | null>;
  busy: boolean;
}

/**
 * 現在地の指定 UI。ブラウザの位置情報が使えない環境（iframe の権限が無い等）
 * でも地名入力で代替できるようにしてある。
 */
export function NearbyPanel({ originLabel, onLocate, onGeocode, busy }: Props) {
  const [place, setPlace] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const useCurrentPosition = () => {
    if (!navigator.geolocation) {
      setStatus("この環境では位置情報を取得できません。地名を入力してください。");
      return;
    }
    setStatus("現在地を取得中…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus(null);
        onLocate(pos.coords.latitude, pos.coords.longitude, "現在地");
      },
      (err) => {
        setStatus(`現在地を取得できませんでした（${err.message}）。地名を入力してください。`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const searchPlace = async () => {
    const q = place.trim();
    if (!q) return;
    setStatus(`「${q}」を検索中…`);
    const hit = await onGeocode(q);
    if (!hit) {
      setStatus(`「${q}」が見つかりませんでした。`);
      return;
    }
    setStatus(null);
    onLocate(hit.lat, hit.lon, hit.label);
  };

  return (
    <div className={styles.form}>
      <div className={styles.row}>
        <button type="button" className={styles.button} onClick={useCurrentPosition} disabled={busy}>
          現在地から探す
        </button>
        <span className={styles.meta}>
          {originLabel ? `基準: ${originLabel}` : "位置情報を許可するか、地名を入力してください"}
        </span>
      </div>

      <div className={styles.row}>
        <label className={styles.label} htmlFor="place">地名で指定</label>
        <input
          id="place"
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
          この場所で探す
        </button>
      </div>

      {status && <p className={styles.meta}>{status}</p>}
    </div>
  );
}
