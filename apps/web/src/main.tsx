import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/styles.css";
import { translate } from "./i18n";

const root = document.getElementById("root");
if (!root) throw new Error("SpriteFlow root is missing");
function Router() {
  const [landing, setLanding] = useState(window.location.hash === "#/landing");
  useEffect(() => {
    const onHashChange = () => setLanding(window.location.hash === "#/landing");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return landing ? (
    <main className="upload-stage">
      <section className="upload-col">
        <strong>SpriteFlow</strong>
        <h1>{translate("zh", "app.tagline")}</h1>
        <a className="primary landing-link" href="#/">
          {translate("zh", "app.name")}
        </a>
      </section>
    </main>
  ) : (
    <App />
  );
}

createRoot(root).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);
