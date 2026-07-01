// About page (SPEC §1 / §3–§7, told for humans). A characterful, semi-technical
// explainer of what the Arcade is, the one-prompt template, the contract split,
// and how games report to this dashboard. Deep details defer to the source.

import { homeHref } from "../router";

// Source links resolve against the repo's default branch (HEAD) so they don't
// rot when the branch changes. External → opens in the system browser in-host.
const REPO = "https://github.com/shawntabrizi/arcade-dashboard";
const src = (path: string) => `${REPO}/blob/HEAD/${path}`;

function Src({ path, children }: { path: string; children?: React.ReactNode }) {
  return (
    <a className="link" href={src(path)} target="_blank" rel="noopener">
      {children ?? path} ↗
    </a>
  );
}

export function About() {
  return (
    <article className="about">
      <a className="link about__back" href={homeHref()}>
        ← Back to the arcade
      </a>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="about__hero">
        <div className="about__coin">🪙</div>
        <h1 className="about__title">Insert coin.</h1>
        <p className="about__lede">
          The Polkadot Arcade is a <strong>permissionless</strong> cabinet hall for on-chain games.
          Anyone can wheel in a new machine; nobody runs the floor. This dashboard is just the
          glass at the front — it reads every game&rsquo;s stats <em>live from its own smart
          contract</em>. No backend, no database, no &ldquo;trust me.&rdquo; If a high score is on
          the board, it&rsquo;s on-chain.
        </p>
      </header>

      <div className="about__grid">
        {/* ── One prompt → one game ──────────────────────────────────────── */}
        <section className="about__card">
          <h2 className="about__h2">
            <span className="about__emoji">👾</span> One prompt, one game
          </h2>
          <p>
            Every machine here is born from a single sentence. You point an AI agent at the{" "}
            <strong>game template</strong> and say something like:
          </p>
          <blockquote className="about__quote">
            &ldquo;Build Tetris as a new game in this template and deploy it to the arcade.&rdquo;
          </blockquote>
          <p>
            The template already handles the critical 80% — and makes it simple and fast:
            wallet/identity, signing, score-saving, the leaderboard, the mobile layout, the
            &ldquo;back to arcade&rdquo; button. The builder writes <em>only the gameplay</em> — one
            React component that calls <code>onGameEnd(score)</code> when a round ends. Chain,
            styling, and plumbing come built-in, so it just works. Swap the active game in one line
            and ship.
          </p>
          <p className="about__src">
            Peek inside: <Src path="game-template/CLAUDE.md">the agent runbook</Src> ·{" "}
            <Src path="game-template/src/games">the game components</Src>
          </p>
        </section>

        {/* ── The cabinet wiring (contracts) ─────────────────────────────── */}
        <section className="about__card">
          <h2 className="about__h2">
            <span className="about__emoji">🔌</span> How the cabinet is wired
          </h2>
          <p>
            Instead of one giant contract trying to do everything, the design splits into small,
            simple, swappable parts — each does one job well — like a real arcade cabinet: a coin
            mech here, a score display there.
          </p>
          <ul className="about__list">
            <li>
              <strong>The Registry</strong> — the hall&rsquo;s directory. A game registers itself
              (permissionlessly) and the registry remembers &ldquo;this contract is a game, here&rsquo;s
              where to find its listing.&rdquo; House rule: <em>the caller is the game</em> — only a
              contract can list itself, so nobody can squat someone else&rsquo;s slot.
            </li>
            <li>
              <strong>The Game Contract Standard (GCS)</strong> — the shape every machine speaks, so
              one dashboard can read all of them. It comes in modules:
              <ul className="about__sublist">
                <li>
                  <span className="about__tag">Module A · Activity</span> who played, how many plays,
                  recent rounds — the &ldquo;attract mode&rdquo; ticker.
                </li>
                <li>
                  <span className="about__tag">Module B · Leaderboard</span> the high-score table:
                  personal bests, sorted top-10, higher-<em>or</em>-lower-is-better.
                </li>
              </ul>
            </li>
          </ul>
          <p>
            A game just has to <em>speak GCS</em>. Most builders deploy the reference contract
            as-is and never think about it again.
          </p>
          <p className="about__src">
            Read the wiring: <Src path="SPEC.md">the full spec</Src> ·{" "}
            <Src path="contracts/gcs-reference">GCS reference contract</Src> ·{" "}
            <Src path="contracts/registry">registry contract</Src>
          </p>
        </section>

        {/* ── How games phone home ───────────────────────────────────────── */}
        <section className="about__card">
          <h2 className="about__h2">
            <span className="about__emoji">📟</span> How games phone home
          </h2>
          <p>This dashboard does three reads, all straight from the chain — no middleman:</p>
          <ol className="about__steps">
            <li>
              <span className="about__num">1</span> Ask the <strong>registry</strong> for the list of
              games.
            </li>
            <li>
              <span className="about__num">2</span> Ask each <strong>game contract</strong> for its
              live stats (plays, best block, leaderboard).
            </li>
            <li>
              <span className="about__num">3</span> Render. On every new block we re-read only what
              you can see — no indexer, no cron, no &ldquo;data team.&rdquo;
            </li>
          </ol>
          <p>
            When you finish a round in a game and hit <em>Submit best score</em>, the game writes
            straight to its own contract. Next block, it shows up here. That&rsquo;s the whole loop.
          </p>
          <p className="about__src">
            See the reader: <Src path="dashboard/src/chain-reads.ts">chain-reads.ts</Src>
          </p>
        </section>

        {/* ── Why bother ─────────────────────────────────────────────────── */}
        <section className="about__card">
          <h2 className="about__h2">
            <span className="about__emoji">🏆</span> Why build it this way
          </h2>
          <p>
            The whole thing optimizes for five words: <strong>simple, easy, fast, fun,
            effective</strong>. In practice that means:
          </p>
          <ul className="about__list">
            <li>
              <strong>Simple &amp; easy.</strong> One prompt, one gameplay component, one line to
              swap the active game. The template handles the rest.
            </li>
            <li>
              <strong>Fast.</strong> A working, styled, on-chain game is a single good sentence away
              — minutes, not weeks of plumbing.
            </li>
            <li>
              <strong>Fun.</strong> Builders ship actual games; players get real high scores to
              chase. The chain is the scoreboard, not the homework.
            </li>
            <li>
              <strong>Effective &amp; permissionless.</strong> No gatekeeper approves your game, and
              the dashboard can only show what the contracts actually hold — so scores can&rsquo;t be
              faked in a spreadsheet. Deploy a conforming contract, register, and you&rsquo;re on the
              floor.
            </li>
          </ul>
          <p className="about__src">
            Curious how it&rsquo;s actually hosted &amp; signed? The hard-won lessons live in{" "}
            <Src path="GOTCHAS.md">GOTCHAS.md</Src>.
          </p>
        </section>
      </div>

      <footer className="about__footer muted">
        Built on Polkadot · Paseo Asset Hub · contracts via pallet-revive. The whole thing is open
        source — <Src path="">browse the repo</Src> and wheel in your own machine. 🕹️
      </footer>
    </article>
  );
}
