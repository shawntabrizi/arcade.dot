// App shell: header with live best-block indicator, hash-routed home / detail
// pages. Subscribes to new best blocks via the reads seam and bumps `blockKey`,
// which pages key their refresh on (SPEC §7.4 — refresh only what's visible).

import { useEffect, useState } from "react";
import { useReads } from "./reads-context";
import { useRoute } from "./router";
import { Home } from "./pages/Home";
import { GameDetail } from "./pages/GameDetail";

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
    <div className="app">
      <header className="app__header">
        <a className="app__brand" href="#/">
          <span className="app__logo">◆</span> Polkadot Arcade
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
      </header>

      <main className="app__main">
        {route.name === "home" ? (
          <Home blockKey={blockKey} />
        ) : (
          <GameDetail address={route.address} blockKey={blockKey} />
        )}
      </main>

      <footer className="app__footer muted">
        A read-only, permissionless game directory. Stats are read live from each
        game’s contract on Paseo Asset Hub — no backend, no account.
      </footer>
    </div>
  );
}
