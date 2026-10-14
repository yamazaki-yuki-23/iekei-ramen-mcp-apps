import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchApp } from "./SearchApp";
import { WebConnection } from "./components/WebConnection";
import { IekeiIntro } from "./components/IekeiIntro";
import { TabBar } from "../../components/TabBar";
import { LegalLinks } from "../../components/LegalLinks";
import { PromiseHero } from "./components/PromiseHero";
import { initialIntroOpen } from "./lib/intro-state";
import { webEntry } from "./utils/web-entry";

function WebApp() {
  const [introOpen, setIntroOpen] = useState(initialIntroOpen);
  return (
    <>
      <SearchApp
        Connection={WebConnection}
        primaryMode={
          webEntry(window.location.search).name === "search-iekei-ramen" ? "form" : "decide"
        }
        hero={PromiseHero}
        introduction={<IekeiIntro open={introOpen} onToggle={setIntroOpen} />}
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
