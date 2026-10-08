/** ブラウザの位置情報を一度だけ試す。取れなければ null。 */
export function requestBrowserPosition(): Promise<GeolocationPosition | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      // 権限ポリシーによる遮断・ユーザー拒否・タイムアウトをまとめて「取れなかった」扱いにする
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}
