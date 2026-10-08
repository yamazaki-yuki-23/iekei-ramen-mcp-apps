import { Component, type ReactNode } from "react";
import { StateNote } from "./StateNote";

/**
 * 地図のファイルを読めなかったときの受け止め（#154）。地図を後から読むようにしたので、
 * 通信が途切れると地図だけ読めないことがある。受け止めないと、アプリ全体が消えて
 * 何も操作できなくなる。地図の場所で知らせ、ほかの探し方はそのまま使えるようにする。
 * 読み直しはページごと（lazy-map.ts の説明）。接続できなかった画面と同じ案内にする。
 */
export class MapLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <StateNote
        kind="error"
        action={{ label: "再読み込み", onClick: () => window.location.reload() }}
      >
        地図を読み込めませんでした。ページを再読み込みしてください。
      </StateNote>
    );
  }
}
