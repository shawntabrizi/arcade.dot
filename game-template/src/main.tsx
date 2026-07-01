import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Inter is BUNDLED (not loaded from Google Fonts) so the app has ZERO external
// network dependencies — an external font request makes the host prompt "Allow
// access to web domains?" and breaks the self-contained guarantee. See CLAUDE.md.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import { App } from "./App";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
