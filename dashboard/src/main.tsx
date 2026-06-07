import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ReadsProvider } from "./reads-context";
import { resolveReads } from "./composition";
import "./App.css";

// Composition root (SPEC §7): pick the real chain-reads impl, or a fake when the
// VITE_ARCADE_FAKE_READS seam is set (item 15 Playwright e2e injects fixtures
// the same way the game-template uses VITE_ARCADE_FAKE_GATEWAY). Business code
// only ever sees the ArcadeReads interface. resolveReads dynamically imports the
// chosen impl so the unused one is dropped from the production bundle.
const root = createRoot(document.getElementById("root")!);

resolveReads().then((reads) => {
  root.render(
    <StrictMode>
      <ReadsProvider reads={reads}>
        <App />
      </ReadsProvider>
    </StrictMode>,
  );
});
