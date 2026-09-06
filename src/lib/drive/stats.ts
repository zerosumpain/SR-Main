/**
 * The six figures section A puts on the ink band.
 *
 * Pure, and computed over the whole store rather than the current folder — the
 * band is the state of the drive, not of wherever you happen to be stood. The
 * browser below it is the thing that follows `currentPath`.
 */
import { allFolders, isMarker, type DriveFileLike } from './paths';

export interface DriveStatFile extends DriveFileLike {
  sizeBytes: number;
  updatedAt: string | Date;
  indexStatus?: 'indexed' | 'pending' | 'no-text' | 'failed' | 'skipped';
}

export interface DriveVitals {
  files: number;
  bytes: number;
  folders: number;
  /** Files that reached the `@files` index. */
  indexed: number;
  /**
   * Files the indexer will ever attempt — `skipped` types are excluded, so the
   * ratio answers "is my searchable corpus complete" rather than "what share of
   * my drive happens to be text".
   */
  indexable: number;
  /** Seconds since the most recent upload, or null in an empty drive. */
  newestAgoSeconds: number | null;
}

/** Bytes at one decimal place, the same ladder the file rows use. */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * The same number split for the tile: a big display figure and its unit.
 *
 * The band sets values in Archivo Black at 30px, where "1.4 GB" reads as one
 * word and the unit competes with the figure. Splitting them lets the unit sit
 * small beside it, which is how every instrument tile on /health is built.
 */
export function splitSize(n: number): { value: string; unit: string } {
  const [value, unit] = fmtSize(n).split(' ');
  return { value, unit };
}

export function computeVitals(files: DriveStatFile[], now = Date.now()): DriveVitals {
  const real = files.filter((f) => !isMarker(f.name));
  let bytes = 0;
  let indexed = 0;
  let indexable = 0;
  let newest = -Infinity;
  for (const f of real) {
    bytes += f.sizeBytes ?? 0;
    const status = f.indexStatus ?? 'skipped';
    if (status !== 'skipped') indexable += 1;
    if (status === 'indexed') indexed += 1;
    const t = new Date(f.updatedAt).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return {
    files: real.length,
    bytes,
    folders: allFolders(files).length,
    indexed,
    indexable,
    newestAgoSeconds: newest === -Infinity ? null : Math.max(0, Math.round((now - newest) / 1000)),
  };
}
