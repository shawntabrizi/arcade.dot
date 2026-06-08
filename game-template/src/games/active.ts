// The one swap point for the active game.
//
// To ship a different game, point this re-export at your component (and update
// ACTIVE_GAME_TITLE). App.tsx imports `ActiveGame` from here and renders it into
// the shell-provided game surface — you do not edit App.tsx for a game swap.
//
// The component must implement GameComponentProps (src/games/types.ts):
// render only gameplay into the surface, never import from scoreboard/ or App,
// and call onGameEnd(integer ≥ 0) exactly once per match.
//
// Two reference games ship in the template:
//   - snake/SnakeGame      — keyboard + swipe, canvas, higher-is-better, points
//   - aim-trainer/AimTrainer — tap (DOM/pointer), lower-is-better, duration (ms)
export { SnakeGame as ActiveGame } from "./snake/SnakeGame";
export const ACTIVE_GAME_TITLE = "Snake";
