import type { PolkadotSigner } from "polkadot-api";
import { SignerManager } from "@parity/product-sdk-signer";
import { ensureAccountMapped, submitAndWatch } from "@parity/product-sdk-tx";
import { isInsideContainerSync } from "@parity/product-sdk-host";
import { ss58ToEthereum } from "@polkadot-api/sdk-ink";
import type { ScoreEntry, ScoreOrdering } from "./api";
import type { ChainGateway, SessionInfo } from "./gateway";
import { contractScoreboard } from "./reads";
import { gcsContract, getClient, inkSdkBest } from "./gcs";

// The ONE module that wires the real product-sdk. Everything else depends only
// on the ChainGateway seam (gateway.ts). SPEC §8.1: the player is their HOST
// WALLET account (SignerManager's host provider), NOT a product account.
//
// ⚠ Integration spike (BUILD_PLAN item 6): this whole round-trip — connect →
// ensureAccountMapped → submitScore at best-block — MUST be validated inside a
// real Triangle host on paseo-next-v2. The pieces below are assembled per the
// product-sdk contracts-demo example and the §8.1 requirements; the in-host
// behavior (host provider availability, the H160 the contract actually sees as
// caller(), AsPgas signed-extension handling for map_account/submitScore) is
// what item 6 confirms. See the report.
//
// NOTE on the caller H160: GCS reads/writes identify a player by the address
// pallet_revive maps the SS58 signer to. sdk-ink's `ss58ToEthereum` computes
// that mapping address; we use it (not SignerAccount.h160, which is the
// keccak-derived EVM address) so getBest(player) and submitScore agree.

interface Connected {
  ss58: string;
  signer: PolkadotSigner;
  h160: `0x${string}`;
}

// Sync container detection (SPEC §8.3 in-host vs standalone) via the maintained
// host SDK. isInsideContainerSync() is the synchronous heuristic (framed /
// host markers); isInsideContainer() (async) does a deeper product-sdk probe,
// but sync is right for the prompt-free on-load detection in detectSession().
function isInsideHostSync(): boolean {
  return isInsideContainerSync();
}

function toEntries(
  rows: { player: `0x${string}`; score: bigint; at: bigint }[] | null,
): ScoreEntry[] {
  if (!rows) return [];
  return rows.map((r) => ({ player: r.player, score: Number(r.score), timestamp: Number(r.at) }));
}

export interface SdkGatewayOptions {
  dappName?: string;
  // SS58 prefix for Paseo Asset Hub. 0 matches the deploy/verify scripts.
  ss58Prefix?: number;
  // The app's `.dot` identifier (e.g. "arcade-snake.dot"). REQUIRED in a real
  // dot.li host: the web host returns no raw wallet accounts, only a per-app
  // PRODUCT ACCOUNT derived from the user's root session + this identifier, and
  // it MUST match the deployed domain or the host rejects the request with
  // DomainNotValid. Omit only outside a host (no account available anyway).
  dotNsIdentifier?: string;
}

