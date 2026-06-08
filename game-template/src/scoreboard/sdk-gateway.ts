import { AccountId, type PolkadotSigner } from "polkadot-api";
import {
  createAccountsProvider,
  requestPermission,
  sandboxTransport,
  type ProductAccount,
} from "@novasamatech/host-api-wrapper";
import { RequestCredentialsErr } from "@novasamatech/host-api";
import { ss58ToH160 } from "@parity/product-sdk-address";
import { ensureAccountMapped, submitAndWatch } from "@parity/product-sdk-tx";
import type { ScoreEntry, ScoreOrdering } from "./api";
import type { ChainGateway, SessionInfo } from "./gateway";
import { contractScoreboard } from "./reads";
import { gcsContract, getClient, inkSdkBest } from "./gcs";

// The ONE module that wires the real host integration. Everything else depends
// only on the ChainGateway seam (gateway.ts).
//
// This follows the PROVEN Rock-Paper-Scissors host recipe (works in BOTH the
// dot.li web host AND the Polkadot Desktop app). It deliberately AVOIDS
// @parity/product-sdk-signer's SignerManager: that path routes through
// getLegacyAccounts(), which the new desktop/web hosts return empty → "no
// accounts", and its container heuristic reports guest mode in Desktop. Instead
// we go straight at @novasamatech/host-api-wrapper:
//   - createAccountsProvider(sandboxTransport).getProductAccount(id, index)
//     for the per-app PRODUCT ACCOUNT (the player's identity here);
//   - getProductAccountSigner(account, "createTransaction") for the signer
//     (the "createTransaction" signerType routes through the host's
//     host_create_transaction RPC and bypasses the PJS signed-extension
//     whitelist that breaks pallet_revive signing on Paseo Next v2);
//   - ss58ToH160() from @parity/product-sdk-address for the H160 the contract
//     sees as caller() (RPS proves this is the pallet_revive mapping; it is the
//     SAME H160 used for getBest reads and submitScore so they agree).

// The accounts provider, built once. createAccountsProvider now takes the
// sandbox transport explicitly (host-api-wrapper 0.8.x); the same instance works
// on both the Desktop webview and the dot.li iframe.
const accountsProvider = createAccountsProvider(sandboxTransport);
const accountIdCodec = AccountId();

interface Connected {
  ss58: string;
  signer: PolkadotSigner;
  h160: `0x${string}`;
  productAccount: ProductAccount;
}

function toEntries(
  rows: { player: `0x${string}`; score: bigint; at: bigint }[] | null,
): ScoreEntry[] {
  if (!rows) return [];
  return rows.map((r) => ({ player: r.player, score: Number(r.score), timestamp: Number(r.at) }));
}

export interface SdkGatewayOptions {
  // SS58 prefix for Paseo Asset Hub. 0 matches the deploy/verify scripts. (Kept
  // for signature compatibility; AccountId() defaults to the generic prefix.)
  ss58Prefix?: number;
  // The app's `.dot` identifier (e.g. "arcade-snake.dot"). Used as the product
  // identifier the host scopes the per-app account to. RPS uses
  // window.location.host VERBATIM (its getProductIdentifier): Polkadot Desktop
  // accepts the raw host for both `.dot` domains and `localhost:PORT`, and the
  // signing-permission check matches the identifier against that same host
  // context — appending/derived labels makes the signer's identifier diverge and
  // signing is denied. We therefore prefer window.location.host and fall back to
  // this configured identifier (then a constant) when there is no window.
  dotNsIdentifier?: string;
}

// Identifier the host uses to scope our product. RPS getProductIdentifier:
// window.location.host verbatim, with a sensible fallback.
function getProductIdentifier(fallback?: string): string {
  if (typeof window !== "undefined" && window.location.host) {
    return window.location.host;
  }
  return fallback ?? "arcade-game.dot";
}

