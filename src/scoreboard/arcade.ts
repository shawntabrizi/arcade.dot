import { getCdm, getContractAddress, isContractInstalled } from "./cdm";

const ARCADE_NAME = "@example/arcade-playground";
const LEADERBOARD_NAME = "@example/leaderboard-playground";

interface QueryResult<T> {
  success: boolean;
  value: T;
}

interface GameInfoValue {
  name: string;
  image_uri: string;
  registered_at: bigint;
  last_activity: bigint;
}

interface RecentScoreValue {
  game: `0x${string}`;
  player: `0x${string}`;
  score: bigint;
  timestamp: bigint;
}

interface ArcadeContract {
  registerGame: {
    tx: (contract: `0x${string}`, name: string, image_uri: string) => Promise<unknown>;
  };
  setDisplayName: {
    tx: (name: string) => Promise<unknown>;
  };
  recordScore: {
    tx: (game: `0x${string}`) => Promise<unknown>;
  };
  getGameCount: { query: () => Promise<QueryResult<number>> };
  getGameAt: { query: (i: number) => Promise<QueryResult<`0x${string}`>> };
  getGameInfo: {
    query: (game: `0x${string}`) => Promise<QueryResult<GameInfoValue>>;
  };
  getDisplayName: {
    query: (player: `0x${string}`) => Promise<QueryResult<string>>;
  };
  getTotalPoints: {
    query: (player: `0x${string}`) => Promise<QueryResult<bigint>>;
  };
  getPerGameBest: {
    query: (
      game: `0x${string}`,
      player: `0x${string}`,
    ) => Promise<QueryResult<bigint>>;
  };
  getPlayerCount: { query: () => Promise<QueryResult<number>> };
  getPlayerAt: { query: (i: number) => Promise<QueryResult<`0x${string}`>> };
  getRecentTotal: { query: () => Promise<QueryResult<number>> };
  getRecentAt: {
    query: (slot: number) => Promise<QueryResult<RecentScoreValue>>;
  };
  getRingSize: { query: () => Promise<QueryResult<number>> };
}

function arcade(): ArcadeContract {
  // The generated CDM type isn't surfaced as an exact match for our usage, so
  // we cast to a local interface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (getCdm() as any).getContract(ARCADE_NAME) as ArcadeContract;
}

export function getArcadeAddress(): `0x${string}` | null {
  return getContractAddress(ARCADE_NAME);
}

export function getLeaderboardAddress(): `0x${string}` | null {
  return getContractAddress(LEADERBOARD_NAME);
}

export function isArcadeInstalled(): boolean {
  return isContractInstalled(ARCADE_NAME);
}

export async function recordScore(game: `0x${string}`): Promise<void> {
  await arcade().recordScore.tx(game);
}

export async function setDisplayName(name: string): Promise<void> {
  await arcade().setDisplayName.tx(name);
}

export async function getDisplayName(
  player: `0x${string}`,
): Promise<string | null> {
  const r = await arcade().getDisplayName.query(player);
  if (!r.success) return null;
  return r.value || null;
}

// Batched name lookup with an in-memory cache. The leaderboard usually shows
// the same 10 players repeatedly across refreshes, so we don't want a query
// storm. Cache lives for the page's lifetime; refreshes the page invalidates.
const nameCache = new Map<string, string | null>();

export async function resolveDisplayNames(
  players: `0x${string}`[],
): Promise<Map<`0x${string}`, string | null>> {
  const out = new Map<`0x${string}`, string | null>();
  const missing: `0x${string}`[] = [];
  for (const p of players) {
    const key = p.toLowerCase();
    if (nameCache.has(key)) {
      out.set(p, nameCache.get(key) ?? null);
    } else {
      missing.push(p);
    }
  }
  await Promise.all(
    missing.map(async (p) => {
      const name = await getDisplayName(p);
      nameCache.set(p.toLowerCase(), name);
      out.set(p, name);
    }),
  );
  return out;
}

export async function getTotalPoints(
  player: `0x${string}`,
): Promise<bigint> {
  const r = await arcade().getTotalPoints.query(player);
  return r.success ? r.value : 0n;
}
