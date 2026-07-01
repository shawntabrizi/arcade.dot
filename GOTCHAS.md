# What We Got Wrong Building for the Polkadot Host (and Why)

This is a field guide for anyone building an app that runs **inside the Polkadot
host environment** — the dot.li web shell or the Polkadot Desktop app. We wrote
it after building the Polkadot Arcade (a game-discovery dashboard plus a turnkey
on-chain game template) and discovering, repeatedly, that the instincts we
brought from normal web and dapp development were quietly wrong inside the host.

**The one theme that ties almost every entry together:** the host is a
**sandbox with its own trust, identity, and networking model**. Outside the
host, your app talks to wallets, RPC nodes, and CDNs directly — that's correct,
standard practice. Inside the host, the host mediates all of that *for* you, and
the moment you reach around it (open your own socket, load your own font, pop
your own window), you either get blocked, get a scary permission prompt, or get
an empty result. None of the mistakes below were careless — every one was the
*normal* thing to do, just in the wrong context.

We're keeping this document alive. **When you hit a new one, add it.** The format
is deliberately a short story, not a bug tracker: explain what you did, why it
was reasonable, why the host disagreed, and what fixed it. That "why it was
reasonable" part is the valuable bit — it's what stops the next person.

---

## Part 1 — Identity: the host hands you one account, not a wallet

### We asked for the user's accounts. The host doesn't work that way.

The normal dapp flow is: connect to a wallet, enumerate the user's accounts, let
them pick one. So we did exactly that — wired up the account-list/`SignerManager`
flow and called `getLegacyAccounts()`. It returned an empty array, and the app
reported "no accounts available."

The host doesn't expose the user's wallet to a sandboxed app. Instead it gives
the app exactly **one host-derived "product account"** that is scoped to that
specific app. There is no account picker because there is nothing to pick — the
identity is assigned, not chosen. The account-enumeration APIs we reached for
belong to a different, full-trust context that a sandboxed app never sees.

The fix was to stop thinking in wallets and use the product-account flow from
`@novasamatech/host-api-wrapper`: `createAccountsProvider` →
`getProductAccount` → `getProductAccountSigner(account, "createTransaction")`.
Once we accepted "one assigned account per app" instead of "the user's wallet,"
everything downstream got simpler.

**Takeaway:** inside the host, identity is a single product account the host
gives you. Don't port the wallet-connect / account-list pattern; it's for a
context you're not in.

### We identified the app by its URL host. The host identifies it by its `.dot` label.

Naturally, we derived the app's identifier from `window.location.host` — that's
how you'd scope anything to "the current site." Signing then failed
(`isProductAccountValid` rejected us).

The catch is that on dot.li the browser's host is `<label>.app.dot.li` (the
sandboxed iframe), but the host enforces that an app signs as its **canonical
`.dot` label** — `<label>.dot`. The URL host and the signing identity are two
different strings, and only one of them is the truth.

Fix: build the identifier as `<label>.dot` explicitly, never from
`window.location.host`.

**Takeaway:** the app's on-chain identity is its `.dot` label, not whatever the
browser reports as the host.

### We assumed fees were covered, so writes would "just work." Deposits aren't fees.

Coming from chains where a sponsored/meta-transaction covers your costs, we
expected a fresh app to be able to write to its contract immediately. The first
score-save failed with `StorageDepositNotEnoughFunds`.

Two things we didn't internalize: (1) every app's product account is **distinct
and starts with a zero balance**, and (2) the host sponsors **transaction fees**
but **not storage deposits** — deposits are *reserved from the signer's own
balance*. A brand-new account has nothing to reserve. We then wondered if we
could share one funded account across games via subdomains
(`snake.arcade.dot`, `wordle.arcade.dot`); we can't — **subdomains get
different product accounts**, so that doesn't dodge the problem.

The fix (tracked as an MVP TODO) is a one-time funding step: on sign-in, check
the balance and, if empty, surface a "Get test funds" action that opens the
faucet with `?address=<account>`. Each product account is independently derived,
so each needs funding once. The only way to truly avoid N-funding is a single
bundled origin (one app, one account) — a deliberate architecture choice, not
something subdomains give you for free.

**Takeaway:** fees ≠ deposits. The host covers fees; you fund deposits. Plan a
per-product-account funding step from day one.

---

## Part 2 — Talking to the chain: there's a right origin and a right transport

### Our reads returned nothing, because an "anonymous" read origin is rejected.

To read a contract you do a dry-run/query, and a query needs an *origin*. Outside
`pallet_revive` you'd happily pass any address — reads don't cost anything, so
who cares which account asks? We picked an arbitrary SS58 and every read came
back empty. The dashboard showed "no games"; in-game leaderboards were blank —
even though the data was on chain.

