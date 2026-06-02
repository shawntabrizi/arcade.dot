import { contractQuery, contractSendInBlock, getContractAddress, isContractInstalled } from "./cdm";
import { getBurnerSigner, getBurnerSs58 } from "./signer";

const ARCADE_NAME = "@example/arcade-playground";
const LEADERBOARD_NAME = "@example/leaderboard-playground";

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
  await contractSendInBlock(
    ARCADE_NAME,
    "recordScore",
    { game },
    getBurnerSs58(),
    getBurnerSigner(),
  );
}

export async function setDisplayName(name: string): Promise<void> {
  await contractSendInBlock(
    ARCADE_NAME,
    "setDisplayName",
    { name },
    getBurnerSs58(),
    getBurnerSigner(),
  );
}

export async function getDisplayName(
  player: `0x${string}`,
): Promise<string | null> {
  const name = await contractQuery<string>(
    ARCADE_NAME,
    "getDisplayName",
    { player },
    getBurnerSs58(),
  );
  return name ? name : null;
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
  const total = await contractQuery<bigint>(
    ARCADE_NAME,
    "getTotalPoints",
    { player },
    getBurnerSs58(),
  );
  return total ?? 0n;
}
