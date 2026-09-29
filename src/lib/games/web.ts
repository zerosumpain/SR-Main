// What the web lobby at /games can play. Client-safe: the page reads it to
// decide between "Open" and "Open in the app", the API to refuse starting
// anything else from a browser.
import type { GameId } from './catalogue';

export const WEB_GAMES: readonly GameId[] = ['liars-dice'];

export function playableOnWeb(game: string): boolean {
  return (WEB_GAMES as readonly string[]).includes(game);
}

/** Display names for the lobby, including games only the app plays. */
export const GAME_NAMES: Record<GameId, string> = {
  'tap-duel': 'Tap Duel',
  'wordle-race': 'Wordle Race',
  'quiz-night': 'Quiz Night',
  'anagram-blitz': 'Anagram Blitz',
  'maths-sprint': 'Maths Sprint',
  'sequence-memory': 'Sequence Memory',
  boggle: 'Boggle',
  categories: 'Categories',
  'liars-dice': "Liar's Dice",
  'draw-guess': 'Draw & Guess',
};
