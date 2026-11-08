// The Kelly frame: what makes a game at the TV feel like John built it for
// the family — the sting, the host's lines, the places, the themed words.
//
// No family member's name is written here. SR-Main is a public repository,
// so first names come from the members list at runtime (the TV page reads
// them); this file holds only what anybody may read: the town, the river,
// the railway, the kitchen.

/** The line every game at the TV opens with. */
export const STING = 'Made by John for the Kellys';

/** Places a game may mention: home turf, all public. */
export const PLACES = ['Darlington', 'the Tees', 'the Stockton & Darlington', 'South Park', 'the Dolphin Centre', 'Teesside', 'Durham', 'Whitby'] as const;

/**
 * Words with a Kelly flavour — trains (Darlington is where the railway
 * began), tea, biscuits and the river — for Boggle's word of the round.
 * Lower case, all in the word list.
 */
export const KELLY_WORDS: readonly string[] = [
  'train', 'rail', 'rails', 'track', 'steam', 'engine', 'coal', 'bridge', 'river', 'quaker',
  'tea', 'teas', 'kettle', 'mug', 'mugs', 'biscuit', 'scone', 'cake', 'toast', 'jam',
  'dog', 'dogs', 'home', 'park', 'town', 'tees', 'mum', 'dad', 'nan', 'gran', 'kids',
  'game', 'games', 'quiz', 'chips', 'pie', 'rain', 'wet', 'cold', 'boots', 'walk',
  'bus', 'car', 'road', 'map', 'line', 'stop', 'stone', 'brick', 'mill', 'iron',
];

/** What the host says, by moment. `{name}` is a player's name, filled at the TV. */
export const HOST_LINES = {
  lobby: [
    'Grab a phone, scan the code, and we will get going.',
    'Kettle on? Good. Scan the code.',
    'Right then — who is playing?',
  ],
  start: ['Here we go.', 'Phones at the ready.', 'No peeking at each other’s screens.'],
  winner: ['{name} takes it. Well played.', 'And the winner is {name}.', '{name} wins — the rest of you, rematch?'],
  draw: ['A dead heat. Go again?', 'Nothing between you. Another round?'],
  nobody: ['Nobody scored. A quiet one — go again?', 'Not a point between you. Another round?'],
} as const;

/** One line of `kind`, chosen by `seed` so the TV and a phone pick the same. */
export function hostLine(kind: keyof typeof HOST_LINES, seed: number, name = ''): string {
  const lines = HOST_LINES[kind];
  const line = lines[Math.abs(Math.floor(seed)) % lines.length];
  return line.replace('{name}', name);
}
