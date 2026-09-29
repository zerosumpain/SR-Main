import type { LayoutServerLoad } from './$types';

/**
 * The /games register, day or night, from the reader's cookie so the first
 * paint is already right (no flash). Day unless they chose night — the rest
 * of the site is day, and a table you land on from it should be too.
 */
export const load: LayoutServerLoad = ({ cookies }) => ({
  night: cookies.get('sr_games_theme') === 'night',
});