`pallet_revive` rejects a query whose origin is an **unmapped** account: the call
reverts with `AccountUnmapped` and you get nothing back. So the read "succeeds"
into an empty result and you spend an hour assuming your contract or indexing is
wrong, when it's the origin.

The fix is to read as an origin that is always mapped: pallet-revive's **own
pallet account**, `5EYCAe5ijiYfhaAUBd6H9WGRTsvwFFc7GnhQkiHvBYxdvpbV` (this is
`PalletId(*b"py/reviv").into_account_truncating()`, the convention from
product-sdk PR #152). It's stable, always on-chain, and not tied to a dev seed
like `//Alice`. We hit this **twice** — once in the dashboard and once in the
game — because the constant was copy-pasted; centralizing it into a single
`READ_ORIGIN` fixed both for good.

**Takeaway:** reads have an origin too, and it must be a *mapped* account. Use the
pallet account, define it once.

### Our write dry-run failed for a new player — same `AccountUnmapped`, different place.

When saving a score we dry-ran the transaction as the player's own account. For a
player who had never transacted, that account isn't mapped yet, so the dry-run
reverted with `AccountUnmapped` before we ever submitted.

The fix has two halves. For the *dry-run*, use the mapped `READ_ORIGIN` when the
player isn't mapped. For the *real submit*, send `[map_account, submitScore]` as
a single `batch_all` so one signature both maps the account and writes the score.
We briefly suspected the batch itself was causing the storage-deposit failure
from Part 1 — it isn't; **batching is unrelated**, that failure is purely the
empty account.

**Takeaway:** map-then-call in one batch, and dry-run as the mapped origin until
the player exists on chain.

### We let the dashboard sit on an old polkadot-api while adopting a host helper built for the new one.

The dashboard was written against polkadot-api 1.x and worked fine. When we
routed chain access through the host helper (`createPapiProvider`, see Part 3),
the build failed with a type error: `JsonRpcRequest<any>` is not assignable to
`string`. The tempting move is to cast it away and move on.

That would have compiled and then broken at runtime. The host helper ships
**polkadot-api 2.x** provider types, and 2.x changed the JSON-RPC provider
contract to deliver **parsed message objects** where 1.x delivered **strings**.
That's a real wire-format difference, not a cosmetic type annotation — a cast
would have handed parsed objects to code expecting strings.

Fix: align the whole app to papi 2.x (`polkadot-api@^2.1.6`,
`@polkadot-api/sdk-ink@^0.7.0`). One bonus gotcha from the bump: 2.x **removed
the `polkadot-api/ws-provider/*` subpaths**, so the WS provider import moves to
the standalone `@polkadot-api/ws-provider` package.

**Takeaway:** keep one polkadot-api major across every app that shares a host
helper. A type error that straddles a version boundary is usually a runtime bug
wearing a disguise — don't cast across it.

---

## Part 3 — The sandbox: it watches the network and the window

This is where "normal web practice" bites hardest. Outside the host you open
sockets, load fonts from a CDN, and call `window.open` without a second thought.
Inside the sandbox, each of those is a flagged or blocked action.

### We connected straight to the RPC node — and the user got a scary "allow this domain?" prompt.

Every dapp opens a WebSocket to an RPC endpoint. We did the obvious thing and
dialed `wss://paseo-asset-hub-next-rpc.polkadot.io` directly. The host popped a
permission dialog: *"Allow Access to Web Domains?
wss://paseo-asset-hub-next-rpc.polkadot.io."* Asking a player to approve a raw
websocket domain just to see a leaderboard is awful, and it's exactly the kind of
prompt that makes an app feel untrustworthy.

From the sandbox's perspective, your direct socket is an **external-domain
request** like any other — it can't tell "the chain" apart from "some random
server." The host *already has* a chain connection, so the right move is to
**tunnel JSON-RPC through the host** with `createPapiProvider(GENESIS)`.

**This bit us twice, and the second bug is the subtle, important one.** Our first
fix passed a WS fallback as the second arg —
`createPapiProvider(GENESIS, getWsProvider(endpoint))` — copying the
Rock-Paper-Scissors app. The prompt *kept appearing*. Reading the
host-api-wrapper source explained why:

```ts
// createPapiProvider(genesisHash, __fallback)  — __fallback is documented
// "for testing purposes only, should not be used in real production code"
checkIfReady().then((ready) => {
  if (ready)            onResult(hostRoute);      // tunnel through host — no socket
  else if (__fallback)  onResult(__fallback);     // OPENS THE WS → the prompt
  else                  onResult(errorProvider);  // no socket
});
// ready = host is up AND host_feature_supported("Chain", genesisHash) is true
```

So the WS only opens when `checkIfReady()` is **false** — and ours was false
because **the genesis hash was wrong**. We'd hardcoded
`0x173cea9d…067af8` (from RPS), but the live chain's genesis (via
`getChainSpecData()`) is `0xbf0488db…ef19f`. With a genesis the host doesn't
recognize, `host_feature_supported` returns false, the host route is skipped, and
the "testing only" fallback silently dials the RPC — producing the prompt even
though we *thought* we were routing through the host.

