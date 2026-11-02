// sr. tv's marks: the iPhone app's pixel "SR" and a pixel icon per tile,
// drawn on the same kind of grid (`#` is a cell), and the Prism hues each
// tile wears. The SR grid and the icon's four-corner ground are copied from
// SR-AppleApp scripts/app-icons.py (MARK, ICONS.prism) — change one, change
// both. Hues are Prism's per-feature pairs (Design/SRPalette.swift), base
// then glow.

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
  tasks: { base: '#FFB800', glow: '#FFE14D' },
  chat: { base: '#3B4BF5', glow: '#6E8BFF' },
  alerts: { base: '#DC2626', glow: '#FB923C' },
  trips: { base: '#1E63E9', glow: '#2EC5FF' },
  move: { base: '#E11D74', glow: '#FF5FA2' },
  steps: { base: '#E85D00', glow: '#FF9E2C' },
  health: { base: '#0E9F5A', glow: '#3DDC84' },
  family: { base: '#E62E5C', glow: '#FF7A59' },
  daydream: { base: '#9333EA', glow: '#F472B6' },
  messages: { base: '#0B8A7A', glow: '#2DD4BF' },
  news: { base: '#0E7490', glow: '#22C3DD' },
  flows: { base: '#4338CA', glow: '#38BDF8' },
  games: { base: '#7C3AED', glow: '#C026D3' },
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
