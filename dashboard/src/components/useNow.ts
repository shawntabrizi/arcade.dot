// A wall-clock ticker (SPEC §7.4 / §9.3): re-renders consumers on a local
// interval so relative timestamps ("active 2m ago") advance WITHOUT re-reading
// the chain. This is deliberately decoupled from the best-block refresh — the
// activity rail must keep its rows ticking even if block-polling stalls (§9.3:
// "degrade to last-fetched state with relative timestamps ticking; never
// spinner-lock"). Returns Date.now() in ms, refreshed every `intervalMs`.

import { useEffect, useState } from "react";

export const TICK_MS = 20_000; // 20s — between the §7.4 suggested 15–30s.

export function useNow(intervalMs: number = TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
