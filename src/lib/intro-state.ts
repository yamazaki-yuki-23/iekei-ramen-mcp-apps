const SEEN_KEY = "iekei:intro-seen";

/** 保存が使えないときも、説明と匿名検索は使える。 */
export function initialIntroOpen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return true;
  }
}

/** 実際に説明が表示されたときだけ呼び、接続失敗では既読にしない。 */
export function markIntroSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // 保存が無効でも、次に開くと説明が出るだけ。
  }
}
