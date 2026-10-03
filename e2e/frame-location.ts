/** フレームの位置だけを記録し、inline本文・query・認証値は含めない。 */
export function frameLocation(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return `${parsed.origin}${parsed.pathname}`;
    }
    if (url === "about:blank" || url === "about:srcdoc") return url;
    return parsed.protocol;
  } catch {
    return "unknown";
  }
}
