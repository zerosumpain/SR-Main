// Between lives, end to end in Wildmind's real shape. The payload in
// fixtures/wildmind-between-lives.json is what Wildmind's publicSnapshot
// (server/public.ts) returned for a valley whose third life has just ended of
// thirst, after the second died of hunger and the first of the cold. Earlier
// tests built the between-lives data by hand, so they never saw the real order
// of earlierLives: the life that has just ended comes first.

import { describe, expect, it } from 'vitest';
import recorded from './fixtures/wildmind-between-lives.json';
import { familyLines, stateNote, wildmindFair } from './showcase-notes-wildmind';
import { plainText } from './showcase-sentence';
import { lifeRows, wildmindChapter } from './showcase-sentence-wildmind';
import { parseSnapshot, project } from './wildmind';
import { stateLine } from './wildmind-words';
import { traceGrid } from './wildmind-trace.server';

const NOW = Date.parse('2026-10-10T13:30:00Z');

function between() {
  const snap = parseSnapshot(recorded);
  if (!snap?.terrain) throw new Error('the recorded payload no longer parses');
  return project(snap, NOW, NOW, traceGrid(snap.terrain, snap.terrainVersion));
}

describe('between lives, from a real Wildmind payload', () => {
  it('reads Wildmind’s order: the life that just ended leads earlierLives', () => {
    const w = between();
    expect(w.state).toBe('between-lives');
    expect(w.generation).toBe(3);
    expect(w.earlierLives.map((l) => l.cause)).toEqual(['thirst', 'starvation', 'cold']);
  });

  it('says what the ended life died of, in every view', () => {
    const w = between();
    expect(stateLine(w)).toMatch(/^JKai died of thirst on day one\./);
    expect(stateNote(w)).toMatch(/^JKai died of thirst on day one\. The fourth of the line is next\./);
    const p1 = plainText(wildmindChapter(w).p1);
    expect(p1).toContain('JKai died of thirst on day one');
    expect(p1).not.toContain('hunger');
  });

  it('keeps every life in the sentence family tree', () => {
    const w = between();
    const p2 = plainText(wildmindChapter(w).p2?.segs ?? []);
    expect(p2).toContain('That JKai was the third of the line.');
    expect(p2).toContain('The first lasted 32 days and died of the cold, and the second lasted two days and died of hunger.');
    const rows = lifeRows(w);
    expect(rows?.rows.map((r) => r.label)).toEqual([
      'first · 32 days · the cold',
      'second · two days · hunger',
      'third · five days · thirst',
    ]);
    expect(rows?.rows.some((r) => r.open)).toBe(false);
  });

  it('keeps every life in the notes family tree and the fair copy', () => {
    const w = between();
    const tree = familyLines(w);
    expect(tree?.start).toBe(1);
    expect(tree?.items.map((i) => [i.kind, i.text])).toEqual([
      ['life', 'the first lasted 32 days and died of the cold'],
      ['life', 'the second lasted two days and died of hunger'],
      ['ended', 'the third lasted five days and died of thirst'],
      ['ghost', 'the fourth, next in line'],
    ]);
    const lives = wildmindFair(w).find((r) => r.k === 'Earlier lives')?.v;
    expect(lives).toBe('the first, 32 days, the cold; the second, two days, hunger; the third, five days, thirst');
  });
});
