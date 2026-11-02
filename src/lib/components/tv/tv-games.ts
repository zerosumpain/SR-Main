// What the TV says about each party game, and the choices its lobby offers
// before Start. Values are what the game's own `createRoom` reads from its
// options (Boggle: `size`, `seconds`, and the `difficulty` every game takes).

export interface TvOption {
  key: string;
  label: string;
  fallback: string | number;
  choices: { value: string | number; label: string }[];
}

const DIFFICULTY: TvOption = {
  key: 'difficulty',
  label: 'Difficulty',
  fallback: 'medium',
  choices: [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
  ],
};

export const GAME_OPTIONS: Record<string, TvOption[]> = {
  boggle: [
    {
      key: 'size',
      label: 'Board',
      fallback: 4,
      choices: [
        { value: 4, label: '4 × 4' },
        { value: 5, label: '5 × 5' },
        { value: 6, label: '6 × 6' },
      ],
    },
    {
      key: 'seconds',
      label: 'Time',
      fallback: 120,
      choices: [
        { value: 90, label: '90 s' },
        { value: 120, label: '2 min' },
        { value: 180, label: '3 min' },
      ],
    },
    DIFFICULTY,
  ],
};

export const GAME_BLURBS: Record<string, string> = {
  boggle: 'Trace words on your phone through touching letters. Find the Kelly word for double.',
};

/** A game's lobby options before anybody changes them. */
export function defaultOptions(game: string): Record<string, string | number> {
  return Object.fromEntries((GAME_OPTIONS[game] ?? []).map((o) => [o.key, o.fallback]));
}
