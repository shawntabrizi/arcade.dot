// App shell: header with live best-block indicator, hash-routed home / detail
// pages. Subscribes to new best blocks via the reads seam and bumps `blockKey`,
// which pages key their refresh on (SPEC §7.4 — refresh only what's visible).

import { useEffect, useState } from "react";
import { useReads } from "./reads-context";
import { aboutHref, useRoute } from "./router";
import { Home } from "./pages/Home";
import { GameDetail } from "./pages/GameDetail";
import { About } from "./pages/About";

export function App() {
  const reads = useReads();
  const route = useRoute();
  const [block, setBlock] = useState<number | null>(null);
  // Incremented on each new best block; pages depend on it to re-read visible
  // surfaces. Decoupled from the raw block number so renders are stable.
  const [blockKey, setBlockKey] = useState(0);

  useEffect(() => {
    const off = reads.onNewBlock((n) => {
      setBlock(n);
      setBlockKey((k) => k + 1);
    });
    return off;
  }, [reads]);

  return (
    <>
      {/* Full-bleed sticky bar; .app__headerin re-aligns content to the page
          container. Kept outside .app so the bar spans the whole viewport. */}
      <header className="app__header">
        <div className="app__headerin">
          <a className="app__brand" href="#/">
            <img className="app__logo" src="/logo-symbol_light.svg" alt="Polkadot" />
            <span className="app__brandname">Arcade</span>
          </a>
          <nav className="app__nav">
            <a
              className={`app__navlink${route.name !== "about" ? " app__navlink--active" : ""}`}
              href="#/"
            >
              Store
            </a>
            <a
              className={`app__navlink${route.name === "about" ? " app__navlink--active" : ""}`}
              href={aboutHref()}
            >
              About
            </a>
            <span className="app__block">
              {block === null ? (
                <span className="muted">connecting…</span>
              ) : (
                <>
                  <span className="app__pulse" /> best block{" "}
                  <code>#{block.toLocaleString()}</code>
                </>
              )}
            </span>
          </nav>
        </div>
      </header>

      <div className="app">
        <main className="app__main">
          {route.name === "home" ? (
            <Home blockKey={blockKey} />
          ) : route.name === "about" ? (
            <About />
          ) : (
            <GameDetail
              key={route.address}
              address={route.address}
              blockKey={blockKey}
            />
          )}
        </main>

        <footer className="app__footer muted">
          A read-only, permissionless game directory. Stats are read live from each
          game’s contract on Paseo Asset Hub — no backend, no account.
        </footer>
      </div>
    </>
  );
}
