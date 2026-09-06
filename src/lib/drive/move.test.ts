import { describe, it, expect } from 'vitest';
import {
  dropVerdict,
  invertMoves,
  moveRequest,
  moveSummary,
  pathLabel,
  MAX_NAME_LENGTH,
  type DragPayload,
} from './move';

const f = (id: string, name: string) => ({ id, name });

const STORE = [
  f('1', 'notes.md'),
  f('2', 'invoices/.keep'),
  f('3', 'invoices/jan.pdf'),
  f('4', 'invoices/feb.pdf'),
  f('5', 'invoices/2026/march.pdf'),
  f('6', 'invoices/2026/q1/summary.xlsx'),
  f('7', 'invoices-archive/old.pdf'),
  f('8', 'photos/.keep'),
  f('9', 'photos/jan.pdf'),
];

const files = (...ids: string[]): DragPayload => ({ kind: 'files', ids });
const folder = (path: string): DragPayload => ({ kind: 'folder', path });

describe('pathLabel', () => {
  it('names the root', () => {
    expect(pathLabel('')).toBe('Drive');
    expect(pathLabel('invoices')).toBe('invoices');
  });
});

describe('dropping files', () => {
  it('moves a file into a folder', () => {
    const v = dropVerdict(STORE, files('1'), 'invoices');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.moves).toEqual([{ id: '1', from: 'notes.md', to: 'invoices/notes.md' }]);
    expect(v.label).toBe('notes.md → invoices');
  });

  it('moves a file up to the root', () => {
    const v = dropVerdict(STORE, files('3'), '');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.moves).toEqual([{ id: '3', from: 'invoices/jan.pdf', to: 'jan.pdf' }]);
    expect(v.label).toBe('jan.pdf → Drive');
  });

  it('refuses a file already in the target', () => {
    const v = dropVerdict(STORE, files('3'), 'invoices');
    expect(v).toEqual({ ok: false, reason: 'already in invoices' });
  });

  it('refuses when the target already holds that name', () => {
    // photos/jan.pdf exists, so invoices/jan.pdf cannot land there.
    const v = dropVerdict(STORE, files('3'), 'photos');
    expect(v).toEqual({ ok: false, reason: 'already a file called jan.pdf there' });
  });

  it('moves the movable part of a mixed selection', () => {
    // '3' is already in invoices; '1' is not.
    const v = dropVerdict(STORE, files('1', '3'), 'invoices');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.moves.map((m) => m.id)).toEqual(['1']);
    expect(v.label).toBe('notes.md → invoices');
  });

  it('counts a multi-file move in the label', () => {
    const v = dropVerdict(STORE, files('3', '4'), 'photos');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // jan.pdf clashes with photos/jan.pdf; feb.pdf goes.
    expect(v.plan.moves.map((m) => m.to)).toEqual(['photos/feb.pdf']);
    expect(v.plan.blocked).toEqual([
      { name: 'jan.pdf', reason: 'already a file called jan.pdf there' },
    ]);
  });

  it('refuses the second of two identically named files in one drag', () => {
    const store = [f('a', 'x/report.pdf'), f('b', 'y/report.pdf')];
    const v = dropVerdict(store, files('a', 'b'), '');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.moves).toHaveLength(1);
    expect(v.plan.blocked).toEqual([
      { name: 'report.pdf', reason: 'already a file called report.pdf there' },
    ]);
  });

  it('refuses an empty drag', () => {
    expect(dropVerdict(STORE, files(), 'invoices')).toEqual({
      ok: false,
      reason: 'nothing to move',
    });
  });

  it('refuses a move that would overrun the name cap', () => {
    const deep = 'a'.repeat(MAX_NAME_LENGTH - 5);
    const store = [f('a', 'doc.pdf'), f('b', `${deep}/.keep`)];
    const v = dropVerdict(store, files('a'), deep);
    expect(v).toEqual({ ok: false, reason: 'the new path would be too long' });
  });
});

