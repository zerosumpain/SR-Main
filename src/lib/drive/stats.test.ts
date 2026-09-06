import { describe, it, expect } from 'vitest';
import { computeVitals, fmtSize, splitSize, type DriveStatFile } from './stats';

const NOW = Date.parse('2026-09-06T12:00:00Z');

const file = (over: Partial<DriveStatFile> & { id: string; name: string }): DriveStatFile => ({
  sizeBytes: 1000,
  createdAt: '2026-09-06T11:00:00Z',
  indexStatus: 'skipped',
  ...over,
});

describe('fmtSize', () => {
  it('climbs the ladder', () => {
    expect(fmtSize(512)).toBe('512 B');
    expect(fmtSize(2048)).toBe('2.0 KB');
    expect(fmtSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(fmtSize(3 * 1024 ** 3)).toBe('3.00 GB');
  });

  it('splits the figure from its unit for the tile', () => {
    expect(splitSize(2048)).toEqual({ value: '2.0', unit: 'KB' });
    expect(splitSize(0)).toEqual({ value: '0', unit: 'B' });
  });
});

describe('computeVitals', () => {
  const store: DriveStatFile[] = [
    file({ id: '1', name: 'notes.md', sizeBytes: 1024, indexStatus: 'indexed' }),
    file({ id: '2', name: 'invoices/.keep', sizeBytes: 0 }),
    file({ id: '3', name: 'invoices/jan.pdf', sizeBytes: 2048, indexStatus: 'indexed' }),
    file({ id: '4', name: 'invoices/feb.pdf', sizeBytes: 2048, indexStatus: 'failed' }),
    file({ id: '5', name: 'invoices/2026/logo.png', sizeBytes: 4096, indexStatus: 'skipped' }),
  ];

  it('counts real files and ignores markers', () => {
    expect(computeVitals(store, NOW).files).toBe(4);
  });

  it('excludes markers from the byte total', () => {
    expect(computeVitals(store, NOW).bytes).toBe(1024 + 2048 + 2048 + 4096);
  });

  it('counts every folder path including intermediates', () => {
    expect(computeVitals(store, NOW).folders).toBe(2);
  });

  it('reports indexed against indexABLE, not against everything', () => {
    const v = computeVitals(store, NOW);
    // logo.png is 'skipped' — the indexer will never attempt it, so counting it
    // as a miss would make a complete corpus look permanently unfinished.
    expect(v.indexable).toBe(3);
    expect(v.indexed).toBe(2);
  });

  it('measures age from the newest UPLOAD, not the last edit', () => {
    expect(computeVitals(store, NOW).newestAgoSeconds).toBe(3600);
  });

  it('survives an empty drive', () => {
    expect(computeVitals([], NOW)).toEqual({
      files: 0,
      bytes: 0,
      folders: 0,
      indexed: 0,
      indexable: 0,
      newestAgoSeconds: null,
    });
  });

  it('survives an unparseable timestamp rather than printing NaN', () => {
    const v = computeVitals([file({ id: '1', name: 'a.txt', createdAt: 'not a date' })], NOW);
    expect(v.newestAgoSeconds).toBeNull();
  });

  it('never reports a negative age for a clock-skewed future stamp', () => {
    const v = computeVitals(
      [file({ id: '1', name: 'a.txt', createdAt: '2026-09-06T13:00:00Z' })],
      NOW,
    );
    expect(v.newestAgoSeconds).toBe(0);
  });
});
