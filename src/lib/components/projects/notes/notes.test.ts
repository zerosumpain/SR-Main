import { describe, expect, it } from 'vitest';
import { benchAside, cardId, chipList, fixingFor, handAside, shortTitle, tallyRows, tiltFor } from './notes';
import type { ProjectCounts } from './views';

const counts = (over: Partial<ProjectCounts> = {}): ProjectCounts => ({
  bench: 15,
  studies: 6,
  games: 3,
  tools: 4,
  agent: 2,
  hidden: 3,
  ...over,
});

describe('tiltFor', () => {
  it('pins every card a little off true, the same way every time', () => {
    for (const key of ['hex', 'marbler', 'scs-earnings', 'engine-room', 'a', '']) {
      const t = tiltFor(key);
      expect(Math.abs(t)).toBeGreaterThanOrEqual(0.4);
      expect(Math.abs(t)).toBeLessThanOrEqual(1.4);
      expect(tiltFor(key)).toBe(t);
    }
  });

  it('leans cards both ways across a page of keys', () => {
    const tilts = ['hex', 'marbler', 'field-study-8', 'scs-earnings', 'data-spine', 'archetype', 'policy-engine'].map(tiltFor);
    expect(tilts.some((t) => t > 0)).toBe(true);
    expect(tilts.some((t) => t < 0)).toBe(true);
  });
});

describe('fixingFor', () => {
  it('tapes in every agent build', () => {
    expect(fixingFor({ key: 'tide-clock', section: 'agent' })).toBe('tape');
  });

  it('pins most hand-built cards and is stable per key', () => {
    const keys = Array.from({ length: 40 }, (_, i) => `card-${i}`);
    const fix = keys.map((key) => fixingFor({ key, section: 'hand' }));
    expect(fix.filter((f) => f === 'pin').length).toBeGreaterThan(fix.length / 2);
    expect(fixingFor({ key: 'hex', section: 'hand' })).toBe(fixingFor({ key: 'hex', section: 'hand' }));
  });
});

describe('shortTitle', () => {
  it('files a project under its title up to the dash', () => {
    expect(shortTitle('Marbler — a marble race built on luck')).toBe('Marbler');
    expect(shortTitle('The Engine Room – Daydream, Build and the App')).toBe('The Engine Room');
  });

  it('keeps a title with no dash, and a hyphenated word, whole', () => {
    expect(shortTitle('Hex')).toBe('Hex');
    expect(shortTitle('Data-Spine Lite')).toBe('Data-Spine Lite');
  });
});

describe('cardId and chipList', () => {
  it('makes a safe anchor from any key', () => {
    expect(cardId('scs-earnings')).toBe('pn-scs-earnings');
    expect(cardId('a b/c')).toBe('pn-a-b-c');
  });

  it('splits the chip strip into its notes', () => {
    expect(chipList('Rapier physics · Pixi ·  procedural courses ')).toEqual(['Rapier physics', 'Pixi', 'procedural courses']);
    expect(chipList('')).toEqual([]);
  });
});

describe('tallyRows', () => {
  it('tallies the three hand-built families and the agent, in words for a screen reader', () => {
    const rows = tallyRows(counts(), true);
    expect(rows.map((r) => r.family)).toEqual(['study', 'game', 'tool', 'agent']);
    expect(rows[0].spoken).toBe('six field studies');
    expect(rows[1].spoken).toBe('three games');
    expect(rows[3].spoken).toBe('two by an agent');
  });

  it('never counts an agent page the reader cannot turn to', () => {
    expect(tallyRows(counts({ agent: 0 }), false).map((r) => r.family)).toEqual(['study', 'game', 'tool']);
  });

  it('says plainly when the agent page is empty', () => {
    expect(tallyRows(counts({ agent: 0 }), true)[3].aside).toBe('none yet.');
  });

  it('says one, not ones', () => {
    expect(tallyRows(counts({ studies: 1 }), false)[0].spoken).toBe('one field study');
  });
});

describe('the asides', () => {
  it('tells only the owner what is hidden', () => {
    expect(benchAside(counts(), true)).toBe('three of them only I can see.');
    expect(benchAside(counts({ hidden: 0 }), true)).not.toMatch(/only I/);
    expect(benchAside(counts(), false)).not.toMatch(/only I/);
  });

  it('accounts for the agent builds under the hand-built count', () => {
    expect(handAside(2, true)).toBe('and two by an agent.');
    expect(handAside(0, true)).toBe('and none by an agent, yet.');
    expect(handAside(0, false)).toBe('every one of them.');
  });
});