describe('dropping a folder', () => {
  it('rewrites the prefix of every descendant, marker included', () => {
    const v = dropVerdict(STORE, folder('invoices/2026'), 'photos');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.moves).toEqual([
      { id: '5', from: 'invoices/2026/march.pdf', to: 'photos/2026/march.pdf' },
      { id: '6', from: 'invoices/2026/q1/summary.xlsx', to: 'photos/2026/q1/summary.xlsx' },
    ]);
    expect(v.label).toBe('2026 → photos');
  });

  it('takes the .keep with it so an empty folder survives the move', () => {
    const v = dropVerdict(STORE, folder('photos'), 'invoices');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.moves.map((m) => m.to)).toEqual([
      'invoices/photos/.keep',
      'invoices/photos/jan.pdf',
    ]);
  });

  it('refuses a folder dropped on itself', () => {
    expect(dropVerdict(STORE, folder('invoices'), 'invoices')).toEqual({
      ok: false,
      reason: 'a folder cannot go inside itself',
    });
  });

  it('refuses a folder dropped into its own descendant', () => {
    // This is the one that would detach the subtree from every reachable path.
    expect(dropVerdict(STORE, folder('invoices'), 'invoices/2026/q1')).toEqual({
      ok: false,
      reason: 'a folder cannot go inside its own contents',
    });
  });

  it('allows a folder into a prefix lookalike, which is a different folder', () => {
    const v = dropVerdict(STORE, folder('invoices'), 'invoices-archive');
    expect(v.ok).toBe(true);
  });

  it('refuses a folder already sitting in the target', () => {
    expect(dropVerdict(STORE, folder('invoices/2026'), 'invoices')).toEqual({
      ok: false,
      reason: 'already in invoices',
    });
  });

  it('refuses a folder name that already exists in the target', () => {
    const store = [...STORE, f('10', 'photos/2026/.keep')];
    expect(dropVerdict(store, folder('invoices/2026'), 'photos')).toEqual({
      ok: false,
      reason: 'a folder called 2026 is already there',
    });
  });

  it('refuses the root', () => {
    expect(dropVerdict(STORE, folder(''), 'invoices')).toEqual({
      ok: false,
      reason: 'the root is not a folder',
    });
  });

  it('moves a folder up to the root', () => {
    const v = dropVerdict(STORE, folder('invoices/2026'), '');
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.plan.moves[0].to).toBe('2026/march.pdf');
    expect(v.label).toBe('2026 → Drive');
  });
});

describe('the request and its inverse', () => {
  const moves = [
    { id: '3', from: 'invoices/jan.pdf', to: 'jan.pdf' },
    { id: '4', from: 'invoices/feb.pdf', to: 'feb.pdf' },
  ];

  it('sends the destination names', () => {
    expect(moveRequest(moves)).toEqual([
      { id: '3', name: 'jan.pdf' },
      { id: '4', name: 'feb.pdf' },
    ]);
  });

  it('undo sends the originals back', () => {
    expect(invertMoves(moves)).toEqual([
      { id: '3', name: 'invoices/jan.pdf' },
      { id: '4', name: 'invoices/feb.pdf' },
    ]);
  });

  it('round-trips', () => {
    const back = invertMoves(moves);
    expect(back.map((m) => m.name)).toEqual(moves.map((m) => m.from));
  });
});

describe('moveSummary', () => {
  it('does not count the marker a folder move drags along', () => {
    const moves = [
      { id: '8', from: 'photos/.keep', to: 'invoices/photos/.keep' },
      { id: '9', from: 'photos/jan.pdf', to: 'invoices/photos/jan.pdf' },
    ];
    expect(moveSummary(moves, 'invoices')).toBe('Moved 1 item to invoices');
  });

  it('pluralises and names the root', () => {
    const moves = [
      { id: '1', from: 'a/x.pdf', to: 'x.pdf' },
      { id: '2', from: 'a/y.pdf', to: 'y.pdf' },
    ];
    expect(moveSummary(moves, '')).toBe('Moved 2 items to Drive');
  });
});
