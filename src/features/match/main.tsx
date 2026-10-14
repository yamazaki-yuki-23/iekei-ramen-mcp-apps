import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SwipeApp } from "./SwipeApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SwipeApp />
  </StrictMode>,
);
