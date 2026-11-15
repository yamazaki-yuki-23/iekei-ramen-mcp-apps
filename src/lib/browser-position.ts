/** ブラウザの位置情報を一度だけ試す。取れなければ null。 */
export function requestBrowserPosition(timeout = 10_000): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      // 権限ポリシーによる遮断・ユーザー拒否・タイムアウトをまとめて「取れなかった」扱いにする
      () => resolve(null),
      { enableHighAccuracy: true, timeout },
    );
  });
}

/**
 * 位置の許可がもう「許可」のときだけ、端末の位置を取る（#398）。まだ・拒否なら null。
 *
 * **許可の問い合わせは出さない。** 許可の状態を Permissions API で先に見て、「許可」以外では
 * getCurrentPosition を呼ばない。押してもいないのに許可を求める画面を出さないため。
 * iframe では「許可」と答えても権限ポリシーで取れないことがあり、そのときも null。
 */
export async function positionIfGranted(timeout?: number): Promise<GeolocationPosition | null> {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state !== "granted") return null;
  } catch {
    // Permissions API が無い・geolocation を問い合わせられないブラウザ。
    return null;
  }
  return requestBrowserPosition(timeout);
}
