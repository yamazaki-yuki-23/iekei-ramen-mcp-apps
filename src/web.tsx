import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";

// 検索画面はホスト境界を共有する#35で接続する。
function WebApp() {
  return (
    <main className={styles.main}>
      <h1>家系ラーメンを探す</h1>
      <p>ブラウザから使える検索画面を準備しています。</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebApp />
  </StrictMode>,
);
