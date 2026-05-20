import { createCdm, type Cdm } from "@dotdm/cdm";
import cdmJson from "../cdm.json";

const ARCADE_NAME = "@example/arcade-playground";

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

interface QueryResult<T> {
  success: boolean;
  value: T;
}

interface ArcadeContract {
  getGameCount: { query: () => Promise<QueryResult<number>> };
  getGameAt: { query: (i: number) => Promise<QueryResult<Address>> };
  getGameInfo: {
    query: (game: Address) => Promise<
      QueryResult<{
        name: string;
        image_uri: string;
        registered_at: bigint;
        last_activity: bigint;
      }>
    >;
  };
  getDisplayName: {
    query: (player: Address) => Promise<QueryResult<string>>;
  };
  getTotalPoints: {
    query: (player: Address) => Promise<QueryResult<bigint>>;
  };
  getPlayerCount: { query: () => Promise<QueryResult<number>> };
  getPlayerAt: { query: (i: number) => Promise<QueryResult<Address>> };
  getRecentTotal: { query: () => Promise<QueryResult<number>> };
  getRecentAt: {
    query: (slot: number) => Promise<
      QueryResult<{
        game: Address;
        player: Address;
        score: bigint;
        timestamp: bigint;
      }>
    >;
  };
  getRingSize: { query: () => Promise<QueryResult<number>> };
}

function arcade(): ArcadeContract {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (cdm() as any).getContract(ARCADE_NAME) as ArcadeContract;
}

const nameCache = new Map<string, string | null>();
async function resolveName(player: Address): Promise<string | null> {
  const key = player.toLowerCase();
  if (nameCache.has(key)) return nameCache.get(key) ?? null;
  const r = await arcade().getDisplayName.query(player);
  const name = r.success && r.value ? r.value : null;
  nameCache.set(key, name);
  return name;
}

export async function getGames(): Promise<GameInfo[]> {
  const a = arcade();
  const count = (await a.getGameCount.query()).value;
  if (count === 0) return [];
  const addrs = await Promise.all(
    Array.from({ length: count }, (_, i) => a.getGameAt.query(i)),
  );
  const infos = await Promise.all(
    addrs.map((r) => a.getGameInfo.query(r.value)),
  );
  return addrs.map((r, i) => ({
    address: r.value,
    name: infos[i].value.name,
    imageUri: infos[i].value.image_uri,
    registeredAt: Number(infos[i].value.registered_at),
    lastActivity: Number(infos[i].value.last_activity),
  }));
}

export async function getTopPlayers(limit = 10): Promise<PlayerPoints[]> {
  const a = arcade();
  const count = (await a.getPlayerCount.query()).value;
  if (count === 0) return [];
  const addrs = await Promise.all(
    Array.from({ length: count }, (_, i) => a.getPlayerAt.query(i)),
  );
  const totals = await Promise.all(
    addrs.map((r) => a.getTotalPoints.query(r.value)),
  );
  const names = await Promise.all(addrs.map((r) => resolveName(r.value)));
  const players: PlayerPoints[] = addrs.map((r, i) => ({
    address: r.value,
    totalPoints: totals[i].value,
    displayName: names[i],
  }));
  players.sort((a, b) => (b.totalPoints > a.totalPoints ? 1 : b.totalPoints < a.totalPoints ? -1 : 0));
  return players.slice(0, limit);
}

export async function getRecent(limit = 20): Promise<RecentScore[]> {
  const a = arcade();
  const total = (await a.getRecentTotal.query()).value;
  if (total === 0) return [];
  const ringSize = (await a.getRingSize.query()).value;
  const n = Math.min(total, ringSize, limit);
  // Walk backwards from the most-recent slot.
  const slots = Array.from({ length: n }, (_, i) => (total - 1 - i + ringSize) % ringSize);
  const rows = await Promise.all(slots.map((s) => a.getRecentAt.query(s)));
  const names = await Promise.all(rows.map((r) => resolveName(r.value.player)));
  return rows.map((r, i) => ({
    game: r.value.game,
    player: r.value.player,
    displayName: names[i],
    score: r.value.score,
    timestamp: Number(r.value.timestamp),
  }));
}
