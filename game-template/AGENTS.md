# AGENTS.md

Agent instructions for this template live in **[`CLAUDE.md`](CLAUDE.md)** — it
is the single source of truth for any AI agent (Claude or otherwise) asked to:

> *"Build &lt;X&gt; as a new game in this template and deploy it to the arcade."*

You build **any** single-player game; chain, identity, signing, and styling are
imposed by the template. Read `CLAUDE.md` top to bottom before editing. In
short, it covers:

- **The one seam** — a game is a React component implementing
  `onGameEnd(score)` (non-negative integer, exactly once per match,
  `src/games/types.ts`), rendering only gameplay into the shell-provided
  surface.
- **The one swap point** — point `src/games/active.ts` at your component
  (`ActiveGame` + `ACTIVE_GAME_TITLE`); `App.tsx` needs no edit for a swap.
- **Two reference games** — `snake/SnakeGame` (keyboard+swipe / canvas /
  higher-is-better) and `aim-trainer/AimTrainer` (tap / DOM / lower-is-better,
  ms). Copy whichever shape matches.
- **Styling is imposed** — the 2:3 portrait surface, mobile/desktop layout, tab
  bar, and save sheet are provided; don't restyle the shell or tokens.
- **`arcade.config.json`** — the single source of truth for every listing field
  and contract-constructor argument, with a score-semantics decision table
  (genre → `scoreOrdering`/`scoreFormat`/`scoreUnit`).
- **The deploy pipeline in exact order** —
  `arcade:deploy-contract` → `arcade:upload-thumbnail` →
  `playground deploy --signer <dev|phone> --domain <domain> --buildDir dist
  --playground` → `arcade:register` → `arcade:verify` (or one-shot
  `arcade:ship`).
- **Prerequisite:** `playground init` (the one human step) — never work around a
  missing session.
- **Common failure modes + fixes**, the §4/§5 interface contracts, and **what
  not to touch** (the scoreboard layer and the pipeline library).