The real fix is two parts:
1. **Use the correct genesis** — verify it live with `getChainSpecData()`, don't
   copy a constant from another app (chains get re-genesised; "next" endpoints
   especially).
2. **Don't pass the WS `__fallback` in production.** Inside a host call
   `createPapiProvider(GENESIS)` alone (this is what the canonical
   `getHostProvider` does). Use a direct WS *only* where there is genuinely no
   host — Node (smoke/boot tests) and localhost:

```ts
const directWs =
  typeof window === "undefined" || /^localhost(:\d+)?$/.test(window.location.host);
const provider = directWs ? getWsProvider(endpoint) : createPapiProvider(GENESIS);
```

**Takeaway:** don't open your own socket to the chain from inside the host, and
don't pass the test-only WS fallback — it converts a wrong-genesis (or
host-not-ready) into a silent direct dial and a scary prompt. Verify the genesis
against the live chain; a copied constant that's subtly wrong fails *open* (it
still works, via the fallback) which is why it survived testing.

### We loaded our font from Google Fonts — the same domain prompt, for a font.

The Vite/React starter loads Inter with a `<link>` to `fonts.googleapis.com`.
Totally standard. Inside the host it produced the identical prompt: *"Allow
Access to Web Domains? https://fonts.googleapis.com."* (Our dashboard had a
quieter version of the same sin — it *declared* Inter but never loaded it, so it
silently fell back to a system font and nobody noticed it wasn't actually
rendering the brand typeface.)

The host treats **every** external request the same way, font or not. The fix is
to **bundle everything**: install the font as a package (`@fontsource/inter`) and
`import` the weights in `main.tsx` so Vite emits them locally; delete the
`<link>`. No `<link>`, `<script>`, or `url(https://…)` to a remote host, ever.
One sub-lesson: import only the `latin` subset weights you need —
`@fontsource/inter` otherwise bundles ~7× the files (every language subset) into
every game's deploy.

This is now a hard rule in the template (`game-template/CLAUDE.md` §1.5): an
arcade game must make **zero external network requests**. It keeps the app
self-contained, offline-capable, and prompt-free.

**Takeaway:** bundle fonts, images, scripts, and libraries. An external asset
request isn't just slower — in the host it nags the user and breaks the
self-contained guarantee.

### Our "Play" button used a normal link — and did nothing in the desktop app.

To launch a game from the dashboard we used the web-standard approach: an anchor
with `target="_blank"`. On the web that opens the game. In Polkadot Desktop,
clicking it did *nothing at all*.

Polkadot Desktop runs apps inside an Electron `<webview>` whose
`setWindowOpenHandler` **denies** `window.open` and `target="_blank"` outright (a
sensible security default for an embedded surface). A plain link simply cannot
launch another app there.

The host gives you a proper API for this:
`getTruApi().navigateTo({ tag: "v1", value: url })`. Two things we got wrong on
the first try and want to flag: the payload is a **versioned envelope**
(`{ tag: "v1", value }`), *not* a bare URL string; and you should keep the normal
`href` + `target="_blank"` as the web fallback, only calling `navigateTo` (and
`preventDefault()`-ing the click) when `isInsideContainerSync()` is true. We
confirmed the deny behavior against the actual desktop source in
`../polkadot-desktop` rather than guessing.

**Takeaway:** cross-app navigation inside the host goes through `navigateTo` with
a versioned payload — not the browser's window/link mechanics. Verify host
behavior against the host's own source.

### We subscribed to host state at boot — and got a blank page.

Subscribing to connection/account status on mount is a reasonable React pattern.
But `subscribeAccountConnectionStatus` threw "Environment is not correct" during
boot, the throw was unguarded, and the whole app rendered a blank page.

Host APIs aren't all available in every environment or at every moment in the
lifecycle. The reference apps use a **one-shot** model — request the product
account when you actually need it — rather than subscribing to host state at
startup. We removed the subscription and the boot crash with it.

**Takeaway:** don't subscribe to host state at boot. Fetch on demand and guard;
assume any host call can be unavailable depending on timing/environment.

### We tried to debug a deploy by curling its `.app.dot.li` URL — and got fooled.

When a deployed app looked empty, we did what you'd do for any static site:
`curl` the URL. Curling `<label>.app.dot.li` returned the SPA `index.html`
fallback, which made a perfectly fine deploy look broken.

