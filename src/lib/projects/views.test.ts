import { describe, expect, it } from 'vitest';
import { countEntries, familyOf, plural, sayCount, toEntries, type ProjectCard } from './views';

const card = (key: string, kind: string, extra: Partial<ProjectCard> = {}): ProjectCard => ({
  key,
  href: `/projects/${key}/`,
  label: `Open ${key}`,
  kind,
  tag: '',
  title: key,
  blurb: '',
  chips: '',
  ...extra,
});

describe('familyOf', () => {
  it('reads the family off the eyebrow, whatever its number or case', () => {
    expect(familyOf('Field Study №6', 'hand')).toBe('study');
    expect(familyOf('Field study', 'hand')).toBe('study');
    expect(familyOf('Game', 'hand')).toBe('game');
    expect(familyOf('Simulation', 'hand')).toBe('game');
    expect(familyOf('Tool', 'hand')).toBe('tool');
    expect(familyOf('Working tool', 'hand')).toBe('tool');
    expect(familyOf('Prototype', 'hand')).toBe('tool');
  });

  it('files every agent build as agent-built, whatever its eyebrow', () => {
    expect(familyOf('Field Study №1', 'agent')).toBe('agent');
  });
});

describe('toEntries', () => {
  it('numbers the hand-built cards first, then the agent builds', () => {
    const { hand, agent } = toEntries([card('a', 'Game'), card('b', 'Tool')], [card('c', 'AI Built')], () => true);
    expect(hand.map((e) => e.n)).toEqual([1, 2]);
    expect(agent.map((e) => [e.n, e.section, e.family])).toEqual([[3, 'agent', 'agent']]);
  });

  it('asks the visibility rule per key, and never calls an owner-only card public', () => {
    const { hand } = toEntries(
      [card('pub', 'Tool'), card('priv', 'Tool'), card('mine', 'Simulation', { ownerOnly: true })],
      [],
      (key) => key !== 'priv',
    );
    expect(hand.map((e) => e.isPublic)).toEqual([true, false, false]);
  });
});

describe('countEntries', () => {
  it('counts each family and the entries the public cannot see', () => {
    const { hand, agent } = toEntries(
      [card('s1', 'Field Study №1'), card('s2', 'Field study'), card('g', 'Game'), card('t', 'Tool')],
      [card('x', 'AI Built')],
      (key) => key !== 'g',
    );
    expect(countEntries(hand, agent)).toEqual({ bench: 5, studies: 2, games: 1, tools: 1, agent: 1, hidden: 1 });
  });

  it('is all zeros for an empty index', () => {
    expect(countEntries([], [])).toEqual({ bench: 0, studies: 0, games: 0, tools: 0, agent: 0, hidden: 0 });
  });
});

describe('sayCount and plural', () => {
  it('says small counts in words and larger ones in figures', () => {
    expect(sayCount(0)).toBe('no');
    expect(sayCount(1)).toBe('one');
    expect(sayCount(12)).toBe('twelve');
    expect(sayCount(13)).toBe('13');
  });

  it('pluralises, with an irregular plural when given one', () => {
    expect(plural(1, 'game')).toBe('one game');
    expect(plural(3, 'game')).toBe('three games');
    expect(plural(2, 'field study', 'field studies')).toBe('two field studies');
    expect(plural(0, 'tool')).toBe('no tools');
  });
});
