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
  return addrs.map((address, i) => ({
    address,
    name: infos[i].name,
    imageUri: infos[i].image_uri,
    registeredAt: Number(infos[i].registered_at),
    lastActivity: Number(infos[i].last_activity),
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

export async function getRecent(limit = 20): Promise<RecentScore[]> {
  const total = await q<number>("getRecentTotal");
  if (total === 0) return [];
  const ringSize = await q<number>("getRingSize");
  const n = Math.min(total, ringSize, limit);
  // Walk backwards from the most-recent slot.
  const slots = Array.from({ length: n }, (_, i) => (total - 1 - i + ringSize) % ringSize);
  const rows = await Promise.all(
    slots.map((slot) =>
      q<{ game: Address; player: Address; score: bigint; timestamp: bigint }>("getRecentAt", { slot }),
    ),
  );
  const names = await Promise.all(rows.map((r) => resolveName(r.player)));
  return rows.map((r, i) => ({
    game: r.game,
    player: r.player,
    displayName: names[i],
    score: r.score,
    timestamp: Number(r.timestamp),
  }));
}
