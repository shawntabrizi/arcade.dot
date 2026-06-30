import { AccountId, type PolkadotSigner } from "polkadot-api";
import {
  createAccountsProvider,
  hostApi,
  requestPermission,
  sandboxTransport,
  type ProductAccount,
} from "@novasamatech/host-api-wrapper";
import { RequestCredentialsErr } from "@novasamatech/host-api";
import { ss58ToH160 } from "@parity/product-sdk-address";
import { batchSubmitAndWatch, type BatchableCall } from "@parity/product-sdk-tx";
import type { ScoreEntry, ScoreOrdering } from "./api";
import type { ChainGateway, SessionInfo } from "./gateway";
import { resolveProductIdentifier } from "./identifier";
import { contractScoreboard } from "./reads";
import { gcsContract, gcsQuery, getClient, inkSdkBest, READ_ORIGIN } from "./gcs";

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

// Identifier the host uses to scope our product. Use the raw host only when
// it's itself a valid identifier (dev: "localhost:PORT", or a ".dot" origin);
// in the deployed sandbox the host is "<label>.app.dot.li" (ends ".dot.li" —
// rejected by dot.li with DomainNotValid), so fall back to the configured
// "<domain>.dot". See identifier.ts for the dot.li acceptance rule.
function getProductIdentifier(configuredDotId?: string): string {
  const host = typeof window !== "undefined" ? window.location.host : "";
  return resolveProductIdentifier(host, configuredDotId);
}

