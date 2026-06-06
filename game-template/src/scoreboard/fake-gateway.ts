// ⚠ TEST-ONLY. This module exists solely so the Playwright e2e suite can drive
// the app without touching a chain. It is wired into the composition root
// (App.tsx) ONLY when VITE_ARCADE_FAKE_GATEWAY === "1" — never in a real build.
//
// The chain/SDK boundary the app depends on is ChainGateway (gateway.ts). The
// real implementation is sdk-gateway.ts; this is a fake that records calls and
// is configured per-test via a window hook (window.__ARCADE_FAKE__), so each
// Playwright test can set the score ordering, a pre-connected player, and the
// on-chain getBest value, then assert on the captured submitScore calls.
import type { ScoreEntry, ScoreOrdering } from "./api";
import type { ChainGateway } from "./gateway";

export interface FakeGatewayConfig {
  ordering?: ScoreOrdering;
  // Pre-connected (signed-in) player, or null/undefined for guest.
  player?: `0x${string}` | null;
  // The H160 connect() resolves to (the "host wallet" account the test approves).
  connectsTo?: `0x${string}`;
  // On-chain personal best returned by getBest(player), keyed by lowercased H160.
  bests?: Record<string, number | null>;
  // Drives the launch gate (SPEC §8.3) so the requiresAccount=true flow can be
  // tested without a rebuild. Read by App.tsx under the test flag.
  requiresAccount?: boolean;
}

export interface FakeGatewayState {
  connectCalls: number;
  mappedCalls: number;
  submits: number[];
}

// Surfaced on window so the test runner (and the running app) share one object.
export interface FakeGatewayHandle {
  config: FakeGatewayConfig;
  state: FakeGatewayState;
}

declare global {
  interface Window {
    __ARCADE_FAKE__?: FakeGatewayHandle;
  }
}

const DEFAULT_CONNECT = "0x00000000000000000000000000000000000000aa" as `0x${string}`;

// Read (or lazily create) the shared handle on window. Tests seed
// window.__ARCADE_FAKE__.config via an init script before the app boots.
function handle(): FakeGatewayHandle {
  if (!window.__ARCADE_FAKE__) {
    window.__ARCADE_FAKE__ = {
      config: {},
      state: { connectCalls: 0, mappedCalls: 0, submits: [] },
    };
  }
  return window.__ARCADE_FAKE__;
}

export function createFakeGateway(): ChainGateway {
  const h = handle();
  let player = h.config.player ?? null;

  return {
    async scoreOrdering() {
      return h.config.ordering ?? 0;
    },
    currentPlayer() {
      return player;
    },
    async connect() {
      h.state.connectCalls++;
      player = h.config.connectsTo ?? DEFAULT_CONNECT;
      return player;
    },
    async ensureMapped() {
      h.state.mappedCalls++;
    },
    async submitScore(score: number) {
      h.state.submits.push(score);
    },
    async getLeaderboard(): Promise<ScoreEntry[]> {
      return [];
    },
    async getRecent(): Promise<ScoreEntry[]> {
      return [];
    },
    async getBest(p) {
      return h.config.bests?.[p.toLowerCase()] ?? null;
    },
  };
}
