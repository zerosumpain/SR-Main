import { describe, expect, it } from 'vitest';
import { navCellsFor, subnavFor, visibleItems, SITE_ITEMS } from './site-nav';

describe('a member is offered exactly what they can reach', () => {
  it('shows an owner-only site cell they reach, and links a cell to the first page under it', () => {
    const cells = navCellsFor('/', false, ['/jkai/notes', '/research']);
    const byLabel = Object.fromEntries(cells.map((c) => [c.label, c.href]));
    expect(byLabel.Research).toBe('/research');
    expect(byLabel.jkai).toBe('/jkai/notes');
    expect(byLabel.News).toBeUndefined();
    expect(byLabel.Drive).toBeUndefined();
  });

  it('a Family Circle member reaches Home through People', () => {
    const byLabel = Object.fromEntries(visibleItems(SITE_ITEMS, false, ['/home/people']).map((c) => [c.label, c.href]));
    expect(byLabel.Home).toBe('/home/people');
  });

  it('inside an owner-only section, only the reachable cells', () => {
    expect(subnavFor('/home/people', false, ['/home/people']).map((i) => i.href)).toEqual(['/home/people']);
    expect(subnavFor('/home/people', false, [])).toEqual([]);
  });

  it('changes nothing for the owner or a signed-out visitor', () => {
    expect(navCellsFor('/', true)).toEqual(navCellsFor('/', true, ['/research']));
    expect(navCellsFor('/', false).some((c) => c.ownerOnly)).toBe(false);
  });
});
