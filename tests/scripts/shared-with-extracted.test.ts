import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Nine modules in this repository are also held, byte for byte, by an extracted
 * application. Each was duplicated rather than moved, for a reason recorded in
 * shared-with-extracted.json.
 *
 * None of them drifting breaks a build or fails another test. That is the whole
 * point of this one. The failure modes are quiet and expensive:
 *
 *   - geo/tiles.ts matches $lib/trails/track's haversine "so distances agree".
 *     If the copies diverge, Landgrab's scoring atom moves and nothing fails.
 *   - A share capability minted by one process and rejected by the other is a
 *     link that simply stops working.
 *   - webdav/auth verifies the credential for a mounted filesystem. Divergence
 *     is a drive that will not mount.
 */
describe('modules shared with the extracted applications', () => {
  const manifest = JSON.parse(readFileSync('shared-with-extracted.json', 'utf8')) as {
    files: Record<string, { peer: string; sha256: string }>;
  };

  it('still match the hashes recorded when they were duplicated', () => {
    const drifted: string[] = [];
    for (const [file, entry] of Object.entries(manifest.files)) {
      const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (actual !== entry.sha256) drifted.push(`${file} (peer: ${entry.peer})`);
    }
    expect(
      drifted,
      `these are duplicated in an extracted application and have changed here:\n  ${drifted.join('\n  ')}\n\n` +
        `Make the same change there, then run: node scripts/record-shared-modules.mjs`,
    ).toEqual([]);
  });

  it('covers every module an extracted application actually took', () => {
    // Adding a duplicate without listing it here is how the two copies start
    // disagreeing with nothing to notice.
    expect(Object.keys(manifest.files).sort()).toEqual([
      'src/lib/file-serving.ts',
      'src/lib/file-shares.ts',
      'src/lib/file-store/storage.ts',
      'src/lib/health/polyline.ts',
      'src/lib/jkai/intel/source-policy.ts',
      'src/lib/trails/activity-meta.ts',
      'src/lib/trails/field/tile-math.ts',
      'src/lib/trails/track.ts',
      'src/lib/webdav/auth.ts',
    ]);
  });

  it('names the peer for each, so a change has somewhere to go', () => {
    for (const [file, entry] of Object.entries(manifest.files)) {
      expect(entry.peer, file).toMatch(/^zerosumpain\/SR-/);
    }
  });
});
