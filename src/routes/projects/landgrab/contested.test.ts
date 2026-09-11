import { describe, expect, it } from 'vitest';
import { resolveContest } from './contested';

const input = (
  visitors: Record<string, string[]>,
  owners: Record<string, string>,
  subjects: string[],
) => ({
  visitors: new Map(Object.entries(visitors).map(([k, v]) => [k, new Set(v)])),
  ownerByCell: new Map(Object.entries(owners)),
  subjects,
});

describe('contested board', () => {
  it('counts only cells more than one person has stood on', () => {
    const r = resolveContest(
      input(
        { a: ['john'], b: ['john', 'katie'], c: ['katie'], d: ['john', 'katie', 'rory'] },
        { a: 'john', b: 'john', c: 'katie', d: 'katie' },
        ['john', 'katie', 'rory'],
      ),
    );
    expect(r.cells).toBe(2);
    // John holds one of the two contested cells and has visited both.
    expect(r.board.find((x) => x.subject === 'john')).toEqual({
      subject: 'john',
      holds: 1,
      visited: 2,
      winRate: 0.5,
    });
    // His uncontested cell `a` is invisible here — that is the entire point.
  });

  it('does not let a roamer dilute their own rate with uncontested ground', () => {
    // John has walked a thousand cells; one of them is contested and he lost it.
    const visitors: Record<string, string[]> = { shared: ['john', 'katie'] };
    for (let i = 0; i < 1000; i++) visitors[`solo-${i}`] = ['john'];
    const owners: Record<string, string> = { shared: 'katie' };
    for (let i = 0; i < 1000; i++) owners[`solo-${i}`] = 'john';

    const r = resolveContest(input(visitors, owners, ['john', 'katie']));
    expect(r.cells).toBe(1);
    expect(r.board.find((x) => x.subject === 'john')).toMatchObject({ visited: 1, winRate: 0 });
    expect(r.board.find((x) => x.subject === 'katie')).toMatchObject({ visited: 1, winRate: 1 });
  });

  it('gives everybody on the roster a row, including nil returns', () => {
    const r = resolveContest(
      input({ a: ['john', 'katie'] }, { a: 'john' }, ['john', 'katie', 'rory', 'fintan']),
    );
    expect(r.board.map((x) => x.subject).sort()).toEqual(['fintan', 'john', 'katie', 'rory']);
    expect(r.board.find((x) => x.subject === 'rory')).toEqual({
      subject: 'rory',
      holds: 0,
      visited: 0,
      winRate: 0,
    });
  });

  it('ranks on ground held, breaking ties on the rate', () => {
    const r = resolveContest(
      input(
        {
          a: ['john', 'katie'],
          b: ['john', 'katie'],
          c: ['katie', 'rory'],
          d: ['john', 'rory'],
          e: ['john', 'rory'],
        },
        { a: 'john', b: 'katie', c: 'katie', d: 'rory', e: 'john' },
        ['john', 'katie', 'rory'],
      ),
    );
    // john 2 of 4, katie 2 of 3, rory 1 of 3 — katie's better rate puts her first.
    expect(r.board.map((x) => x.subject)).toEqual(['katie', 'john', 'rory']);
    expect(r.board[0].winRate).toBeCloseTo(2 / 3, 10);
  });

  it('an unowned contested cell counts as visited but is held by nobody', () => {
    const r = resolveContest(input({ a: ['john', 'katie'] }, {}, ['john', 'katie']));
    expect(r.cells).toBe(1);
    for (const row of r.board) expect(row).toMatchObject({ holds: 0, visited: 1, winRate: 0 });
  });

  it('is empty when nobody shares any ground', () => {
    const r = resolveContest(input({ a: ['john'], b: ['katie'] }, { a: 'john', b: 'katie' }, ['john', 'katie']));
    expect(r.cells).toBe(0);
    for (const row of r.board) expect(row.visited).toBe(0);
  });
});
