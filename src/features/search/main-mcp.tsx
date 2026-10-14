import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SearchApp } from "./SearchApp";
import { McpConnection } from "./components/McpConnection";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SearchApp Connection={McpConnection} />
  </StrictMode>,
);
