import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { IekeiApp } from "./iekei-app";
import { WebConnection } from "./hosts/web";
import { IekeiIntro } from "./components/IekeiIntro";
import { initialIntroOpen } from "./lib/intro-state";

function WebApp() {
  const [introOpen, setIntroOpen] = useState(initialIntroOpen);
  return (
    <IekeiApp
      Connection={WebConnection}
      primaryMode="decide"
      introduction={<IekeiIntro open={introOpen} onToggle={setIntroOpen} />}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WebApp />
  </StrictMode>,
);
