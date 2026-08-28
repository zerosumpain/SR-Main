/**
 * Copy a run's material into /drive, under `research/<topic>/`.
 *
 * POST `{ sourceIds?: string[] }` — omit `sourceIds` to take everything the run
 * classified as key material (the sources that produced facts, plus the papers,
 * reports and datasets that are substantial on sight).
 *
 * Sequential on purpose. Twelve parallel downloads of PDFs from a university
 * host is a good way to be rate-limited, and this runs while somebody watches a
 * button, not in a batch job.
 *
 * Owner-gated by the hook: nothing under /api/research is on the public list.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, sources, facts } from '$lib/db/schema';
import { count, eq } from 'drizzle-orm';
import { rankSources } from '$lib/deepdive/media-type';
import { runWithResearchMeter } from '$lib/context/research-meter';
import {
  driveFileStem,
  ensureResearchFolderPolicy,
  existingStems,
  researchFolder,
  saveSourceToDrive,
  type SaveOutcome,
} from '$lib/deepdive/to-drive';

/** One request's ceiling. A run can hold eighty sources; saving all of them on
 *  a single click is minutes of downloads and not what anyone means by it. */
const MAX_PER_REQUEST = 25;

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const requested = Array.isArray(body.sourceIds)
    ? (body.sourceIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : null;

  const [session] = await db
    .select({ id: researchSessions.id, topic: researchSessions.topic })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);
  if (!session) return json({ error: 'No such research run.' }, { status: 404 });

  const [srcRows, factsBySource] = await Promise.all([
    db
      .select({
        id: sources.id,
        url: sources.url,
        title: sources.title,
        snippet: sources.snippet,
        domain: sources.domain,
        credibilityScore: sources.credibilityScore,
        credibilityType: sources.credibilityType,
        // Keeps "save the key material" saving exactly what the page called key
        // material, including a grounded answer's citations.
        category: sources.category,
      })
      .from(sources)
      .where(eq(sources.sessionId, params.id)),
    db
      .select({ sourceId: facts.sourceId, n: count() })
      .from(facts)
      .where(eq(facts.sessionId, params.id))
      .groupBy(facts.sourceId),
  ]);

  const factCount = new Map(factsBySource.map((r) => [r.sourceId, Number(r.n)]));
  // The same ranking the page shows, so "save the key material" saves exactly
  // what the page called key material — not a second, quietly different rule.
  const ranked = rankSources(
    srcRows.map((s) => ({ ...s, factCount: factCount.get(s.id) ?? 0 })),
  );

  const chosen = requested
    ? ranked.filter((s) => requested.includes(s.id))
    : ranked.filter((s) => s.keyMaterial);

  if (!chosen.length) {
    return json({ error: 'Nothing to save — this run has no key material.' }, { status: 409 });
  }

  const folder = researchFolder(session.topic);
  const take = chosen.slice(0, MAX_PER_REQUEST);

  /**
   * Metered against the run.
   *
   * Saving a web page goes through Tavily Extract, which bills credits — so
   * without this the archive step would spend the monthly allowance invisibly,
   * which is precisely the blindness the spend panel exists to end. The credits
   * were spent on this run's sources, so they belong on this run's meter.
   */
  const results: SaveOutcome[] = await runWithResearchMeter(params.id, async () => {
    const out: SaveOutcome[] = [];
    for (const source of take) {
      out.push(await saveSourceToDrive(source, session.topic, folder));
    }
    return out;
  });

  // After the files, not before: the policy sync walks what is beneath the path,
  // so running it last means the files just written are included in the sweep.
  try {
    await ensureResearchFolderPolicy(folder);
  } catch (err) {
    console.error('[research] drive folder policy sync failed:', err);
  }

  return json({
    ok: true,
    folder,
    saved: results.filter((r) => r.status === 'saved').length,
    alreadyThere: results.filter((r) => r.status === 'already-there').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: chosen.length - take.length,
    results,
  });
};

/** Which of this run's sources are already in /drive, for the initial render. */
export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ topic: researchSessions.topic })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);
  if (!session) return json({ error: 'No such research run.' }, { status: 404 });

  const folder = researchFolder(session.topic);
  const stems = await existingStems(folder);

  const rows = await db
    .select({ id: sources.id, url: sources.url, title: sources.title, domain: sources.domain })
    .from(sources)
    .where(eq(sources.sessionId, params.id));

  return json({
    folder,
    savedSourceIds: rows.filter((r) => stems.has(driveFileStem(folder, r))).map((r) => r.id),
  });
};
