import { describe, expect, it } from 'vitest';
import { facade, GEOMETRY, quarters, shapeOf, shortName, street } from './place';
import { countEntries, toEntries, type ProjectCard } from '$lib/projects/views';

const card = (key: string, kind: string, extra: Partial<ProjectCard> = {}): ProjectCard => ({
  key,
  href: `/projects/${key}/`,
  label: `Open ${key}`,
  kind,
  tag: 'Interactive',
  title: `${key} — a subtitle`,
  blurb: 'A blurb.',
  chips: 'a · b',
  ...extra,
});

const HAND = [
  card('hex', 'Game'),
  card('scs', 'Field Study №6'),
  card('dsd', 'Tool'),
  card('engine', 'Field study'),
  card('keystone', 'Tool', { product: true }),
  card('wild', 'Simulation'),
];
const AGENT = [card('tide', 'AI Built'), card('allot', 'AI Built')];

function town(hand: ProjectCard[], agent: ProjectCard[], owner = false) {
  const e = toEntries(hand, agent, () => true);
  const counts = countEntries(e.hand, e.agent);
  const showAgent = agent.length > 0 || owner;
  return { ...e, counts, showAgent, owner };
}

describe('quarters', () => {
  it('keeps the street order and leaves out a quarter with nobody in it', () => {
    const t = town(HAND.filter((c) => c.kind !== 'Game' && c.kind !== 'Simulation'), []);
    expect(quarters(t.hand, t.agent, t.showAgent).map((q) => q.quarter.id)).toEqual(['study', 'tool']);
  });

  it('keeps the empty New Town for the owner only', () => {
    const owner = town(HAND, [], true);
    expect(quarters(owner.hand, owner.agent, true).at(-1)?.quarter.id).toBe('agent');
    expect(quarters(owner.hand, owner.agent, true).at(-1)?.entries).toEqual([]);
    const pub = town(HAND, []);
    expect(quarters(pub.hand, pub.agent, false).some((q) => q.quarter.id === 'agent')).toBe(false);
  });
});

describe('street', () => {
  for (const fit of ['wide', 'narrow'] as const) {
    it(`fits every building on the ${fit} street without overlap`, () => {
      const t = town(HAND, AGENT);
      const s = street(t.hand, t.agent, t.showAgent, t.counts, false, fit);
      const g = GEOMETRY[fit];
      expect(s.lots).toHaveLength(HAND.length + AGENT.length);
      const sorted = [...s.lots].sort((a, b) => a.x - b.x);
      sorted.forEach((l, i) => {
        expect(l.x).toBeGreaterThanOrEqual(0);
        expect(l.x + l.w).toBeLessThanOrEqual(g.W + 0.01);
        expect(l.h).toBeLessThanOrEqual(g.H);
        expect(l.roof).toBeGreaterThan(0);
        if (i) expect(l.x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].w - 0.01);
      });
    });
  }

  it('pins three readings inside the street, the agent one only when the New Town is drawn', () => {
    const t = town(HAND, AGENT);
    const s = street(t.hand, t.agent, t.showAgent, t.counts, false, 'wide');
    expect(s.callouts.map((c) => c.id).sort()).toEqual(['agent', 'bench', 'studies']);
    for (const c of s.callouts) {
      expect(c.x).toBeGreaterThan(0);
      expect(c.x).toBeLessThan(1);
      expect(c.y).toBeGreaterThan(0);
      expect(c.y).toBeLessThanOrEqual(1);
    }
    const pub = town(HAND, []);
    const quiet = street(pub.hand, pub.agent, false, pub.counts, false, 'wide');
    expect(quiet.callouts.some((c) => c.id === 'agent')).toBe(false);
    expect(quiet.vacant).toBeNull();
  });

  it('marks out an empty plot for the owner while nothing an agent built is published', () => {
    const t = town(HAND, [], true);
    const s = street(t.hand, t.agent, true, t.counts, true, 'wide');
    expect(s.vacant).not.toBeNull();
    expect(s.callouts.find((c) => c.id === 'agent')?.value).toBe('None');
  });

  it('says what only the owner can see, and never to the public', () => {
    const e = toEntries(HAND, [], (k) => k !== 'hex');
    const counts = countEntries(e.hand, e.agent);
    const own = street(e.hand, e.agent, true, counts, true, 'wide').callouts.find((c) => c.id === 'bench');
    expect(own?.sub).toBe('1 only you can see');
    const pub = street(e.hand, e.agent, false, counts, false, 'wide').callouts.find((c) => c.id === 'bench');
    expect(pub?.sub).toBe('live and playable');
  });

  it('draws an empty town without throwing', () => {
    const s = street([], [], false, countEntries([], []), false, 'narrow');
    expect(s.lots).toEqual([]);
    expect(s.callouts).toEqual([]);
  });
});

describe('buildings', () => {
  it('draws the same building for the same project every time', () => {
    const [e] = toEntries([HAND[1]], [], () => true).hand;
    const a = shapeOf(e, 0);
    expect(shapeOf(e, 0)).toEqual(a);
    expect(facade(e, a.variant, 80, 160)).toEqual(facade(e, a.variant, 80, 160));
  });

  it('builds each family in its own material, a product in petrol', () => {
    const { hand, agent } = toEntries(HAND, AGENT, () => true);
    const m = (key: string) => {
      const e = [...hand, ...agent].find((x) => x.key === key)!;
      return facade(e, shapeOf(e, 0).variant, 80, 160).material;
    };
    expect([m('scs'), m('hex'), m('dsd'), m('tide'), m('keystone')]).toEqual(['stone', 'fair', 'metal', 'glass', 'petrol']);
  });

  it('keeps every variant inside its box', () => {
    const { hand, agent } = toEntries(HAND, AGENT, () => true);
    for (const e of [...hand, ...agent])
      for (let i = 0; i < 4; i++) {
        const s = shapeOf(e, i);
        for (const [w, h] of [[20, 200], [90, 120], [140, 60]]) {
          const f = facade(e, s.variant, w, h);
          expect(f.top).toBeGreaterThanOrEqual(0);
          expect(f.top).toBeLessThan(h);
          expect(f.body + f.roof + f.line).not.toMatch(/NaN|Infinity/);
        }
      }
  });
});

describe('shortName', () => {
  it('keeps what comes before the dash or colon', () => {
    expect(shortName('Marbler — a marble race built on luck')).toBe('Marbler');
    expect(shortName('An allotment ledger: what was sown, when')).toBe('An allotment ledger');
    expect(shortName('Hex')).toBe('Hex');
  });
});
