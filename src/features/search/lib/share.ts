/**
 * 3 軒を URL で共有できるか（#344）。共有の URL はこのページの origin で作るので、ページそのものとして
 * 開いている Web だけ。会話の中（MCP Apps）はホストの枠の中で動き、origin がこのサイトではない。
 */
export const CAN_SHARE = typeof window !== "undefined" && window.top === window;
