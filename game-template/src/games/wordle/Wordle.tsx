import { useCallback, useEffect, useRef, useState } from "react";
import type { GameComponentProps } from "../types";
import { VALID_WORDS } from "./wordlist";
import "./wordle.css";

// Wordle — guess a hidden 5-letter word in up to 6 tries, with per-letter color
// feedback (correct / present / absent). Like every template game it renders
// ONLY gameplay into the shell-provided surface (fills 100% of its parent),
// imports nothing from scoreboard/ or App, and calls onGameEnd EXACTLY ONCE per
// match (guarded by hasEndedRef).
//
// SCORE MODEL: lower-is-better = number of guesses used (1-6). On a loss we
// submit 7 (worse than any win). arcade.config.json sets contract.scoreOrdering
// = 1, scoreFormat = 2, scoreUnit = "guesses".

const WORD_LENGTH = 5;
const MAX_GUESSES = 6;

// Curated list of common 5-letter words the ANSWER is picked from, so every
// answer is a familiar word. Guesses are validated against the much larger
// bundled dictionary (wordlist.ts, ~8.5k words) UNION these answers — real words
// like "hello" pass; nonsense is rejected. Everything is inline (no network dep).
const WORDS: string[] = [
  "about", "above", "abuse", "actor", "acute", "admit", "adopt", "adult", "after", "again",
  "agent", "agree", "ahead", "alarm", "album", "alert", "alike", "alive", "allow", "alone",
  "along", "alter", "among", "anger", "angle", "angry", "apart", "apple", "apply", "arena",
  "argue", "arise", "array", "aside", "asset", "audio", "audit", "avoid", "award", "aware",
  "badly", "baker", "bases", "basic", "beach", "began", "begin", "being", "below", "bench",
  "billy", "birth", "black", "blame", "blind", "block", "blood", "board", "boost", "booth",
  "bound", "brain", "brand", "bread", "break", "breed", "brief", "bring", "broad", "broke",
  "brown", "build", "built", "buyer", "cable", "calif", "carry", "catch", "cause", "chain",
  "chair", "chart", "chase", "cheap", "check", "chest", "chief", "child", "china", "chose",
  "civil", "claim", "class", "clean", "clear", "click", "clock", "close", "coach", "coast",
  "could", "count", "court", "cover", "craft", "crash", "cream", "crime", "cross", "crowd",
  "crown", "curve", "cycle", "daily", "dance", "dated", "dealt", "death", "depth", "doing",
  "doubt", "dozen", "draft", "drama", "drawn", "dream", "dress", "drill", "drink", "drive",
  "drove", "dying", "eager", "early", "earth", "eight", "elite", "empty", "enemy", "enjoy",
  "enter", "entry", "equal", "error", "event", "every", "exact", "exist", "extra", "faith",
  "false", "fault", "fiber", "field", "fifth", "fifty", "fight", "final", "first", "fixed",
  "flash", "fleet", "floor", "fluid", "focus", "force", "forth", "forty", "forum", "found",
  "frame", "frank", "fraud", "fresh", "front", "fruit", "fully", "funny", "giant", "given",
  "glass", "globe", "going", "grace", "grade", "grand", "grant", "grass", "great", "green",
  "gross", "group", "grown", "guard", "guess", "guest", "guide", "happy", "harry", "heart",
  "heavy", "hence", "horse", "hotel", "house", "human", "ideal", "image", "index", "inner",
  "input", "issue", "japan", "jimmy", "joint", "jones", "judge", "known", "label", "large",
  "laser", "later", "laugh", "layer", "learn", "lease", "least", "leave", "legal", "level",
  "light", "limit", "links", "lives", "local", "logic", "loose", "lower", "lucky", "lunch",
  "magic", "major", "maker", "march", "match", "maybe", "mayor", "meant", "media", "metal",
  "might", "minor", "minus", "mixed", "model", "money", "month", "moral", "motor", "mount",
  "mouse", "mouth", "movie", "music", "needs", "never", "newly", "night", "noise", "north",
  "noted", "novel", "nurse", "occur", "ocean", "offer", "often", "order", "other", "ought",
  "paint", "panel", "paper", "party", "peace", "phase", "phone", "photo", "piece", "pilot",
  "pitch", "place", "plain", "plane", "plant", "plate", "point", "pound", "power", "press",
  "price", "pride", "prime", "print", "prior", "prize", "proof", "proud", "prove", "queen",
  "quick", "quiet", "quite", "radio", "raise", "range", "rapid", "ratio", "reach", "ready",
  "refer", "right", "rival", "river", "robin", "roger", "roman", "rough", "round", "route",
  "royal", "rural", "scale", "scene", "scope", "score", "sense", "serve", "seven", "shall",
  "shape", "share", "sharp", "sheet", "shelf", "shell", "shift", "shirt", "shock", "shoot",
  "short", "shown", "sight", "since", "sixth", "sixty", "sized", "skill", "sleep", "slide",
  "small", "smart", "smile", "smith", "smoke", "solid", "solve", "sorry", "sound", "south",
  "space", "spare", "speak", "speed", "spend", "spent", "split", "spoke", "sport", "staff",
  "stage", "stake", "stand", "start", "state", "steam", "steel", "stick", "still", "stock",
  "stone", "stood", "store", "storm", "story", "strip", "stuck", "study", "stuff", "style",
  "sugar", "suite", "super", "sweet", "table", "taken", "taste", "taxes", "teach", "teeth",
  "terry", "texas", "thank", "theft", "their", "theme", "there", "these", "thick", "thing",
  "think", "third", "those", "three", "threw", "throw", "tight", "times", "tired", "title",
  "today", "topic", "total", "touch", "tough", "tower", "track", "trade", "train", "treat",
  "trend", "trial", "tried", "tries", "truck", "truly", "trust", "truth", "twice", "under",
  "undue", "union", "unity", "until", "upper", "upset", "urban", "usage", "usual", "valid",
  "value", "video", "virus", "visit", "vital", "voice", "waste", "watch", "water", "wheel",
  "where", "which", "while", "white", "whole", "whose", "woman", "women", "world", "worry",
  "worse", "worst", "worth", "would", "wound", "write", "wrong", "wrote", "yield", "young",
  "youth",
];

