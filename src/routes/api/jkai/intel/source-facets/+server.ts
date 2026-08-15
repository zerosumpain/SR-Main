// Backfilling the source facets onto data that predates them.
//
// Two passes, both idempotent, both safe to re-run:
//
//   email facets      classify every existing email note into
//                     correspondence / notification / bulk and record the
//                     sender domain, so the filters describe the whole mailbox
//                     rather than only what has arrived since.
//   channel artefacts flag the entities that identify the channel rather than
//                     its content — matched BY NAME, because entity ids differ
//                     between homeserv and production.
//
// An endpoint rather than a script, following /api/jkai/intel/backfill: this
// has to run against PRODUCTION, and the alternative is hand-running a script
// on the VPS, which is the class of operation this repo deliberately does not
// do. It also means `$env` resolves, which it does not under tsx.
//
//   GET   → what a run would change, without changing anything
//   POST  → run both passes
//
// Nothing is deleted. Artefacts are flagged, and the flag is honoured in one
// place (`loadSnapshot`); the email pass only adds metadata keys.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelNotes, intelEntities } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { pgTextArray } from '$lib/db/sql-array';
import { isMaintenanceAuthorized } from '$lib/server/maintenance-auth';
import { ROLLING_WINDOW_DAYS } from '$lib/jkai/intel/staleness';
import { classifyEmail } from '$lib/jkai/intel/email-kind';
import { emailDomainOverrides, seedEmailDomainRules } from '$lib/jkai/intel/email-domain-rules';
import {
  flagChannelArtefact,
  listChannelArtefacts,
  SEED_ARTEFACT_NAMES,
} from '$lib/jkai/intel/channel-artefacts';
import { invalidateGraphAnalysis } from '$lib/jkai/intel/analytics/load';

interface Outcome {
  seededDomainRules: number;
  notes: { total: number; updated: number; byKind: Record<string, number> };
  artefacts: { flagged: string[]; alreadyFlagged: string[]; notFound: string[] };
  important: ImportantOutcome;
}

interface ImportantOutcome {
  /** Threads Gmail says are important, within the ingested window. */
  matched: number;
  /** Of those, how many we hold a note for. */
  present: number;
  /** Notes this pass would stamp (or did). */
  updated: number;
  /** Notes already carrying the flag. */
  already: number;
  skipped?: string;
}

/**
 * Gmail's own IMPORTANT verdict, applied to threads already ingested.
 *
 * The label was available on every message the sweep ever fetched and was
 * dropped before the note was written, so it cannot be recovered from the
 * database — it has to be asked for again. One paged `messages.list` answers it
 * for the whole mailbox, which is why this queries by label rather than
 * re-fetching seventeen hundred threads.
 *
 * The window matches the rolling sweep's: asking Gmail about mail older than
 * anything we hold would return thread ids with no note to attach them to.
 */
async function backfillImportant(dryRun: boolean): Promise<ImportantOutcome> {
  const empty: ImportantOutcome = { matched: 0, present: 0, updated: 0, already: 0 };
  try {
    const [{ gmailService }, { gmailAccounts }] = await Promise.all([
      import('$lib/workflows/gmail/service'),
      import('$lib/db/schema'),
    ]);
    const accounts = await db
      .select()
      .from(gmailAccounts)
      .where(eq(gmailAccounts.status, 'active'));
    if (!accounts.length) return { ...empty, skipped: 'no active Gmail account' };

    const threadIds = new Set<string>();
    for (const account of accounts) {
      const ids = await gmailService.listThreadIdsMatching(
        account,
        `is:important newer_than:${ROLLING_WINDOW_DAYS}d -in:trash -in:spam`,
      );
      for (const id of ids) threadIds.add(id);
    }
    if (!threadIds.size) return { ...empty, skipped: 'Gmail returned no important threads' };

    // pgTextArray, not `ANY(${array}::text[])` — Drizzle binds a bare array as a
    // ROW constructor, which silently stops matching at two or more elements.
    const ids = [...threadIds];
    const rows = await db
      .select({ id: intelNotes.id, metadata: intelNotes.metadata })
      .from(intelNotes)
      .where(
        and(
          eq(intelNotes.source, 'email'),
          sql`${intelNotes.metadata}->>'gmailThreadId' = ANY(${pgTextArray(ids)}::text[])`,
        ),
      );

    let updated = 0;
    let already = 0;
    for (const row of rows) {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      if (metadata.important === true) {
        already++;
        continue;
      }
      updated++;
      if (dryRun) continue;
      await db
        .update(intelNotes)
        .set({ metadata: sql`${intelNotes.metadata} || '{"important":true}'::jsonb` })
        .where(eq(intelNotes.id, row.id));
    }

    return { matched: threadIds.size, present: rows.length, updated, already };
  } catch (err) {
    // The other two passes are database-only and must not be lost because Gmail
    // was unreachable or a token had expired.
    console.warn('[intel] important backfill skipped', err);
    return { ...empty, skipped: err instanceof Error ? err.message : 'Gmail unavailable' };
  }
}

