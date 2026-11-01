import "../../utils/zod-jitless";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchApp } from "./SearchApp";
import { WebConnection } from "./components/WebConnection";
import { IekeiIntro } from "./components/IekeiIntro";
import { ORDER_GUIDE_ID } from "./components/OrderGuide";
import { TabBar } from "../../components/TabBar";
import { LegalLinks } from "../../components/LegalLinks";
import { PromiseHero } from "./components/PromiseHero";
import { initialIntroOpen } from "./lib/intro-state";
import { webEntry } from "./utils/web-entry";

/** 店のページの「注文のしかたを見る」から来た（#330）。「家系とは」と注文のしかたを開いて移る。 */
const toOrder = window.location.hash === `#${ORDER_GUIDE_ID}`;

function WebApp() {
  const [introOpen, setIntroOpen] = useState(() => toOrder || initialIntroOpen());
  const entry = webEntry(window.location.search);
  return (
    <>
      <SearchApp
        Connection={WebConnection}
        primaryMode={entry.name === "search-iekei-ramen" ? "form" : "decide"}
        entryNear={"near" in entry.arguments && entry.arguments.near === "auto"}
        hero={PromiseHero}
        introduction={<IekeiIntro open={introOpen} onToggle={setIntroOpen} orderOpen={toOrder} />}
      />
      <LegalLinks />
      <TabBar current="search" />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebApp />
  </StrictMode>,
);