export function createSdkGateway(options: SdkGatewayOptions = {}): ChainGateway {
  const identifier = getProductIdentifier(options.dotNsIdentifier);
  const derivationIndex = 0;

  let connected: Connected | null = null;
  let lastInHost = false;
  let lastError: string | null = null;
  let orderingCache: ScoreOrdering | null = null;
  let chainSubmitGranted = false;
  let contractAllowanceGranted = false;
  let mapped = false;
  const listeners = new Set<() => void>();

  function notify() {
    for (const cb of listeners) cb();
  }

  // Turn a host credential error into a specific, actionable string (Fix #3).
  // The variant is what we need to see when sign-in fails in a host.
  function describeCredError(error: unknown): string {
    if (error instanceof RequestCredentialsErr.NotConnected) {
      return "not signed in to the host";
    }
    if (error instanceof RequestCredentialsErr.DomainNotValid) {
      return `host rejected the app identifier "${identifier}" (DomainNotValid) — it must be the deployed <domain>.dot`;
    }
    const name = (error as { constructor?: { name?: string } })?.constructor?.name;
    const msg = (error as { message?: string })?.message;
    return `${name ?? "error"}${msg ? `: ${msg}` : ""}`;
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
        lastError = describeCredError(result.error); // Fix #3: keep the variant.
        notify();
        return { inHost: true };
      }
      connected = adopt(result.value.publicKey);
      lastInHost = true;
      lastError = null;
      notify();
      return { inHost: true };
    } catch (e) {
      // Hard transport failure → no host responded → standalone guest.
      connected = null;
      lastInHost = false;
      lastError = `no host transport (${String((e as { message?: string })?.message ?? e).slice(0, 80)})`;
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
    // Default to higher-is-better if unreachable; immutable per SPEC §4.2 so
    // caching is safe. Read via gcs.ts's ReviveApi.call path (not trace_call).
    const o = (await gcsQuery<number>("scoreOrdering", {}, READ_ORIGIN)) ?? 0;
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

  // RFC-0010 PGAS: ask the host to sponsor gas + storage deposit for the contract
  // call via a SmartContractAllowance, so the per-app product account doesn't
  // have to be manually funded. Without this, a player's first submitScore reverts
  // `Revive::StorageDepositNotEnoughFunds` (the fresh product account has no PAS).
  // The proven dApp-factory template requests this before every write. Lazy +
  // cached (one phone approval per session); non-fatal — in dev/standalone, or if
  // the host declines, we still attempt the submit and surface any real failure.
  async function ensureContractAllowance(): Promise<void> {
    if (contractAllowanceGranted) return;
    if (!sandboxTransport.isCorrectEnvironment()) return; // no host to sponsor
    try {
      const result = await hostApi.requestResourceAllocation({
        tag: "v1",
        value: [{ tag: "SmartContractAllowance", value: derivationIndex }],
      });
      // ok payload mirrors the request: { tag: "v1", value: outcome[] } where
      // outcome[0].tag is "Allocated" | "Rejected" | "NotAvailable".
      if (result.isOk?.()) {
        const outcomes = (result.value as { value?: { tag?: string }[] } | undefined)?.value;
        if (Array.isArray(outcomes) && outcomes[0]?.tag === "Allocated") {
          contractAllowanceGranted = true;
        }
      }
    } catch {
      // Allocation unavailable (dev/transport) — proceed; the submit surfaces
      // any real funding/authorization failure.
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
      // Fix #1: do NOT call accountsProvider.subscribeAccountConnectionStatus —
      // outside the sandbox it throws "Environment is not correct" synchronously,
      // which crashed the whole app to a blank page (standalone + desktop). RPS
      // deliberately uses no live subscription: a one-shot getProductAccount on
      // load (ensureDetectStarted → refresh → notify) plus a re-fetch after the
      // explicit connect() is enough. The listener fires when refresh resolves.
      listeners.add(cb);
      ensureDetectStarted();
      return () => {
        listeners.delete(cb);
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
        // Fix #3: surface the real reason (variant + identifier), not a generic
        // "no product account" that hides whether it's DomainNotValid, a denied
        // login, or no host at all.
        throw new Error(
          res.inHost
            ? `Couldn't sign in: ${lastError ?? "host returned no product account"}`
            : "Open this game in the Polkadot app to sign in.",
        );
      }
      return connected.h160;
    },

    async submitScore(score) {
      if (!connected) throw new Error("Sign in before submitting a score.");
      await ensureChainSubmit();
      // PGAS sponsorship so the fresh per-app product account need not be funded
      // (else the deposit can't be paid → StorageDepositNotEnoughFunds).
      await ensureContractAllowance();
      const contract = gcsContract();
      if (!contract) throw new Error("GCS contract is not deployed (missing from cdm.json).");

      // pallet_revive requires the SS58 origin to be mapped before a contract
      // call (else AccountUnmapped). Each game uses its OWN per-app product
      // account, so a player's FIRST save for a game is always unmapped. We
      // therefore DON'T depend on a successful dry-run for limits: an unmapped
      // origin reverts AccountUnmapped, and an unfunded one reverts
      // StorageDepositNotEnoughFunds — both before any estimate. Instead we send
      // with explicit, generous limits (the same fallback the dApp-factory
      // known-good template uses) and let the PGAS-sponsored, player-signed batch
      // do the real work. map_account runs first in the batch so submitScore then
      // executes as the now-mapped player.
      const sdk = inkSdkBest();
      if (!mapped) mapped = await sdk.addressIsMapped(connected.ss58);

      const scoreCall = contract.send("submitScore", {
        data: { score: BigInt(score) },
        gasLimit: { ref_time: 50_000_000_000n, proof_size: 2_000_000n },
        storageDepositLimit: 10_000_000_000n,
      });

      // ONE host approval: when unmapped, batch map_account + the contract call
      // into a single batch_all extrinsic so the player signs ONCE.
      const calls: BatchableCall[] = [];
      if (!mapped) calls.push(reviveApi().tx.Revive.map_account());
      calls.push(scoreCall);

      const result = await batchSubmitAndWatch(calls, reviveApi(), connected.signer, {
        mode: "batch_all",
        waitFor: "best-block",
      });
      if (!result.ok) {
        throw new Error(
          `submitScore reverted: ${JSON.stringify(result.dispatchError, (_k: string, v: unknown) =>
            typeof v === "bigint" ? v.toString() : v,
          )}`,
        );
      }
      mapped = true; // a successful batch leaves the account mapped on-chain
    },

    async getLeaderboard(offset, limit) {
      // Public getter — caller-agnostic, so read as the known-mapped READ_ORIGIN
      // (a signed-in-but-unmapped player would revert AccountUnmapped).
      const rows = await gcsQuery<{ player: `0x${string}`; score: bigint; at: bigint }[]>(
        "getLeaderboard",
        { offset, limit },
        READ_ORIGIN,
      );
      return toEntries(rows);
    },

    async getRecent(offset, limit) {
      const rows = await gcsQuery<{ player: `0x${string}`; score: bigint; at: bigint }[]>(
        "getRecent",
        { offset, limit },
        READ_ORIGIN,
      );
      return toEntries(rows);
    },

    async getBest(player) {
      return contractScoreboard.getPlayerBest(player);
    },
  };
}
