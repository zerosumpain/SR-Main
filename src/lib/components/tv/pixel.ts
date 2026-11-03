// sr. tv's marks: the iPhone app's pixel "SR" and a pixel icon per tile,
// drawn on the same kind of grid (`#` is a cell), and the hue each tile
// wears. The SR grid and the icon's four-corner ground are copied from
// SR-AppleApp scripts/app-icons.py (MARK, ICONS.prism) — change one, change
// both. The tiles' hues are the site's warm family (burnt orange, teal, gold,
// brick, olive) rather than Prism's, so they sit on the browns and creams;
// base then glow.

export type Grid = readonly string[];

/** The app icon's mark: S in columns 0-4, R in 6-10. */
export const SR_MARK: Grid = [
  '#####.####.',
  '#.....#...#',
  '#.....#...#',
  '#####.####.',
  '....#.#.#..',
  '....#.#..#.',
  '#####.#...#',
];

/** Prism's icon ground, corner by corner: top-left, top-right, bottom-left, bottom-right. */
export const PRISM_GROUND = ['#FF7A59', '#F472B6', '#7C3AED', '#3B4BF5'] as const;

export interface Hue {
  base: string;
  glow: string;
}

const HUES = {
  tasks: { base: '#B8862B', glow: '#E2B54F' },
  chat: { base: '#35505A', glow: '#5E8A94' },
  alerts: { base: '#9E3B2A', glow: '#E06A4A' },
  trips: { base: '#2C6E78', glow: '#3FA3B0' },
  move: { base: '#8E3B4E', glow: '#C9667A' },
  steps: { base: '#B45A12', glow: '#E07B2A' },
  health: { base: '#5E6B33', glow: '#8A9A5B' },
  family: { base: '#A4472C', glow: '#E07B5A' },
  daydream: { base: '#5B3A5E', glow: '#9A6A8E' },
  messages: { base: '#1F5E5A', glow: '#4C9A8E' },
  news: { base: '#8A6A2A', glow: '#C9A04A' },
  flows: { base: '#5A4632', glow: '#9A7B58' },
  games: { base: '#7A4A22', glow: '#C47A3A' },
} satisfies Record<string, Hue>;

export interface TileArt {
  grid: Grid;
  hue: Hue;
}

/** One tile's art by id: every party game, then the menu's other tiles. */
export const TILE_ART: Record<string, TileArt> = {
  boggle: {
    hue: HUES.tasks,
    grid: ['.#######.', '#.......#', '#.#...#.#', '#.#..#..#', '#.###...#', '#.#..#..#', '#.#...#.#', '#.......#', '.#######.'],
  },
  azul: {
    hue: HUES.trips,
    grid: ['##.##.##', '##.##.##', '........', '##....##', '##....##', '........', '##.##.##', '##.##.##'],
  },
  'quiz-night': {
    hue: HUES.chat,
    grid: ['..#####..', '.##...##.', '.##...##.', '.....##..', '....##...', '....##...', '.........', '....##...', '....##...'],
  },
  codenames: {
    hue: HUES.alerts,
    grid: ['.........', '...###...', '.##...##.', '#...#...#', '#..###..#', '#...#...#', '.##...##.', '...###...', '.........'],
  },
  'snap-happy': {
    hue: HUES.move,
    grid: ['.....###.', '....###..', '...###...', '..#######', '.....###.', '....###..', '...###...', '..##.....', '.#.......'],
  },
  'biscuit-tower': {
    hue: HUES.steps,
    grid: ['...###...', '..#####..', '.........', '.#######.', '.#######.', '.........', '#########', '#########'],
  },
  'iron-roads': {
    hue: HUES.health,
    grid: ['......###', '##....#.#', '##....#.#', '#########', '#########', '#########', '.##.##.##'],
  },
  kelly: {
    hue: HUES.family,
    grid: ['.##...##.', '#########', '#########', '#########', '.#######.', '..#####..', '...###...', '....#....'],
  },
  marbler: {
    hue: HUES.daydream,
    grid: ['...###...', '.#######.', '.##..####', '###..####', '#########', '#########', '.#######.', '...###...'],
  },
  backlog: {
    hue: HUES.messages,
    grid: ['#########', '#.......#', '#..#....#', '#..###..#', '#..####.#', '#..###..#', '#..#....#', '#.......#', '#########'],
  },
  projects: {
    hue: HUES.news,
    grid: ['#########', '#.#.#...#', '#########', '#.......#', '#.###.#.#', '#.......#', '#.###.#.#', '#.......#', '#########'],
  },
  about: {
    hue: HUES.flows,
    grid: ['...##...', '...##...', '........', '..###...', '...##...', '...##...', '...##...', '..####..'],
  },
};

/** Art for an id the table above does not know (a game added later). */
export const FALLBACK_ART: TileArt = { hue: HUES.games, grid: SR_MARK };

export function artFor(id: string): TileArt {
  return TILE_ART[id] ?? FALLBACK_ART;
}

/** The filled cells of a grid as [column, row] pairs. PURE. */
export function cells(grid: Grid): [number, number][] {
  const out: [number, number][] = [];
  grid.forEach((row, y) => [...row].forEach((c, x) => c === '#' && out.push([x, y])));
  return out;
}