dot.li isn't a normal static host. It's a **shell** at `<label>.dot.li` plus a
**sandboxed iframe** at `<label>.app.dot.li` whose real content is served by a
**service worker** out of the content-addressed (CID) archive. Curling the iframe
host directly bypasses the service worker and hands you the fallback — a false
negative. (We also learned not to *construct* `.app` URLs ourselves; let the host
do it.)

**Takeaway:** `.app.dot.li` is service-worker territory; a `curl` of it tells you
nothing. Verify a deploy by opening it through the host shell.

---

## Part 4 — Tooling, tests, and the build pipeline

### Our smoke tests were green while the real app was broken.

We had unit tests and Playwright e2e, all passing, against a **fake gateway**.
Meanwhile the live app was failing with `AccountUnmapped`, empty reads, and the
wrong read origin — none of which a fake gateway can catch, because it tests our
logic, not the chain/host contract.

The fix was to add **host-free smoke harnesses that hit the live chain**:
`smoke:read` and the dashboard's `test:smoke` exercise the real read path, and
`test:boot` boots the app against the real gateway. (These run headless, so they
take the direct-WS branch from Part 3 — which is exactly why that branch has to
keep working.)

**Takeaway:** a green fake-gateway suite proves nothing about the chain or the
host. Keep at least one test that talks to the real thing.

### The npm supply-chain guard blocked our own fresh packages.

Installs of just-published `@parity/*` packages were refused. The cause was a
machine-wide `min-release-age=3` in `~/.npmrc` — a good supply-chain guard that
refuses to install packages younger than a few days. The fix is narrow: a
per-package `.npmrc` with `min-release-age=0` in the apps that genuinely need the
latest first-party libraries, leaving the global guard in place for everything
else.

**Takeaway:** keep the global supply-chain guard; override it narrowly, per
trusted package, not globally.

---

## Part 5 — Game template & content (less host-specific, still cost us time)

### A shared thumbnail generator ignored its input and shipped duplicate art.

Flappy Bird and Wordle both went out with the **Snake** thumbnail, because the
generator drew Snake art regardless of which game it was run for. The lesson is
about generated assets generally: verify them **per game**, not per template — a
generator that ignores its input produces convincing-looking duplicates that pass
a casual glance.

### On-screen controls were always on, and on top of the gameplay.

Space Invaders rendered its touch controls over the player's ship and showed them
even for keyboard players. Fix: gate on-screen controls to touch input and keep
them in corner clusters, clear of the play area. (The template now owns the game
*surface* so individual games can't fight the layout.)

### Parallel builds and same-account deploys race each other.

Building several games concurrently let agents clobber each other's working tree,
and firing multiple deploys from one dev seed risked nonce races. Fix: run
parallel builds in **isolated git worktrees**, and serialize (or nonce-handle)
deploys that share a signer.

### Name resolution rejected into the UI; the contract pointer was a scaffold default.

Two smaller ones worth recording: the DotNS reverse resolver could reject as an
unhandled promise, so we made `resolveName` **fail closed** (fall back to a
truncated address, never throw into render). And `cdm.json` still pointed at a
placeholder contract (`@example/arcade-playground`) instead of the deployed
`@arcade` one — confirm the deploy pipeline wrote the real address, don't trust
the scaffold default.

---

## The short version — a checklist for your next host app

Most of these are just "don't do the normal web/dapp thing here":

- **Identity** is one host-assigned *product account*, not the user's wallet; its
  ID is `<label>.dot`, not `window.location.host`.
- Product accounts start **empty**, and the host sponsors **fees but not storage
  deposits** — plan a faucet/funding step (subdomains won't share an account).
- Contract **reads need a mapped origin** — use the pallet account
  `5EYCAe…`, defined once; don't read as a random address or `//Alice`.
- **Map + call in one `batch_all`**; dry-run as the mapped origin until the
  player exists.
- **Don't open your own socket to the chain** — tunnel via
  `createPapiProvider(genesis)` (NO ws fallback — it's test-only and dials the
  socket); direct WS only headless/localhost. Verify the genesis live with
  `getChainSpecData()`; a wrong genesis fails open via the fallback → prompt.
- **Zero external requests** — bundle fonts/assets/libs (latin subset only); no
  `<link>`/`<script>`/`url(https://…)`.
- **Cross-app links** go through `navigateTo({tag:"v1", value})`, with a web
  fallback, only when inside a container.
- **No host subscriptions at boot** — fetch on demand and guard.
- Keep **one polkadot-api major** across apps that share host helpers; never cast
  across a version boundary.
- Have a smoke test that hits the **live chain**, not just the fake gateway.
- Don't trust a `curl` of `.app.dot.li`; verify through the host shell.
