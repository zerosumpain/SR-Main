import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * These modules in this repository are also held, byte for byte, by an extracted
 * application. Each was duplicated rather than moved, for a reason recorded in
 * shared-with-extracted.json.
 *
 * None of them drifting breaks a build or fails another test. That is the whole
 * point of this one. The failure modes are quiet and expensive:
 *
 *   - A share capability minted by one process and rejected by the other is a
 *     link that simply stops working.
 *   - apple-health-scale holds the x100 that apple_health_metrics.value is
 *     stored in. The writer is in SR-Health now and the two readers that matter
 *     are here and PUBLIC. Divergence renders a hundred times the right step
 *     count on the front page.
 */
describe('modules shared with the extracted applications', () => {
  const manifest = JSON.parse(readFileSync('shared-with-extracted.json', 'utf8')) as {
    files: Record<string, { peer: string | string[]; sha256: string }>;
  };

  it('still match the hashes recorded when they were duplicated', () => {
    const drifted: string[] = [];
    const missing: string[] = [];
    for (const [file, entry] of Object.entries(manifest.files)) {
      // A registered module that is GONE is the likelier failure during a
      // refactor, and readFileSync throwing ENOENT here says nothing about why
      // a test nobody was thinking about suddenly broke. Name it instead.
      let contents: Buffer;
      try {
        contents = readFileSync(file);
      } catch {
        missing.push(`${file} (peer: ${entry.peer})`);
        continue;
      }
      const actual = createHash('sha256').update(contents).digest('hex');
      if (actual !== entry.sha256) drifted.push(`${file} (peer: ${entry.peer})`);
    }
    expect(
      missing,
      `these are listed in shared-with-extracted.json but no longer exist here:\n  ${missing.join('\n  ')}\n\n` +
        `If you MOVED one, update its path in shared-with-extracted.json and in the\n` +
        `matching test list, move it in the peer repository too, then run:\n` +
        `  node scripts/record-shared-modules.mjs\n` +
        `If you DELETED one because this repository no longer needs it, remove its\n` +
        `entry from both — it is not a shared module any more.`,
    ).toEqual([]);
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
      'src/lib/access/catalogue.ts',
      'src/lib/access/effective.ts',
      'src/lib/components/SiteHeader.svelte',
      'src/lib/config/owner.ts',
      'src/lib/constants/apple-health-scale.ts',
      'src/lib/constants/planner-sports.ts',
      'src/lib/datastore/audit.ts',
      'src/lib/datastore/permissions.ts',
      'src/lib/drive/namespace.ts',
      'src/lib/file-index/content.ts',
      'src/lib/file-index/describe.ts',
      'src/lib/file-index/embed.ts',
      'src/lib/file-index/hash.ts',
      'src/lib/file-index/index-status.ts',
      'src/lib/file-index/jkai-mirror.ts',
      'src/lib/file-index/search.ts',
      'src/lib/file-serving.ts',
      'src/lib/file-shares.ts',
      'src/lib/file-store/storage.ts',
      'src/lib/health-sync/types.ts',
      'src/lib/jkai/intel/source-policy.ts',
      'src/lib/llm/client.ts',
      'src/lib/llm/keys.ts',
      'src/lib/llm/pricing.ts',
      'src/lib/llm/usage-capture.ts',
      'src/lib/llm/usage-log.ts',
      'src/lib/llm/usage-meter.ts',
      'src/lib/nav/page-path.ts',
      'src/lib/nav/reach.ts',
      'src/lib/nav/site-nav.ts',
      'src/lib/secrets/crypto.ts',
      'src/lib/server/access-util.ts',
      'src/lib/server/access.ts',
      'src/lib/server/area-predicates.ts',
      'src/lib/server/health-context-contract.ts',
      'src/lib/server/health-hub-contract.ts',
      'src/lib/server/health-signals-contract.ts',
      'src/lib/server/owner.ts',
      'src/lib/server/rate-limit.ts',
      'src/lib/server/ssrf-guard.ts',
    ]);
  });

  it('names the peer for each, so a change has somewhere to go', () => {
    // A list, because the platform set — llm, secrets, datastore, the owner
    // check — is carried by BOTH extracted applications. A change there has two
    // places to go, and naming only one of them is how the other drifts.
    for (const [file, entry] of Object.entries(manifest.files)) {
      const peers = Array.isArray(entry.peer) ? entry.peer : [entry.peer];
      expect(peers.length, file).toBeGreaterThan(0);
      for (const peer of peers) expect(peer, file).toMatch(/^zerosumpain\/SR-/);
    }
  });
});
