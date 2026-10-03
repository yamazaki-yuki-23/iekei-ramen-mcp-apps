/** Nominatim の送信開始から本文読込完了まで、合計 10 秒で打ち切る。 */
export const GEOCODE_RESPONSE_TIMEOUT_MS = 10_000;

export class GeocodeTimeoutError extends Error {
  constructor() {
    super("Geocode response timed out");
    this.name = "GeocodeTimeoutError";
  }
}

/** キャンセルを送り、キャンセルを無視する送り口でも呼び出し元の待ちは終える。 */
export async function withGeocodeTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = GEOCODE_RESPONSE_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new GeocodeTimeoutError();
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
