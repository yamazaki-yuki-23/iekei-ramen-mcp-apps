import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShindanApp } from "./ShindanApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShindanApp />
  </StrictMode>,
);