export function createSdkGateway(options: SdkGatewayOptions = {}): ChainGateway {
  const identifier = getProductIdentifier(options.dotNsIdentifier);
  const derivationIndex = 0;

  let connected: Connected | null = null;
  let lastInHost = false;
  let orderingCache: ScoreOrdering | null = null;
  let chainSubmitGranted = false;
  let mapped = false;
  const listeners = new Set<() => void>();

  function notify() {
    for (const cb of listeners) cb();
  }

  // Build the cached `connected` identity from a fetched product-account public
  // key. Derives the SS58 (RPS: accountIdCodec.dec(publicKey)) and the H160 the
  // contract maps the caller to (RPS: ss58ToH160(ss58)). The signer uses the
  // "createTransaction" signerType (REQUIRED — see the module header).
  function adopt(publicKey: Uint8Array): Connected {
    const productAccount: ProductAccount = {
      dotNsIdentifier: identifier,
      derivationIndex,
      publicKey,
    };
    const signer = accountsProvider.getProductAccountSigner(productAccount, "createTransaction");
    const ss58 = accountIdCodec.dec(publicKey);
    const h160 = ss58ToH160(ss58 as never) as `0x${string}`;
    return { ss58, signer, h160, productAccount };
  }

  // Attempt the (prompt-free) product-account fetch and map the outcome to
  // session state. This is the RPS connect flow used both for detection and for
  // the explicit connect():
  //   success                          → SIGNED IN (account available)
  //   RequestCredentialsErr.NotConnected → in-host but not signed in (guest)
  //   any other error                  → guest/error (a host responded)
  //   thrown (transport)               → standalone (no host responded)
  // Returns { inHost } so detectSession can preserve the App.tsx 3-state UI.
  async function refresh(): Promise<{ inHost: boolean }> {
    // sandboxTransport.isCorrectEnvironment() is the host-vs-standalone probe.
    // When false we are standalone: no host to ask, definitely guest.
    if (!sandboxTransport.isCorrectEnvironment()) {
      const changed = connected !== null || lastInHost !== false;
      connected = null;
      lastInHost = false;
      if (changed) notify();
      return { inHost: false };
    }

    try {
      const result = await accountsProvider.getProductAccount(identifier, derivationIndex);
      if (result.isErr()) {
        // A host responded (so inHost = true), we just have no signed-in session.
        connected = null;
        lastInHost = true;
        notify();
        if (result.error instanceof RequestCredentialsErr.NotConnected) {
          return { inHost: true };
        }
        // DomainNotValid / Rejected / Unknown — still in-host, still guest.
        return { inHost: true };
      }
      connected = adopt(result.value.publicKey);
      lastInHost = true;
      notify();
      return { inHost: true };
    } catch {
      // Hard transport failure → no host responded → standalone guest.
      connected = null;
      lastInHost = false;
      notify();
      return { inHost: false };
    }
  }

  // Kick off a prompt-free detection at construction so subscribers transition
  // from the synchronous default to the real state without an explicit connect.
  let detectStarted = false;
  function ensureDetectStarted() {
    if (detectStarted) return;
    detectStarted = true;
    void refresh();
  }

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

  // RFC-0002 permission: the host requires explicit ChainSubmit approval before
  // we submit a tx. RPS's ensurePermission pattern — request once, cache the
  // grant. requestPermission returns a neverthrow Result.
  async function ensureChainSubmit(): Promise<void> {
    if (chainSubmitGranted) return;
    try {
      const result = await requestPermission({ tag: "ChainSubmit", value: undefined });
      if (result.isOk() && result.value) {
        chainSubmitGranted = true;
      }
      // If denied/errored we still attempt the tx; the host enforces the gate
      // and surfaces a clear signing error — we don't want to mask a host that
      // simply doesn't require the permission in dev.
    } catch {
      // Permission request not available (e.g. dev) — proceed and let the tx
      // path surface any real authorization failure.
    }
  }

  return {
    scoreOrdering: readOrdering,

    currentPlayer() {
      return connected?.h160 ?? null;
    },

    detectSession(): SessionInfo {
      // PROMPT-FREE: getProductAccount is itself prompt-free (it returns
      // NotConnected when nobody is signed in rather than opening a login UI).
      // We start it asynchronously and report the latest known state; the App
      // re-reads via subscribeSession when refresh() resolves.
      ensureDetectStarted();
      return {
        inHost: connected !== null || lastInHost,
        account: connected ? { ss58: connected.ss58, h160: connected.h160 } : null,
      };
    },

    subscribeSession(cb: () => void): () => void {
      listeners.add(cb);
      ensureDetectStarted();
      // Keep the cached identity current with host-driven connection changes
      // (sign-in / sign-out inside the host) without prompting.
      const sub = accountsProvider.subscribeAccountConnectionStatus(() => {
        void refresh();
      });
      return () => {
        listeners.delete(cb);
        try {
          sub?.unsubscribe?.();
        } catch {
          /* ignore */
        }
      };
    },

    async connect(): Promise<`0x${string}`> {
      // Explicit, prompt-allowed sign-in. If the user isn't connected yet, open
      // the host login UI (RPS signIn), then re-fetch the product account.
      let res = await refresh();
      if (!connected && res.inHost) {
        try {
          await accountsProvider.requestLogin("Sign in to save your score");
        } catch {
          /* user may already be logged in; fall through to re-fetch */
        }
        res = await refresh();
      }
      if (!connected) {
        throw new Error(
          res.inHost
            ? "Host did not return a product account after sign-in."
            : "Open this game in the Polkadot app to sign in.",
        );
      }
      return connected.h160;
    },

    async ensureMapped() {
      if (!connected) throw new Error("Sign in before mapping the account.");
      if (mapped) return;
      await ensureChainSubmit();
      const sdk = inkSdkBest();
      // pallet_revive on Paseo Next v2 requires every SS58 origin that calls a
      // contract to have an explicit map_account entry. ensureAccountMapped is
      // idempotent (short-circuits when storage already has the entry).
      await ensureAccountMapped(
        connected.ss58,
        connected.signer,
        { addressIsMapped: (addr: string) => sdk.addressIsMapped(addr) },
        reviveApi(),
      );
      mapped = true;
    },

    async submitScore(score) {
      if (!connected) throw new Error("Sign in before submitting a score.");
      await ensureChainSubmit();
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
