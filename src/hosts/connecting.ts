import type { UiHost } from "./types";

/**
 * Web で、つながって最初の結果がそろうまでの仮のホスト（#214）。この間も画面の本体を描き、
 * 見出し・探し方・券売機・「見つからないときは」などの動かない部分を最初から最終の位置に出す。
 * 本体は押せない（inert）ので、ここが呼ばれることは無い。呼ばれたら、つながっていないと返す。
 */
const notReady = () => Promise.reject(new Error("まだつながっていません。"));

export const CONNECTING_HOST: UiHost = {
  callServerTool: notReady,
  openLink: notReady,
  sendMessage: notReady,
  updateModelContext: async () => ({}),
  requestDisplayMode: async () => ({ mode: "inline" }),
  getHostContext: () => ({ availableDisplayModes: ["inline"] }),
  // Web と同じ（hero を渡すのは Web だけ）。
  capabilities: { model: false, visitSignIn: false, reports: true },
};
