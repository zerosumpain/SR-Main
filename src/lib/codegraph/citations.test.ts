import { describe, it, expect } from 'vitest';
import { resolveCitations } from './citations';

/**
 * A stand-in tree. Shapes matter more than size: a four-file directory, a big
 * one, a route family, and two files sharing a basename.
 */
const TRACKED = [
  'src/lib/connectors/monitor.ts',
  'src/lib/connectors/probes.ts',
  'src/lib/connectors/summary.ts',
  'src/lib/connectors/types.ts',
  'src/lib/secrets/registry.ts',
  'src/lib/secrets/credential-requests.ts',
  'src/lib/secrets/pending-creates.ts',
  'src/lib/jkai/orchestrator.ts',
  'src/lib/jkai/types.ts',
  'src/lib/components/A.svelte',
  'src/lib/components/B.svelte',
  'src/lib/components/C.svelte',
  'src/lib/components/D.svelte',
  'src/lib/components/E.svelte',
  'src/lib/components/F.svelte',
  'src/lib/components/G.svelte',
  'src/lib/utils/index.ts',
  'src/routes/admin/connections/+page.svelte',
  'src/routes/admin/connections/gmail/+page.svelte',
  'src/routes/api/jkai/codegraph/query/+server.ts',
  'scripts/codegraph-query.mjs',
];

describe('the lanes a memory note actually writes in', () => {
  it('still takes a full repo-relative path', () => {
    expect(resolveCitations('see src/lib/secrets/registry.ts for the binding', TRACKED)).toEqual([
      'src/lib/secrets/registry.ts',
    ]);
  });

  it('resolves a $lib alias, with or without the extension', () => {
    expect(resolveCitations('`$lib/secrets/credential-requests.ts` holds the specs', TRACKED)).toEqual([
      'src/lib/secrets/credential-requests.ts',
    ]);
    expect(resolveCitations('the writer in $lib/jkai/orchestrator does this', TRACKED)).toEqual([
      'src/lib/jkai/orchestrator.ts',
    ]);
    expect(resolveCitations('helpers live in $lib/utils', TRACKED)).toEqual(['src/lib/utils/index.ts']);
  });

  it('treats a SMALL directory as its files, and a large one as nothing', () => {
    // `$lib/connectors/` is four files and naming it plainly means all four.
    expect(resolveCitations('health lives in `$lib/connectors/`', TRACKED).sort()).toEqual([
      'src/lib/connectors/monitor.ts',
      'src/lib/connectors/probes.ts',
      'src/lib/connectors/summary.ts',
      'src/lib/connectors/types.ts',
    ]);
    // `$lib/components/` is seven here and hundreds in the repo. Citing those
    // would attach one note to a tenth of the tree, and every query touching
    // any component would return it.
    expect(resolveCitations('styled like `$lib/components/`', TRACKED)).toEqual([]);
  });

  it('resolves a site path to the file that serves it', () => {
    expect(resolveCitations('the dashboard at /admin/connections/gmail broke', TRACKED)).toEqual([
      'src/routes/admin/connections/gmail/+page.svelte',
    ]);
    expect(resolveCitations('POST /api/jkai/codegraph/query returns the block', TRACKED)).toEqual([
      'src/routes/api/jkai/codegraph/query/+server.ts',
    ]);
  });

  it('resolves a bare filename only when it lands on exactly one file', () => {
    expect(resolveCitations('`monitor.ts` polls every 45s', TRACKED)).toEqual([
      'src/lib/connectors/monitor.ts',
    ]);
    // `types.ts` matches two here and 39 in the repo — a wrong precedent reads
    // as authoritative, so it is declined rather than guessed at.
    expect(resolveCitations('the shape is in `types.ts`', TRACKED)).toEqual([]);
    // …unless the note names the directory itself.
    expect(resolveCitations('in src/lib/jkai/ the shape is in `types.ts`', TRACKED)).toEqual([
      'src/lib/jkai/types.ts',
    ]);
  });

  it('never invents a path that is not tracked', () => {
    expect(resolveCitations('$lib/nope/gone.ts and /admin/imaginary and ghost.ts', TRACKED)).toEqual([]);
  });

  it('dedupes across lanes and caps the total', () => {
    const text = 'src/lib/connectors/probes.ts is `probes.ts`, in `$lib/connectors/`';
    const out = resolveCitations(text, TRACKED);
    expect(out.filter((p) => p === 'src/lib/connectors/probes.ts')).toHaveLength(1);
    expect(resolveCitations('`$lib/connectors/`', TRACKED, 2)).toHaveLength(2);
  });

  it('links the notes that motivated this', () => {
    /*
     * Condensed from project_connector_health and project_credential_modal —
     * two notes that cite no full path and were therefore attached to zero
     * nodes, invisible to any build touching connectors or credentials.
     */
    const connectorNote =
      'Probes live in `$lib/connectors/`. The dashboard is `/admin/connections`, ' +
      'and `monitor.ts` refuses to run outside prod without CONNECTOR_MONITOR_ALLOW_DEV=1. ' +
      'Never repeat a stored status column back as truth.';
    const out = resolveCitations(connectorNote, TRACKED);
    expect(out).toContain('src/lib/connectors/monitor.ts');
    expect(out).toContain('src/lib/connectors/probes.ts');
    expect(out).toContain('src/routes/admin/connections/+page.svelte');

    const credentialNote =
      'Specs in `$lib/secrets/credential-requests.ts`; pending writes in ' +
      '`$lib/secrets/pending-creates.ts`. The register is `$lib/secrets/registry.ts`.';
    expect(resolveCitations(credentialNote, TRACKED).sort()).toEqual([
      'src/lib/secrets/credential-requests.ts',
      'src/lib/secrets/pending-creates.ts',
      'src/lib/secrets/registry.ts',
    ]);
  });
});
