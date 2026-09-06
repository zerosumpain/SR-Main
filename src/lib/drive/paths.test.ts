import { describe, it, expect } from 'vitest';
import {
  allFolders,
  baseName,
  crumbsFor,
  descendantsOf,
  filesIn,
  folderOf,
  isMarker,
  isWithin,
  joinPath,
  subfoldersOf,
  underCurrent,
} from './paths';

const f = (id: string, name: string) => ({ id, name });

/** A drive with a nested tree, an empty folder, and a lookalike name. */
const STORE = [
  f('1', 'notes.md'),
  f('2', 'invoices/.keep'),
  f('3', 'invoices/jan.pdf'),
  f('4', 'invoices/feb.pdf'),
  f('5', 'invoices/2026/march.pdf'),
  f('6', 'invoices/2026/q1/summary.xlsx'),
  f('7', 'invoices-archive/old.pdf'),
  f('8', 'photos/.keep'),
];

describe('markers', () => {
  it('recognises a marker at the root and in a folder', () => {
    expect(isMarker('.keep')).toBe(true);
    expect(isMarker('invoices/.keep')).toBe(true);
    expect(isMarker('invoices/2026/.keep')).toBe(true);
  });

  it('does not mistake a file that merely ends in the word', () => {
    expect(isMarker('notes.keep.md')).toBe(false);
    expect(isMarker('mykeep')).toBe(false);
    expect(isMarker('a/b.keep')).toBe(false);
  });
});

describe('path pieces', () => {
  it('joins against the root without a leading slash', () => {
    expect(joinPath('', 'a.txt')).toBe('a.txt');
    expect(joinPath('x', 'a.txt')).toBe('x/a.txt');
    expect(joinPath('x/y', 'a.txt')).toBe('x/y/a.txt');
  });

  it('splits a name into folder and leaf', () => {
    expect(baseName('invoices/2026/march.pdf')).toBe('march.pdf');
    expect(baseName('notes.md')).toBe('notes.md');
    expect(folderOf('invoices/2026/march.pdf')).toBe('invoices/2026');
    expect(folderOf('notes.md')).toBe('');
  });
});

describe('underCurrent', () => {
  it('returns the whole name at the root', () => {
    expect(underCurrent('invoices/jan.pdf', '')).toBe('invoices/jan.pdf');
  });

  it('strips the folder prefix', () => {
    expect(underCurrent('invoices/jan.pdf', 'invoices')).toBe('jan.pdf');
    expect(underCurrent('invoices/2026/march.pdf', 'invoices')).toBe('2026/march.pdf');
  });

  it('refuses a sibling whose name merely starts the same way', () => {
    expect(underCurrent('invoices-archive/old.pdf', 'invoices')).toBeNull();
  });
});

describe('isWithin', () => {
  it('counts the folder itself as within itself', () => {
    expect(isWithin('invoices', 'invoices')).toBe(true);
  });

  it('counts a descendant', () => {
    expect(isWithin('invoices/2026/q1', 'invoices')).toBe(true);
  });

  it('does not count a prefix lookalike', () => {
    expect(isWithin('invoices-archive', 'invoices')).toBe(false);
  });

  it('treats the root as containing everything', () => {
    expect(isWithin('invoices/2026', '')).toBe(true);
    expect(isWithin('', '')).toBe(true);
  });
});

describe('crumbsFor', () => {
  it('gives the root a single Drive crumb', () => {
    expect(crumbsFor('')).toEqual([{ label: 'Drive', path: '' }]);
  });

  it('accumulates one crumb per segment', () => {
    expect(crumbsFor('invoices/2026/q1')).toEqual([
      { label: 'Drive', path: '' },
      { label: 'invoices', path: 'invoices' },
      { label: '2026', path: 'invoices/2026' },
      { label: 'q1', path: 'invoices/2026/q1' },
    ]);
  });
});

describe('filesIn', () => {
  it('lists only the files directly in the folder', () => {
    expect(filesIn(STORE, 'invoices').map((x) => x.name)).toEqual([
      'invoices/jan.pdf',
      'invoices/feb.pdf',
    ]);
  });

  it('hides markers', () => {
    expect(filesIn(STORE, 'photos')).toEqual([]);
  });

  it('matches the query against the leaf, not the whole path', () => {
    // 'invoices' appears in every path below it; searching it inside the folder
    // must not return every file just because their folder is called that.
    expect(filesIn(STORE, 'invoices', 'invoices')).toEqual([]);
    expect(filesIn(STORE, 'invoices', 'jan').map((x) => x.name)).toEqual(['invoices/jan.pdf']);
  });

  it('is case-insensitive', () => {
    expect(filesIn(STORE, 'invoices', 'JAN')).toHaveLength(1);
  });
});

describe('subfoldersOf', () => {
  it('lists immediate children sorted, counting the whole subtree', () => {
    expect(subfoldersOf(STORE, '')).toEqual([
      { name: 'invoices', count: 4 },
      { name: 'invoices-archive', count: 1 },
      { name: 'photos', count: 0 },
    ]);
  });

  it('excludes markers from the count but keeps the folder', () => {
    const photos = subfoldersOf(STORE, '').find((s) => s.name === 'photos');
    expect(photos).toEqual({ name: 'photos', count: 0 });
  });

  it('descends one level', () => {
    expect(subfoldersOf(STORE, 'invoices')).toEqual([{ name: '2026', count: 2 }]);
  });

  it('filters by name when a query is active', () => {
    expect(subfoldersOf(STORE, '', 'photo')).toEqual([{ name: 'photos', count: 0 }]);
  });
});

describe('allFolders', () => {
  it('returns every folder path including intermediate ones', () => {
    expect(allFolders(STORE)).toEqual([
      'invoices',
      'invoices-archive',
      'invoices/2026',
      'invoices/2026/q1',
      'photos',
    ]);
  });

  it('is empty for a flat drive', () => {
    expect(allFolders([f('1', 'a.txt'), f('2', 'b.txt')])).toEqual([]);
  });
});

describe('descendantsOf', () => {
  it('takes the marker and the whole subtree', () => {
    expect(descendantsOf(STORE, 'invoices').map((x) => x.id)).toEqual(['2', '3', '4', '5', '6']);
  });

  it('does not take a prefix lookalike', () => {
    expect(descendantsOf(STORE, 'invoices').some((x) => x.name.startsWith('invoices-'))).toBe(false);
  });
});
