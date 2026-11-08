import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import GlassArt from './GlassArt.svelte';
import { decodeBands, glassAt } from '$lib/landing/wildmind-glass';
import { gatherHuts, onBoard, peopleAnchors, figureTop, type Figure } from '$lib/landing/showcase-place-wildmind';
import { fixtureGlass, wildmindFixture } from '$lib/landing/wildmind.fixture';
import type { WildmindState } from '$lib/landing/wildmind';

const NOW = Date.parse('2026-10-10T13:30:00Z');

/** The scene's props for a fixture state, worked out as PlaceShowcase does. */
function props(state: WildmindState | 'asleep') {
  const w = wildmindFixture(NOW, state);
  const glass = w.mapVersion ? fixtureGlass(state) : null;
  const bands = glass ? decodeBands(glass) : null;
  const stand = (x: number, y: number) => (glass && bands ? onBoard(glassAt(glass, bands, x, y)) : null);
  const figures: Figure[] = w.people.flatMap((p) => {
    const at = stand(p.x, p.y);
    return at ? [{ id: p.id, x: at.x, y: at.y, asleep: p.doing === 'asleep', alive: p.alive }] : [];
  });
  return {
    state: w.state,
    glass,
    figures,
    huts: gatherHuts(w.structures.flatMap(([x, y, done, lit]) => stand(x, y) ? [{ ...stand(x, y)!, lit: lit === 1, done: done === 1 }] : []), figures),
    fires: [],
    animals: w.animals.flatMap(([x, y]) => stand(x, y) ?? []),
    anchors: peopleAnchors(figures.map((f) => ({ id: f.id, x: f.x, y: f.y - figureTop(f.asleep) }))),
    plaque: w.invented != null,
    light: { side: 'east' as const, reach: 1 },
    sunX: 40,
  };
}

describe('GlassArt', () => {
  it('draws the gallery, the model and the figures, hidden from assistive tech and with no words drawn as SVG', () => {
    const { body } = render(GlassArt, { props: props('asleep') });
    expect(body).toContain('data-state="live"');
    expect((body.match(/<svg[^>]*aria-hidden="true"/g) ?? []).length).toBe(4);
    expect(body).not.toMatch(/<text|<tspan/);
    expect((body.match(/class="gm-card/g) ?? []).length).toBeGreaterThan(4);
    expect(body).toContain('data-part="main"');
    expect(body).toContain('data-part="companion"');
    // Both asleep: lying down, no one standing.
    expect(body).not.toContain('M-1.9,-1v-7.4');
    expect(body).toContain('id="sp-wm-model"');
    // Every id is the chapter's own.
    for (const id of body.match(/ id="[^"]+"/g) ?? []) expect(id).toMatch(/ id="sp-wm-/);
    expect(body).not.toContain('Back');
    expect(body).not.toContain('gl-sheet');
  });

  it('hangs a card in the glass when paused, a dust sheet over the vitrine when offline', () => {
    const paused = render(GlassArt, { props: props('paused') }).body;
    expect(paused).toMatch(/class="gl-card[ "]/);
    expect(paused).toContain('Back<br/>shortly');
    const off = render(GlassArt, { props: props('offline') }).body;
    expect(off).toMatch(/class="gl-sheet[ "]/);
    expect(off).not.toContain('class="gm-card');
    expect(off).not.toContain('data-part="main"');
    // The plaque stays, engraved, its words gone.
    expect(off).toMatch(/class="gl-plate[^"]*bare/);
  });

  it('leaves an empty base where someone fell, and dims the model between lives and when stale', () => {
    const ended = render(GlassArt, { props: props('between-lives') }).body;
    expect(ended).toMatch(/class="gp-who[^"]*gone/);
    expect(ended).toMatch(/class="gl-held[^"]*ended/);
    expect(render(GlassArt, { props: props('stale') }).body).toMatch(/class="gl-held[^"]*still/);
  });

  it('draws only the board before the model arrives', () => {
    const { body } = render(GlassArt, { props: { ...props('live'), glass: null, figures: [], anchors: [] } });
    expect(body).toContain('sp-wm-grid');
    expect(body).not.toContain('class="gm-card');
  });
});
