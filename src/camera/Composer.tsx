import { useEffect, useMemo, useRef, useState } from "react";
import { DATA_CREDIT } from "../lib/data-caveats";
import {
  COMMENTS,
  type PostInput,
  STAMP_OF,
  threadsText,
  type Tone,
  TONES,
  xText,
} from "./camera-post";
import type { Shop } from "../lib/types";
import styles from "./camera.module.css";
import { ManualPost } from "./ManualPost";
import { ShopCaveat } from "./ShopCaveat";
import { Chips } from "./Chips";
import { exportPhoto } from "./photo";
import { FIRST_LOOK, type Look } from "./look";
import { PhotoEditor } from "./PhotoEditor";

type Platform = "x" | "threads";

/**
 * 仕上げを選び、投稿文を見て、X・Threads へ。写真は端末の中で加工して書き出す（位置情報は付かない）。
 * スマホでは写真と文を共有の画面に渡す。渡せない・開けなかったときは、保存・コピー・投稿画面を開く手順を出す。
 */
export function Composer({
  photo,
  shop,
  taken,
  onChangeShop,
  onRetake,
}: {
  photo: ImageBitmap;
  shop: Shop;
  /** 写真の日付（フレームに入る）。 */
  taken: Date;
  onChangeShop(): void;
  onRetake(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // 見出しへ焦点を移すのは、この段に入ったときだけ（選ぶたびに戻さない）。
  useEffect(() => heading.current?.focus(), []);
  const [look, setLook] = useState<Look>(FIRST_LOOK);
  const [comment, setComment] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>("plain");

  const meta = useMemo(
    () => ({ name: shop.name, area: shop.city ?? shop.prefecture, date: taken }),
    [shop, taken],
  );

  const input: PostInput = {
    shop,
    tone,
    comment: comment ?? undefined,
  };
  const texts = { x: xText(input), threads: threadsText(input) };

  // 共有の画面を使えなかったときの手順（PC・開けなかった・閉じた）。
  // 出したときの仕上げと文を覚えておき、どれかを変えたら隠す（古い写真や文を保存・投稿させない）。
  const [manual, setManual] = useState<{
    platform: Platform;
    file: File;
    text: string;
    made: string;
  } | null>(null);
  const settings = JSON.stringify([look, comment, texts.x, texts.threads]);

  // 片方に投稿しても画面と写真は残し、続けてもう片方にも投稿できる。
  const [posted, setPosted] = useState<Platform[]>([]);

  // 投稿の準備が重なったら、最後に押したものだけを使う（古い準備で手順を上書きしない）。
  // 準備の途中で仕上げや文を変えた・この段を離れたときも取りやめる（古い写真と文で共有させない）。
  const posting = useRef(0);
  const shown = useRef(settings);
  useEffect(() => {
    shown.current = settings;
  });
  useEffect(
    () => () => {
      posting.current++;
    },
    [],
  );
  const post = async (platform: Platform) => {
    if (!canvas.current) return;
    const mine = ++posting.current;
    const text = texts[platform];
    const made = settings;
    const file = new File([await exportPhoto(canvas.current)], "iekei-ramen.jpg", {
      type: "image/jpeg",
    });
    if (mine !== posting.current || shown.current !== made) return;
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        setManual(null);
        setPosted((now) => (now.includes(platform) ? now : [...now, platform]));
        return;
      } catch {
        // 閉じたのか、共有先が無かったのかは見分けられない（どちらも AbortError）。下の手順を出す。
      }
    }
    if (mine !== posting.current || shown.current !== made) return;
    setManual({ platform, file, text, made });
  };

  return (
    <section className={styles.step} aria-labelledby="compose-title">
      <h2 id="compose-title" tabIndex={-1} ref={heading}>
        {shop.name}
      </h2>
      <p className={styles.muted}>
        {shop.city ?? shop.prefecture}・
        <button type="button" className={styles.link} onClick={onChangeShop}>
          店を選び直す
        </button>
      </p>
      <PhotoEditor
        photo={photo}
        canvas={canvas}
        look={look}
        onLook={setLook}
        stampText={comment ? STAMP_OF[comment as keyof typeof STAMP_OF] : null}
        meta={meta}
      />
      <Chips
        label="ひとこと（選ばなくてもよい）"
        items={COMMENTS.map((c) => ({ key: c, label: c }))}
        value={comment}
        onChange={setComment}
        allowNone
      />
      <Chips label="文の調子" items={TONES} value={tone} onChange={(v) => setTone(v ?? "plain")} />
      <div className={styles.texts}>
        <figure>
          <figcaption>X の文</figcaption>
          <p className={styles.text}>{texts.x}</p>
        </figure>
        <figure>
          <figcaption>Threads の文</figcaption>
          <p className={styles.text}>{texts.threads}</p>
        </figure>
      </div>
      <div className={styles.row}>
        <button type="button" className={styles.btnPrimary} onClick={() => void post("x")}>
          X に投稿
        </button>
        <button type="button" className={styles.btnPrimary} onClick={() => void post("threads")}>
          Threads に投稿
        </button>
      </div>
      {posted.length > 0 && (
        <p role="status" className={styles.muted}>
          {posted.map((x) => (x === "x" ? "X" : "Threads")).join("・")} に渡しました。
          {posted.length === 1 &&
            `続けて${posted[0] === "x" ? " Threads " : " X "}にも投稿できます。`}
        </p>
      )}
      {manual?.made === settings && (
        <ManualPost
          key={`${manual.platform}-${manual.made}`}
          platform={manual.platform}
          file={manual.file}
          text={manual.text}
        />
      )}
      <p className={styles.note}>
        写真はこの端末の中で仕上げ、サーバーには送りません。書き出した写真に位置情報は残りません。
      </p>
      <button type="button" className={styles.link} onClick={onRetake}>
        撮り直す
      </button>
      <ShopCaveat />
      <p className={styles.note}>{DATA_CREDIT}</p>
    </section>
  );
}
