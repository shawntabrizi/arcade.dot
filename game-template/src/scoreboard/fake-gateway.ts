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
  // Drives the on-load session detection (SPEC §8.3 in-host vs standalone) so
  // the three login-status UX states can be tested without a real host. When
  // unset, defaults to true so the existing e2e flows behave as "in-host".
  inHost?: boolean;
  // SS58 paired with `player` for detectSession()'s pre-connected account. Only
  // its presence matters to the UI; defaults to a placeholder when omitted.
  playerSs58?: string;
  // Account-tab fixtures (SPEC §8.1). Free/reserved balance in planck, mapping
  // status, and the .dot identifier/index the tab displays.
  free?: number;
  reserved?: number;
  mapped?: boolean;
  identifier?: string;
  derivationIndex?: number;
  decimals?: number;
  symbol?: string;
}

export interface FakeGatewayState {
  connectCalls: number;
  mappedCalls: number;
  submits: number[];
  mapAccountCalls: number;
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
      state: { connectCalls: 0, mappedCalls: 0, submits: [], mapAccountCalls: 0 },
    };
  }
  return window.__ARCADE_FAKE__;
}

export function createFakeGateway(): ChainGateway {
  const h = handle();
  let player = h.config.player ?? null;
  let ss58 = h.config.playerSs58 ?? (player ? "fake-ss58" : null);
  const listeners = new Set<() => void>();

  return {
    async scoreOrdering() {
      return h.config.ordering ?? 0;
    },
    async accountDetails() {
      if (!player) return null;
      return {
        identifier: h.config.identifier ?? "arcade-test.dot",
        derivationIndex: h.config.derivationIndex ?? 0,
        ss58: ss58 ?? "fake-ss58",
        h160: player,
        free: BigInt(h.config.free ?? 0),
        reserved: BigInt(h.config.reserved ?? 0),
        mapped: h.config.mapped ?? false,
        decimals: h.config.decimals ?? 10,
        symbol: h.config.symbol ?? "PAS",
      };
    },
    async mapAccount() {
      h.state.mapAccountCalls = (h.state.mapAccountCalls ?? 0) + 1;
      if (h.config) h.config.mapped = true;
    },
    currentPlayer() {
      return player;
    },
    detectSession() {
      // Default inHost to true so existing flows (which don't set it) keep
      // behaving as in-host; standalone-guest tests set inHost: false.
      return {
        inHost: h.config.inHost ?? true,
        account: player ? { ss58: ss58 ?? "fake-ss58", h160: player } : null,
      };
    },
    subscribeSession(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async connect() {
      h.state.connectCalls++;
      player = h.config.connectsTo ?? DEFAULT_CONNECT;
      ss58 = h.config.playerSs58 ?? "fake-ss58";
      for (const cb of listeners) cb();
      return player;
    },
    async submitScore(score: number) {
      // submitScore maps-if-needed and submits in one approval (real gateway
      // batches them). Model that here: the first submit "maps" once.
      if (h.state.mappedCalls === 0) h.state.mappedCalls++;
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