export function createSdkGateway(options: SdkGatewayOptions = {}): ChainGateway {
  const manager = new SignerManager({
    dappName: options.dappName ?? "arcade-game",
    ss58Prefix: options.ss58Prefix ?? 0,
    // Product-account path (SPEC §8.1, revised per item 6): the host derives a
    // per-app keypair for this identifier. Without it, connect() falls through
    // to getLegacyAccounts() which the web host returns empty → "no accounts".
    ...(options.dotNsIdentifier
      ? { productAccount: { dotNsIdentifier: options.dotNsIdentifier, derivationIndex: 0 } }
      : {}),
  });

  let connected: Connected | null = null;
  let orderingCache: ScoreOrdering | null = null;

  async function readOrdering(): Promise<ScoreOrdering> {
    if (orderingCache !== null) return orderingCache;
    const contract = gcsContract();
    // Default to higher-is-better if the contract isn't reachable; the value is
    // immutable per SPEC §4.2 so caching is safe.
    const o = contract
      ? await contract
          .query("scoreOrdering", { origin: "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM", data: {} })
          .then((r: { success: boolean; value?: { response: number } }) =>
            r.success ? r.value!.response : 0,
          )
      : 0;
    orderingCache = (o === 1 ? 1 : 0) as ScoreOrdering;
    return orderingCache;
  }

  // pallet_revive ReviveApi (structural; no chain descriptors needed).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function reviveApi(): any {
    return getClient().getUnsafeApi();
  }

  // Adopt the passively-connected host account into the cached `connected`
  // identity, WITHOUT prompting. Called from detectSession()/subscribeSession()
  // when getState() already reports a selected host account (e.g. the user is
  // signed in inside the host). Mirrors connect()'s derivation so reads/writes
  // use the SAME H160 (see the caller-H160 note above; item-6 open question:
  // confirm ss58ToEthereum(address) === the contract's caller() in a real host).
  function adoptFromState(): void {
    const state = manager.getState();
    const account = state.status === "connected" ? state.selectedAccount : null;
    if (!account) {
      connected = null;
      return;
    }
    if (connected && connected.ss58 === account.address) return;
    const signer = account.getSigner();
    const h160 = ss58ToEthereum(account.address).asHex() as `0x${string}`;
    connected = { ss58: account.address, signer, h160 };
  }

  return {
    scoreOrdering: readOrdering,

    currentPlayer() {
      return connected?.h160 ?? null;
    },

    detectSession(): SessionInfo {
      // PROMPT-FREE: only getState() + the sync heuristic. Never connect().
      adoptFromState();
      return {
        inHost: isInsideHostSync(),
        account: connected ? { ss58: connected.ss58, h160: connected.h160 } : null,
      };
    },

    subscribeSession(cb: () => void): () => void {
      // SignerManager.subscribe fires on every state mutation (incl. after
      // connect() resolves and on host-driven account changes). Re-derive the
      // cached identity, then notify the UI to re-read detectSession().
      return manager.subscribe(() => {
        adoptFromState();
        cb();
      });
    },

    async connect() {
      // SPEC §8.1: connect the HOST wallet account. SignerManager defaults to
      // the host provider; selectAccount picks the active one.
      const res = await manager.connect("host");
      if (!res.ok) throw res.error;
      const accounts = res.value;
      const account = manager.getState().selectedAccount ?? accounts[0];
      if (!account) throw new Error("No host wallet account available to sign in.");
      manager.selectAccount(account.address);
      const signer = manager.getSigner();
      if (!signer) throw new Error("Host wallet did not provide a signer.");
      const h160 = ss58ToEthereum(account.address).asHex() as `0x${string}`;
      connected = { ss58: account.address, signer, h160 };
      return h160;
    },

    async ensureMapped() {
      if (!connected) throw new Error("Sign in before mapping the account.");
      const sdk = inkSdkBest();
      await ensureAccountMapped(
        connected.ss58,
        connected.signer,
        { addressIsMapped: (addr: string) => sdk.addressIsMapped(addr) },
        reviveApi(),
      );
    },

    async submitScore(score) {
      if (!connected) throw new Error("Sign in before submitting a score.");
      const contract = gcsContract();
      if (!contract) throw new Error("GCS contract is not deployed (missing from cdm.json).");
      // Dry-run at best-block, then submit the dry-run's own tx (fills gas +
      // storage-deposit limits pallet_revive requires), resolving at best block.
      const dry = await contract.query("submitScore", {
        origin: connected.ss58,
        data: { score: BigInt(score) },
      });
      if (!dry.success) {
        throw new Error(
          `submitScore dry-run failed: ${JSON.stringify(dry.value, (_k: string, v: unknown) =>
            typeof v === "bigint" ? v.toString() : v,
          )}`,
        );
      }
      const result = await submitAndWatch(dry.value.send(), connected.signer, {
        waitFor: "best-block",
      });
      if (!result.ok) {
        throw new Error(`submitScore reverted: ${JSON.stringify(result.dispatchError)}`);
      }
    },

    async getLeaderboard(offset, limit) {
      const contract = gcsContract();
      if (!contract) return [];
      const r = await contract.query("getLeaderboard", {
        origin: connected?.ss58 ?? "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM",
        data: { offset, limit },
      });
      return r.success ? toEntries(r.value.response) : [];
    },

    async getRecent(offset, limit) {
      const contract = gcsContract();
      if (!contract) return [];
      const r = await contract.query("getRecent", {
        origin: connected?.ss58 ?? "5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM",
        data: { offset, limit },
      });
      return r.success ? toEntries(r.value.response) : [];
    },

    async getBest(player) {
      return contractScoreboard.getPlayerBest(player);
    },
  };
}
