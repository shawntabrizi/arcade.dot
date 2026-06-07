// React context that injects the ArcadeReads boundary into the component tree.
// The composition root (main.tsx) provides the real chain-reads impl; the
// Playwright e2e (item 15) and any future Storybook can provide a fake by
// wrapping the app in <ReadsProvider reads={fakeReads}>. This is the single
// dependency-injection seam — no component imports chain-reads directly.

import { createContext, useContext, type ReactNode } from "react";
import type { ArcadeReads } from "./arcade-reads";

const ReadsContext = createContext<ArcadeReads | null>(null);

export function ReadsProvider({
  reads,
  children,
}: {
  reads: ArcadeReads;
  children: ReactNode;
}) {
  return <ReadsContext.Provider value={reads}>{children}</ReadsContext.Provider>;
}

export function useReads(): ArcadeReads {
  const reads = useContext(ReadsContext);
  if (!reads)
    throw new Error("useReads must be used within a <ReadsProvider>.");
  return reads;
}
