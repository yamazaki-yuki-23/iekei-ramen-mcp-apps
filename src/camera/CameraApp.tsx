import { TabBar } from "../components/TabBar";
import { useRef, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import type { Shop } from "../lib/types";
import { createFeed } from "../swipe/client";
import styles from "./camera.module.css";
import { Composer } from "./Composer";
import { loadPhoto } from "./photo";
import { ShopPicker } from "./ShopPicker";

const focusHeading = (el: HTMLHeadingElement | null) => el?.focus();

/**
 * 家系カメラ（#190）。撮る → 店を選ぶ → 仕上げと投稿文 → X・Threads へ。
 * 写真はサーバーに送らず、保存もしない（加工も投稿文作りも端末の中）。
 */
export function CameraApp() {
  // 店を探す接続はページで 1 つ（店を選び直しても作り足さない）。
  const [feed] = useState(createFeed);
  const [photo, setPhoto] = useState<ImageBitmap | null>(null);
  // 写真の日付（ファイルの日時。撮ったばかりなら今、前に撮った写真ならそのとき）。フレームに入る。
  const [taken, setTaken] = useState(() => new Date());
  const [shop, setShop] = useState<Shop | null>(null);
  const [error, setError] = useState("");
  // 選び直しが重なったら、最後に選んだ写真だけを使う（遅れて読み終えた古い写真で上書きしない）。
  const latest = useRef(0);
  // 撮り直しで戻ってきたときだけ、撮る段の見出しへ焦点を移す（開いた直後は動かさない）。
  const [retaken, setRetaken] = useState(false);
  const retake = () => {
    photo?.close();
    setPhoto(null);
    setRetaken(true);
  };
  const take = async (file: File | undefined) => {
    if (!file) return;
    const asked = ++latest.current;
    try {
      const bitmap = await loadPhoto(file);
      if (asked !== latest.current) {
        bitmap.close();
        return;
      }
      // 前の写真の画素は大きいので、すぐ手放す（スマホでタブが落ちないように）。
      photo?.close();
      setPhoto(bitmap);
      setTaken(new Date(file.lastModified || Date.now()));
      setShop(null);
      setError("");
    } catch {
      if (asked === latest.current)
        setError("写真を読み込めませんでした。別の写真で試してください。");
    }
  };
  return (
    <div className={styles.page}>
      <main className={styles.app}>
        <a className={styles.brand} href="/">
          <BrandMark size={36} />
          家系ラーメンを探す
        </a>
        <h1 className={styles.title}>家系カメラ</h1>
        {!photo ? (
          <section className={styles.shoot} aria-labelledby="shoot-title">
            <h2 id="shoot-title" tabIndex={-1} ref={retaken ? focusHeading : undefined}>
              撮った一杯から、投稿の文を作る
            </h2>
            <p>
              写真はこの端末の中だけで仕上げます。サーバーには送らず、保存もしません。写真の位置情報は消えます。
            </p>
            {/* 端末のカメラをそのまま使う（独自のカメラ画面は画質が落ちる）。 */}
            <label className={styles.primary}>
              撮る
              <input
                className={styles.file}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => void take(e.target.files?.[0])}
              />
            </label>
            <label className={styles.btn}>
              撮った写真から選ぶ
              <input
                className={styles.file}
                type="file"
                accept="image/*"
                onChange={(e) => void take(e.target.files?.[0])}
              />
            </label>
            {error && <p role="alert">{error}</p>}
          </section>
        ) : !shop ? (
          <ShopPicker feed={feed} onPick={setShop} onRetake={retake} />
        ) : (
          <Composer
            photo={photo}
            shop={shop}
            taken={taken}
            onChangeShop={() => setShop(null)}
            onRetake={retake}
          />
        )}
      </main>
      <TabBar current="camera" />
    </div>
  );
}
