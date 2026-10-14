import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IekeiApp } from "./iekei-app";
import { McpConnection } from "./components/McpConnection";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IekeiApp Connection={McpConnection} />
  </StrictMode>,
);