type LetterState = "correct" | "present" | "absent";

// Score a guess against the answer using standard Wordle rules (duplicate
// letters handled: greens first, then yellows limited by remaining counts).
function scoreGuess(guess: string, answer: string): LetterState[] {
  const result: LetterState[] = new Array(WORD_LENGTH).fill("absent");
  const counts: Record<string, number> = {};
  for (const ch of answer) counts[ch] = (counts[ch] ?? 0) + 1;
  // First pass: greens.
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "correct";
      counts[guess[i]]--;
    }
  }
  // Second pass: yellows, limited by remaining counts.
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === "correct") continue;
    const ch = guess[i];
    if (counts[ch] > 0) {
      result[i] = "present";
      counts[ch]--;
    }
  }
  return result;
}

// Accepted guesses: the bundled dictionary plus every answer word (so an answer
// is always a legal guess even if it's not in the dictionary list).
const VALID = new Set([...VALID_WORDS, ...WORDS]);

function pickAnswer(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

const KEY_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["enter", "z", "x", "c", "v", "b", "n", "m", "back"],
];

interface Submitted {
  word: string;
  states: LetterState[];
}

export function Wordle({ onGameEnd }: GameComponentProps) {
  const [answer, setAnswer] = useState<string>(pickAnswer);
  const [guesses, setGuesses] = useState<Submitted[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  // SPEC §10.4: onGameEnd fires once per match. This flag is the guard.
  const hasEndedRef = useRef(false);

  function newGame() {
    setAnswer(pickAnswer());
    setGuesses([]);
    setCurrent("");
    setMessage("");
    setStatus("playing");
    hasEndedRef.current = false;
  }

  // Aggregate best-known state per letter for keyboard coloring (correct beats
  // present beats absent).
  const keyState: Record<string, LetterState> = {};
  for (const g of guesses) {
    for (let i = 0; i < WORD_LENGTH; i++) {
      const ch = g.word[i];
      const s = g.states[i];
      const prev = keyState[ch];
      if (s === "correct" || (s === "present" && prev !== "correct") || (!prev && s === "absent")) {
        keyState[ch] = s;
      }
    }
  }

  // No side effects inside a setState updater — React StrictMode invokes
  // updaters twice for purity-checking, which would double-submit guesses and
  // fire onGameEnd twice. Read current state from refs, compute, then commit.
  const currentRef = useRef(current);
  currentRef.current = current;
  const guessesRef = useRef(guesses);
  guessesRef.current = guesses;
  const statusRef = useRef(status);
  statusRef.current = status;

  const submitCurrent = useCallback(() => {
    if (statusRef.current !== "playing") return;
    const cur = currentRef.current;
    if (cur.length !== WORD_LENGTH) {
      setMessage("Not enough letters");
      return;
    }
    if (!VALID.has(cur)) {
      setMessage("Not in word list");
      return;
    }
    setMessage("");
    const states = scoreGuess(cur, answer);
    const next = [...guessesRef.current, { word: cur, states }];
    const guessesUsed = next.length;
    setGuesses(next);
    setCurrent("");
    if (cur === answer) {
      setStatus("won");
      if (!hasEndedRef.current) {
        hasEndedRef.current = true;
        // Lower is better: number of guesses used (1-6).
        onGameEnd(Math.max(0, Math.round(guessesUsed)));
      }
    } else if (guessesUsed >= MAX_GUESSES) {
      setStatus("lost");
      if (!hasEndedRef.current) {
        hasEndedRef.current = true;
        // Loss submits 7 — worse than any win (max 6 guesses).
        onGameEnd(MAX_GUESSES + 1);
      }
    }
  }, [answer, onGameEnd]);

  const handleKey = useCallback(
    (key: string) => {
      if (status !== "playing") return;
      if (key === "enter") {
        submitCurrent();
      } else if (key === "back") {
        setCurrent((c) => c.slice(0, -1));
      } else if (/^[a-z]$/.test(key)) {
        setCurrent((c) => (c.length < WORD_LENGTH ? c + key : c));
      }
    },
    [status, submitCurrent],
  );

  // Physical keyboard support.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "enter") {
        e.preventDefault();
        handleKey("enter");
      } else if (k === "backspace") {
        e.preventDefault();
        handleKey("back");
      } else if (/^[a-z]$/.test(k)) {
        handleKey(k);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleKey]);

  // Build the 6 rows: submitted guesses, then current input, then empties.
  const rows: { letters: string[]; states: (LetterState | "filled" | "empty")[] }[] = [];
  for (let r = 0; r < MAX_GUESSES; r++) {
    if (r < guesses.length) {
      const g = guesses[r];
      rows.push({ letters: g.word.split(""), states: g.states });
    } else if (r === guesses.length && status === "playing") {
      const letters = current.split("");
      const cells: string[] = [];
      const states: (LetterState | "filled" | "empty")[] = [];
      for (let i = 0; i < WORD_LENGTH; i++) {
        if (i < letters.length) {
          cells.push(letters[i]);
          states.push("filled");
        } else {
          cells.push("");
          states.push("empty");
        }
      }
      rows.push({ letters: cells, states });
    } else {
      rows.push({ letters: ["", "", "", "", ""], states: ["empty", "empty", "empty", "empty", "empty"] });
    }
  }

  return (
    <div className="wordle-root">
      <div className="wordle-title">Wordle</div>
      <div className="wordle-message">{message}</div>

      <div className="wordle-board">
        {rows.map((row, ri) => (
          <div className="wordle-row" key={ri}>
            {row.letters.map((ch, ci) => (
              <div className={`wordle-tile ${row.states[ci]}`} key={ci}>
                {ch}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="wordle-keyboard">
        {KEY_ROWS.map((krow, ri) => (
          <div className="wordle-krow" key={ri}>
            {krow.map((key) => {
              const wide = key === "enter" || key === "back";
              const label = key === "back" ? "⌫" : key === "enter" ? "Enter" : key;
              const cls = !wide && keyState[key] ? keyState[key] : "";
              return (
                <button
                  type="button"
                  key={key}
                  className={`wordle-key ${wide ? "wide" : ""} ${cls}`}
                  onClick={() => handleKey(key)}
                  aria-label={key === "back" ? "Backspace" : key}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {status !== "playing" && (
        <div className="wordle-overlay">
          <p className="wordle-overlay-title">{status === "won" ? "Solved!" : "Out of guesses"}</p>
          {status === "won" ? (
            <p className="wordle-overlay-sub">
              {guesses.length} {guesses.length === 1 ? "guess" : "guesses"}
            </p>
          ) : (
            <p className="wordle-overlay-sub">
              The word was <span className="wordle-overlay-answer">{answer}</span>
            </p>
          )}
          <button type="button" className="wordle-button" onClick={newGame}>
            Play again
          </button>
        </div>
      )}
    </div>
  );
}
