// src/lib/geo/weekly.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

import { phraseLandgrabWeek, weekFactLines, numericStats, isLocalSunday, localDayStr, type WeekFacts } from './weekly';

const cell = 1970;
const facts: WeekFacts = {
  weekEnding: '2026-09-13',
  quiet: false,
  cellAreaM2: cell,
  players: [
    { subject: 'rory', cellsNow: 300, cellsThen: 190, gained: 120, lost: 10, net: 110, areaNowM2: 300 * cell, gainedM2: 120 * cell, lostM2: 10 * cell, activeDays: 5, streak: 3 },
    { subject: 'katie', cellsNow: 500, cellsThen: 440, gained: 70, lost: 10, net: 60, areaNowM2: 500 * cell, gainedM2: 70 * cell, lostM2: 10 * cell, activeDays: 4, streak: 0 },
    { subject: 'john', cellsNow: 3000, cellsThen: 3150, gained: 20, lost: 170, net: -150, areaNowM2: 3000 * cell, gainedM2: 20 * cell, lostM2: 170 * cell, activeDays: 6, streak: 6 },
  ],
  takes: [{ from: 'john', to: 'rory', cells: 45, areaM2: 45 * cell }],
  biggestClaim: { subject: 'john', tiles: 610, areaM2: 610 * cell, activityType: 'ride', day: '2026-09-08', victims: ['unclaimed'] },
  contested: [
    { subject: 'rory', holdsNow: 180, holdsThen: 160, visited: 310 },
    { subject: 'john', holdsNow: 600, holdsThen: 640, visited: 1585 },
  ],
  battleground: { name: 'South Park', centre: [54.52, -1.55], handovers: 38, holders: [{ subject: 'rory', cells: 40 }, { subject: 'john', cells: 22 }] },
};

describe('phraseLandgrabWeek', () => {
  it('names the movers first, biggest net first, with what they took and from whom', () => {
    const s = phraseLandgrabWeek(facts);
    expect(s).toMatch(/^Week to Sun 13 Sep\./);
    expect(s).toContain('Rory +0.22 km²');
    expect(s).toContain('took 0.09 km² off John');
    expect(s).toContain('John −0.30 km²');
    expect(s).toContain('Biggest claim: John, 1.20 km² by ride on Tue 8 Sep');
    expect(s).toContain('Contested ground: Rory 52% → 58%');
    expect(s).toContain('Battleground of the week: South Park, 38 cells changed hands');
    expect(s).toContain('Streak: John 6 days');
  });
  it('says a quiet week plainly', () => {
    const s = phraseLandgrabWeek({ ...facts, quiet: true, players: facts.players.map((p) => ({ ...p, gained: 0, lost: 0, net: 0, activeDays: 0, streak: 0 })), takes: [], biggestClaim: null, battleground: null });
    expect(s).toBe('Week to Sun 13 Sep. Nobody captured any ground. The map is as it was.');
  });
});

describe('weekFactLines', () => {
  it('lists one line per player and one per take, numbers only from the facts', () => {
    const lines = weekFactLines(facts);
    expect(lines).toContain('rory: holds 300 cells (0.59 km²), gained 120, lost 10, net +110, active 5 days, streak 3');
    expect(lines).toContain('take: rory took 45 cells (0.09 km²) off john');
    expect(lines.some((l) => l.startsWith('biggest claim:'))).toBe(true);
  });
});

describe('numericStats', () => {
  it('is numbers only', () => {
    const stats = numericStats(facts);
    expect(stats['rory.net']).toBe(110);
    expect(stats['takes']).toBe(1);
    expect(Object.values(stats).every((v) => typeof v === 'number')).toBe(true);
  });
});

describe('local day helpers', () => {
  it('reads Europe/London', () => {
    expect(localDayStr(new Date('2026-09-13T22:30:00Z'))).toBe('2026-09-13');
    expect(localDayStr(new Date('2026-09-13T23:30:00Z'))).toBe('2026-09-14'); // BST
    expect(isLocalSunday(new Date('2026-09-13T12:00:00Z'))).toBe(true);
    expect(isLocalSunday(new Date('2026-09-12T12:00:00Z'))).toBe(false);
  });
});