async function run(dryRun: boolean): Promise<Outcome> {
  const seededDomainRules = dryRun ? 0 : await seedEmailDomainRules();
  const overrides = await emailDomainOverrides();

  const rows = await db
    .select({ id: intelNotes.id, metadata: intelNotes.metadata })
    .from(intelNotes)
    .where(eq(intelNotes.source, 'email'));

  const byKind: Record<string, number> = {};
  let updated = 0;

  for (const row of rows) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const participants = Array.isArray(metadata.participants)
      ? metadata.participants.map((p) => String(p))
      : [];
    const owner = typeof metadata.gmailAccount === 'string' ? [metadata.gmailAccount] : [];

    const result = classifyEmail(participants, owner, overrides);
    byKind[result.kind] = (byKind[result.kind] ?? 0) + 1;

    // A note that already agrees costs a read and no write, so a re-run is
    // cheap and the endpoint can be driven repeatedly without thought.
    const sameKind = metadata.emailKind === result.kind;
    const sameDomain = (metadata.senderDomain ?? null) === (result.domain ?? null);
    if (sameKind && sameDomain) continue;

    updated++;
    if (dryRun) continue;

    // Merged into the existing object rather than replacing it — gmailThreadId,
    // contentHash and sourceUrl all live in there.
    await db
      .update(intelNotes)
      .set({
        metadata: sql`${intelNotes.metadata} || ${JSON.stringify({
          emailKind: result.kind,
          ...(result.domain ? { senderDomain: result.domain } : {}),
        })}::jsonb`,
      })
      .where(eq(intelNotes.id, row.id));
  }

  const already = new Set((await listChannelArtefacts()).map((a) => a.entityId));
  const flagged: string[] = [];
  const alreadyFlagged: string[] = [];
  const notFound: string[] = [];

  for (const seed of SEED_ARTEFACT_NAMES) {
    const [entity] = await db
      .select({ id: intelEntities.id, name: intelEntities.name })
      .from(intelEntities)
      .where(and(eq(intelEntities.name, seed.name), isNull(intelEntities.mergedIntoId)))
      .limit(1);

    if (!entity) {
      notFound.push(seed.name);
      continue;
    }
    if (already.has(entity.id)) {
      alreadyFlagged.push(seed.name);
      continue;
    }
    flagged.push(seed.name);
    if (!dryRun) await flagChannelArtefact(entity.id, entity.name, seed.reason);
  }

  const important = await backfillImportant(dryRun);

  // The analysed graph excludes artefacts and reads these facets, so a run that
  // changed either has changed every downstream answer — clustering,
  // centrality, insights.
  if (!dryRun && (flagged.length || updated || important.updated)) invalidateGraphAnalysis();

  return {
    seededDomainRules,
    notes: { total: rows.length, updated, byKind },
    artefacts: { flagged, alreadyFlagged, notFound },
    important,
  };
}

// Owner session from a browser, or the maintenance secret for a one-off run
// from the box — the same arrangement /api/jkai/intel/backfill uses.
//
// Both verbs check, not just the writing one. The hooks allow-list that lets a
// secret-carrying call reach this path says the endpoint re-checks; on the VPS
// that promise is the whole control, because cloudflared makes every request
// look like loopback and the address half of that gate means nothing there.
// The dry run reports the shape of the mailbox — sender domains and counts —
// which is not something to hand out on the strength of one gate.
export const GET: RequestHandler = async ({ request, locals }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) {
    return json({ error: 'not authorised' }, { status: 403 });
  }
  return json({ dryRun: true, ...(await run(true)) });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) {
    return json({ error: 'not authorised' }, { status: 403 });
  }
  return json({ dryRun: false, ...(await run(false)) });
};
