# AGENTS.md

Agent instructions for this template live in **[`CLAUDE.md`](CLAUDE.md)** — it
is the single source of truth for any AI agent (Claude or otherwise) asked to:

> *"Edit the game template for the &lt;X&gt; game and deploy it to the arcade."*

Read `CLAUDE.md` top to bottom before editing. In short, it covers:

- **The one seam** — a game is a React component implementing
  `onGameEnd(score)`, called exactly once per match (`src/games/types.ts`).
- **`arcade.config.json`** — the single source of truth for every listing field
  and contract-constructor argument (incl. `scoreOrdering`/`scoreFormat`/
  `scoreUnit` semantics).
- **The deploy pipeline in exact order** —
  `arcade:deploy-contract` → `arcade:upload-thumbnail` →
  `playground deploy --signer <dev|phone> --domain <domain> --buildDir dist
  --playground` → `arcade:register` → `arcade:verify` (or one-shot
  `arcade:ship`).
- **Prerequisite:** `playground init` (the one human step) — never work around a
  missing session.
- **Common failure modes + fixes**, the §4/§5 interface contracts, and **what
  not to touch** (the scoreboard layer and the pipeline library).
