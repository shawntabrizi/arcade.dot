import { createCdm, type Cdm } from "@dotdm/cdm";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import cdmJson from "../cdm.json";

const ARCADE_NAME = "@example/arcade-playground";
// Reads don't need a funded account; cdm itself defaults query origin to Alice.
const QUERY_ORIGIN = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

export type Address = `0x${string}`;

export interface GameInfo {
  address: Address;
  name: string;
  imageUri: string;
  registeredAt: number;
  lastActivity: number;
}

export interface PlayerPoints {
  address: Address;
  displayName: string | null;
  totalPoints: bigint;
}

export interface RecentScore {
  game: Address;
  player: Address;
  displayName: string | null;
  score: bigint;
  timestamp: number;
}

let cdmInstance: Cdm | null = null;
function cdm(): Cdm {
  if (!cdmInstance) cdmInstance = createCdm(cdmJson);
  return cdmInstance;
}

// A contract pinned to the *best* block, not finalized — so the dashboard sees
// the game's in-block record_score writes within ~a block instead of lagging
// ~finality behind them. (cdm's own wrapper reads at finalized.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bestContract: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function arcade(): any {
  if (!bestContract) {
    const contracts = (cdmJson as { contracts: Record<string, Record<string, { address: Address; abi: unknown[] }>> }).contracts;
    const entry = contracts[Object.keys(contracts)[0]][ARCADE_NAME];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bestContract = (createInkSdk(cdm().client, { atBest: true }) as any).getContract(
      { abi: entry.abi },
      entry.address,
    );
  }
  return bestContract;
}

// Read a view method at the best block. Returns the decoded response.
async function q<T>(method: string, data: Record<string, unknown> = {}): Promise<T> {
  const r = await arcade().query(method, { origin: QUERY_ORIGIN, data });
  if (!r.success) throw new Error(`arcade.${method} query failed`);
  return r.value.response as T;
}

// Minimal slice of the leaderboard ABI: just the recent-activity ring. Lets the
// dashboard read each registered game's *every-play* feed directly, rather than
// the arcade's recent ring (which only captures personal-best beats).
const LEADERBOARD_RECENT_ABI = [
  { type: "function", name: "getRecentTotal", inputs: [], outputs: [{ name: "", type: "uint32" }], stateMutability: "view" },
  { type: "function", name: "getRecentSize", inputs: [], outputs: [{ name: "", type: "uint32" }], stateMutability: "view" },
  {
    type: "function",
    name: "getRecentAt",
    inputs: [{ name: "slot", type: "uint32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "player", type: "address" },
          { name: "score", type: "uint128" },
          { name: "timestamp", type: "uint64" },
        ],
      },
    ],
    stateMutability: "view",
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gameContracts = new Map<string, any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gameContract(address: Address): any {
  let c = gameContracts.get(address);
  if (!c) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c = (createInkSdk(cdm().client, { atBest: true }) as any).getContract(
      { abi: LEADERBOARD_RECENT_ABI },
      address,
    );
    gameContracts.set(address, c);
  }
  return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function gameQuery<T>(contract: any, method: string, data: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await contract.query(method, { origin: QUERY_ORIGIN, data });
    return r.success ? (r.value.response as T) : null;
  } catch {
    return null; // older game contracts predate the ring -> treated as no recent plays
  }
}

// Up to `limit` recent plays from one game's ring, newest first. Empty if the
// game's contract doesn't expose the ring (older deploy).
async function gameRecent(address: Address, limit: number): Promise<RecentScore[]> {
  const c = gameContract(address);
  const total = await gameQuery<number>(c, "getRecentTotal");
  if (!total) return [];
  const ringSize = await gameQuery<number>(c, "getRecentSize");
  if (!ringSize) return [];
  const n = Math.min(total, ringSize, limit);
  const slots = Array.from({ length: n }, (_, i) => (total - 1 - i + ringSize) % ringSize);
  const rows = await Promise.all(
    slots.map((slot) =>
      gameQuery<{ player: Address; score: bigint; timestamp: bigint }>(c, "getRecentAt", { slot }),
    ),
  );
  return rows
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({
      game: address,
      player: r.player,
      displayName: null,
      score: r.score,
      timestamp: Number(r.timestamp),
    }));
}

// Subscribe to new best blocks; the callback gets the head block number.
// Returns an unsubscribe fn. Drives the dashboard's near-real-time refresh.
export function onNewBlock(cb: (blockNumber: number) => void): () => void {
  const sub = cdm().client.bestBlocks$.subscribe({
    next: (blocks) => {
      const head = blocks[0];
      if (head) cb(head.number);
    },
    error: () => {},
  });
  return () => sub.unsubscribe();
}

// Cache only *resolved* names: a player who sets a name later should pick it up
// on the next refresh rather than being stuck on their address.
const nameCache = new Map<string, string>();
async function resolveName(player: Address): Promise<string | null> {
  const key = player.toLowerCase();
  const cached = nameCache.get(key);
  if (cached) return cached;
  const name = await q<string>("getDisplayName", { player });
  if (name) nameCache.set(key, name);
  return name || null;
}

export async function getGames(): Promise<GameInfo[]> {
  const count = await q<number>("getGameCount");
  if (count === 0) return [];
  const addrs = await Promise.all(
    Array.from({ length: count }, (_, i) => q<Address>("getGameAt", { index: i })),
  );
  const infos = await Promise.all(
    addrs.map((address) =>
      q<{ name: string; image_uri: string; registered_at: bigint; last_activity: bigint }>(
        "getGameInfo",
        { game: address },
      ),
    ),
  );
  // Derive last-activity from each game's recent ring (every play), falling
  // back to the arcade's last_activity (PB-beats only) for older games.
  const latest = await Promise.all(addrs.map((address) => gameRecent(address, 1)));
  return addrs.map((address, i) => ({
    address,
    name: infos[i].name,
    imageUri: infos[i].image_uri,
    registeredAt: Number(infos[i].registered_at),
    lastActivity: latest[i][0]?.timestamp ?? Number(infos[i].last_activity),
  }));
}

export async function getTopPlayers(limit = 10): Promise<PlayerPoints[]> {
  const count = await q<number>("getPlayerCount");
  if (count === 0) return [];
  const addrs = await Promise.all(
    Array.from({ length: count }, (_, i) => q<Address>("getPlayerAt", { index: i })),
  );
  const totals = await Promise.all(
    addrs.map((address) => q<bigint>("getTotalPoints", { player: address })),
  );
  const names = await Promise.all(addrs.map((address) => resolveName(address)));
  const players: PlayerPoints[] = addrs.map((address, i) => ({
    address,
    totalPoints: totals[i],
    displayName: names[i],
  }));
  players.sort((a, b) => (b.totalPoints > a.totalPoints ? 1 : b.totalPoints < a.totalPoints ? -1 : 0));
  return players.slice(0, limit);
}

// Latest plays across every registered game — merged from each game's own
// recent ring (which records ALL submissions), so the feed shows live activity
// rather than just personal-best beats (what the arcade's own ring captures).
export async function getRecent(limit = 20): Promise<RecentScore[]> {
  const count = await q<number>("getGameCount");
  if (count === 0) return [];
  const addrs = await Promise.all(
    Array.from({ length: count }, (_, i) => q<Address>("getGameAt", { index: i })),
  );
  const perGame = await Promise.all(addrs.map((address) => gameRecent(address, limit)));
  const merged = perGame
    .flat()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
  const names = await Promise.all(merged.map((r) => resolveName(r.player)));
  return merged.map((r, i) => ({ ...r, displayName: names[i] }));
}
