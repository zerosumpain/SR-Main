// THE PACK, BUILT FOR REAL — shell off disk, assessment through the pipeline.
//
// `offline.test.ts` asserts the rules on strings this module hands it. This one
// asserts them on the artefact a reader actually receives: the compiled shell
// that `npm run build:offline` produced, wrapped around a complete thirteen-stage
// assessment, zipped exactly as the endpoint zips it.
//
// It is the test that notices a component acquiring a SvelteKit dependency, a
// font that stopped being embedded, or a shell left stale on disk — none of
// which a type check or a pure test can see.
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PERSONA_STAGE, type Artefact } from '$lib/policy-analysis/contracts';
import { executeStage } from '$lib/policy-analysis/pipeline';
import { ingest } from '$lib/policy-analysis/server/ingest';
import { fixtureModel } from '../../../../tests/fixtures/policy-analysis/model';
import { assessmentBundle, readOfflineShell } from '../server/bundle';
import { ownerPayload } from './payload';
import { offlineHtml } from './html';

// The shell is build output, not source, so a fresh checkout has not got it. A
// skip that names the command is more use than a red test that means "you have
// not run the build yet".
const built = existsSync('static/policy-offline/app.js') || existsSync('build/client/policy-offline/app.js');
const when = built ? describe : describe.skip;

async function assessment(): Promise<Artefact[]> {
  const all = (await ingest(readFileSync('tests/fixtures/policy-analysis/policy.txt'), 'policy.txt', 'text/plain')).artefacts;
  const signal = new AbortController().signal;
  for (let stage = 1; stage <= PERSONA_STAGE; stage++) {
    const result = await executeStage(
      { stage, title: 'Synthetic policy', jurisdiction: null, policyArea: null, context: null, artefacts: all },
      { model: async (...args) => fixtureModel(...args), research: async () => ({ artefacts: [], warnings: [] }), signal },
    );
    all.push(...result.artefacts);
  }
  return all;
}

when(built ? 'the pack a reader receives' : 'the pack a reader receives — SKIPPED, run `npm run build:offline`', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-11T09:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('is one file that asks nothing of the network', async () => {
    const artefacts = await assessment();
    const shell = await readOfflineShell();
    const payload = ownerPayload({
      title: 'Synthetic policy',
      jurisdiction: null,
      policyArea: null,
      status: 'completed',
      completedAt: new Date('2026-09-11T09:00:00.000Z'),
      documentSha256: 'c'.repeat(64),
      artefacts,
      stages: [{ ordinal: 0, name: 'Ingestion', warnings: [] }],
    });
    const html = offlineHtml(payload, shell);

    // The three ways a page reaches out, none of which work from `file://`.
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?https?:/i);
    // `url(/…)` would resolve against the filesystem root and silently 404.
    expect(html).not.toMatch(/url\(\s*['"]?\/[^/]/);

    // The compiled shell, not an empty string that would render a blank page.
    expect(shell.js.length).toBeGreaterThan(50_000);
    expect(shell.css).toContain('--font-display');
    // Every face the dashboard sets text in, carried rather than linked. Without
    // these, `--font-display` falls through to Impact.
    for (const family of ['Archivo Black', 'DM Sans', 'JetBrains Mono']) {
      expect(shell.fontCss).toContain(`font-family:'${family}'`);
    }
    expect(shell.fontCss.match(/url\(data:font\/woff2;base64,/g)).toHaveLength(3);

    // The assessment is in the file, not fetched into it.
    expect(html).toContain('"scope":"owner"');
    expect(html.length).toBeGreaterThan(shell.js.length + shell.css.length);
  }, 120_000);

  it('zips the dashboard, both documents, a manifest and a readme', async () => {
    const artefacts = await assessment();
    const payload = ownerPayload({
      title: 'Synthetic policy',
      jurisdiction: null,
      policyArea: null,
      status: 'completed',
      completedAt: new Date('2026-09-11T09:00:00.000Z'),
      artefacts,
      stages: [{ ordinal: 0, name: 'Ingestion', warnings: [] }],
    });
    const response = await assessmentBundle({ payload, meta: { title: payload.title, status: payload.status } });
    expect(response.headers.get('content-type')).toBe('application/zip');
    // The name carries the date, so two packs of the same paper do not overwrite
    // one another in a downloads folder.
    expect(response.headers.get('content-disposition')).toContain('2026-09-11.zip');

    const zip = Buffer.from(await response.arrayBuffer());
    // Central-directory filenames are stored as plain bytes; no unzip needed to
    // assert what is in the archive.
    const text = zip.toString('latin1');
    for (const entry of ['index.html', 'report.docx', 'report.md', 'MANIFEST.json', 'README.txt']) {
      expect(text).toContain(entry);
    }
    expect(zip.byteLength).toBeGreaterThan(100_000);
  }, 120_000);
});
