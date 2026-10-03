import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IekeiApp } from "./iekei-app";
import { WebConnection } from "./hosts/web";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IekeiApp Connection={WebConnection} />
  </StrictMode>,
);
