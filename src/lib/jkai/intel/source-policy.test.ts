import { describe, it, expect } from 'vitest';
import {
  ancestorPaths,
  categorySlug,
  folderOf,
  isUnder,
  normalisePath,
  resolveFilePolicy,
  resolveFolderPolicy,
  type FolderSetting,
} from './source-policy';

// The two inheritance rules are deliberately different, and getting either
// backwards is silent: entities quietly stop appearing, or a label quietly
// fails to apply. These lock both down.
//
//   mode       — NEAREST explicit ancestor wins (so a child can re-include)
//   categories — UNION of every ancestor (so a parent label applies below)

function setting(
  path: string,
  intelMode: FolderSetting['intelMode'],
  categoryIds: string[] = [],
): FolderSetting {
  return { path, intelMode, categoryIds };
}

describe('path helpers', () => {
  it('normalises slashes', () => {
    expect(normalisePath('/a//b/')).toBe('a/b');
    expect(normalisePath('')).toBe('');
    expect(normalisePath('/')).toBe('');
  });

  it('finds the folder a file sits in', () => {
    expect(folderOf('clients/acme/brief.pdf')).toBe('clients/acme');
    expect(folderOf('readme.md')).toBe('');
  });

  it('lists ancestors root-first, always including the root', () => {
    expect(ancestorPaths('a/b/c')).toEqual(['', 'a', 'a/b', 'a/b/c']);
    expect(ancestorPaths('')).toEqual(['']);
  });

  it('knows when a folder is under another', () => {
    expect(isUnder('a/b/c', 'a/b')).toBe(true);
    expect(isUnder('a/b', 'a/b')).toBe(true);
    expect(isUnder('ab/c', 'a')).toBe(false);
    expect(isUnder('anything', '')).toBe(true);
  });
});

describe('resolveFolderPolicy — mode', () => {
  it('includes by default', () => {
    const result = resolveFolderPolicy('clients/acme', []);
    expect(result.included).toBe(true);
    expect(result.decidedBy).toBeNull();
  });

  it('inherits an ancestor exclusion', () => {
    const result = resolveFolderPolicy('clients/acme/2026', [setting('clients', 'exclude')]);
    expect(result.included).toBe(false);
    expect(result.decidedBy).toBe('clients');
  });

  it('lets the NEAREST ancestor override a further one', () => {
    const settings = [setting('clients', 'exclude'), setting('clients/acme', 'include')];
    expect(resolveFolderPolicy('clients/acme/2026', settings).included).toBe(true);
    expect(resolveFolderPolicy('clients/acme/2026', settings).decidedBy).toBe('clients/acme');
    // A sibling is still excluded.
    expect(resolveFolderPolicy('clients/other', settings).included).toBe(false);
  });

  it('ignores an inherit setting when deciding the mode', () => {
    const settings = [setting('clients', 'exclude'), setting('clients/acme', 'inherit')];
    expect(resolveFolderPolicy('clients/acme', settings).included).toBe(false);
  });

  it('honours a setting on the root', () => {
    expect(resolveFolderPolicy('anything/at/all', [setting('', 'exclude')]).included).toBe(false);
  });

  it('ignores settings on unrelated branches', () => {
    const settings = [setting('personal', 'exclude')];
    expect(resolveFolderPolicy('clients/acme', settings).included).toBe(true);
  });
});

describe('resolveFolderPolicy — categories', () => {
  it('unions every ancestor rather than taking only the nearest', () => {
    const settings = [
      setting('', 'inherit', ['all']),
      setting('clients', 'inherit', ['work']),
      setting('clients/acme', 'inherit', ['acme']),
    ];
    expect(resolveFolderPolicy('clients/acme/2026', settings).categoryIds).toEqual([
      'all',
      'work',
      'acme',
    ]);
  });

  it('de-duplicates repeated ids', () => {
    const settings = [setting('clients', 'inherit', ['work']), setting('clients/acme', 'inherit', ['work'])];
    expect(resolveFolderPolicy('clients/acme', settings).categoryIds).toEqual(['work']);
  });

  it('still collects categories from a folder that is excluded', () => {
    // The mode and the labels are independent; re-including later must not have
    // lost the labelling.
    const settings = [setting('clients', 'exclude', ['work'])];
    const result = resolveFolderPolicy('clients/acme', settings);
    expect(result.included).toBe(false);
    expect(result.categoryIds).toEqual(['work']);
  });
});

describe('resolveFilePolicy', () => {
  it('resolves from the file name', () => {
    const settings = [setting('clients', 'exclude', ['work'])];
    const result = resolveFilePolicy('clients/acme/brief.pdf', settings);
    expect(result.included).toBe(false);
    expect(result.categoryIds).toEqual(['work']);
  });

  it('treats a root file as the root folder', () => {
    expect(resolveFilePolicy('notes.md', [setting('', 'exclude')]).included).toBe(false);
  });
});

describe('categorySlug', () => {
  it('produces a stable key', () => {
    expect(categorySlug('Work & Clients')).toBe('work-clients');
    expect(categorySlug('  Home  ')).toBe('home');
    expect(categorySlug('!!!')).toBe('');
  });
});
