import type { SearchMode } from "./types";

/** 結果の領域（iekei-app.tsx）。会話の中のタブが aria-controls で指す先（#156）。 */
export const MODE_PANEL_ID = "iekei-mode-panel";
export const modeTabId = (mode: SearchMode) => `iekei-mode-tab-${mode}`;
