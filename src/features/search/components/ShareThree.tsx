import { useState } from "react";
import type { Shop } from "../../../types";
import { shopSlug } from "../../../utils/shop-id";
import styles from "../styles/search.module.css";

/**
 * 3 軒を URL で共有できるか。共有の URL はこのページの origin で作るので、ページそのものとして
 * 開いている Web だけ。会話の中（MCP Apps）はホストの枠の中で動き、origin がこのサイトではない。
 */
export const CAN_SHARE = typeof window !== "undefined" && window.top === window;

/**
 * 共有の URL（#344）。持つのは店の ID だけ。**座標・現在地は入れない**（共有した人の居場所が分かる）。
 * 受け取る側の決まりは web-entry.ts。
 */
const shareUrl = (shops: Shop[], origin = window.location.origin): string =>
  `${origin}/?three=${shops.map((shop) => shopSlug(shop.id)).join(",")}`;

/**
 * 「この 3 軒をシェア」。スマホは共有シート、無ければ URL をコピーする。
 * コピーもできなければ、URL を画面に出して手で送れるようにする。
 */
export function ShareThree({ shops }: { shops: Shop[] }) {
  const [status, setStatus] = useState("");
  const share = async () => {
    const url = shareUrl(shops);
    if (navigator.share) {
      try {
        await navigator.share({ title: `家系ラーメン、この ${shops.length} 軒`, url });
        return;
      } catch (error) {
        // 共有シートを閉じただけなら何もしない。使えなかったときはコピーへ。
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus("URL をコピーしました");
    } catch {
      setStatus(`コピーできませんでした。この URL を送ってください: ${url}`);
    }
  };
  return (
    <>
      <button type="button" className={styles.buttonSecondary} onClick={() => void share()}>
        この {shops.length} 軒をシェア
      </button>
      <span className={styles.decideRound} role="status">
        {status}
      </span>
    </>
  );
}
