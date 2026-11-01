import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SearchApp } from "./SearchApp";
import { McpConnection } from "./components/McpConnection";
import { OrderGuide } from "./components/OrderGuide";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 注文のしかたはどの店でも同じなので、結果の下に 1 か所だけ置く（#330。Web は「家系とは」の中）。 */}
    <SearchApp Connection={McpConnection} introduction={<OrderGuide />} />
  </StrictMode>,
);
