/**
 * Contract every game in this template must implement.
 *
 * A game is a self-contained React component that knows nothing about how
 * scores are stored. When the game ends, it calls onGameEnd once with the
 * final score.
 *
 * To add a new game:
 *   1. Create a component that accepts GameComponentProps
 *   2. Call onGameEnd(score) exactly once when the game ends
 *   3. Swap it in App.tsx
 */
export interface GameComponentProps {
  onGameEnd: (score: number) => void;
}
