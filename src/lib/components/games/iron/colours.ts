// Iron Roads' paint box: the card colours as they are drawn on ink, and the
// five player colours. The player colours are chosen to sit apart from the
// card colours and from the categorical `--fs-cat-*` hues; a claimed route is
// also drawn differently (solid, with an edge), so it never reads as unclaimed.

import type { Card } from '$lib/games/iron-roads';
import type { RouteColour } from '$lib/games/iron-roads-map';

export const CARD_PAINT: Record<Card | 'grey', string> = {
  red: '#d24a3c',
  blue: '#4b87cc',
  green: '#5f9e4c',
  yellow: '#e6c043',
  black: '#2b2622',
  white: '#f3ede2',
  grey: '#8f877b',
  engine: '#e8863a',
};

/** Text that reads on each card colour. */
export const CARD_TEXT: Record<Card | 'grey', string> = {
  red: '#fff7ee',
  blue: '#fff7ee',
  green: '#fff7ee',
  yellow: '#1a1008',
  black: '#ede4d4',
  white: '#1a1008',
  grey: '#1a1008',
  engine: '#1a1008',
};

export const CARD_LABEL: Record<Card | 'grey', string> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  black: 'Black',
  white: 'White',
  grey: 'Any',
  engine: 'Engine',
};

/** By seat. Amber, teal, rose, lime, periwinkle. */
export const PLAYER_PAINT = ['#f2a33a', '#3cc6bd', '#ec7fb6', '#b9dc50', '#a3a7ff'] as const;

export const playerPaint = (seat: number | null | undefined): string => (seat == null ? '#8f877b' : PLAYER_PAINT[seat % PLAYER_PAINT.length]);

export const routePaint = (c: RouteColour): string => CARD_PAINT[c];
