// Selects the ArcadeReads implementation at the composition root. Default: the
// real PAPI + sdk-ink chain reads. When VITE_ARCADE_FAKE_READS === "1" (set by
// the Playwright e2e in item 15), a deterministic in-memory fake is used so the
// e2e never touches a real RPC — the same injection seam the unit tests use,
// just wired through an env flag for the browser bundle.

import type { ArcadeReads } from "./arcade-reads";

// Vite statically inlines `import.meta.env.VITE_*` as a literal, so in the
// default (non-fake) production build this comparison is `"undefined" === "1"`
// → false, and the dynamic-imported fake-reads module is dropped entirely
// (fixtures never ship to production). When the e2e sets VITE_ARCADE_FAKE_READS=1
// at build time, the fake branch is kept instead.
const USE_FAKE = import.meta.env.VITE_ARCADE_FAKE_READS === "1";

export async function resolveReads(): Promise<ArcadeReads> {
  if (USE_FAKE) {
    const { createFakeReads, SAMPLE_GAMES } = await import("./fake-reads");
    return createFakeReads(SAMPLE_GAMES);
  }
  const { createChainReads } = await import("./chain-reads");
  return createChainReads();
}
