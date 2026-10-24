import "../../utils/zod-jitless";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MatchApp } from "./MatchApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MatchApp />
  </StrictMode>,
);
