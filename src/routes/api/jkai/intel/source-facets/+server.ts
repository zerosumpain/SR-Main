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
import { isMaintenanceAuthorized } from '$lib/server/maintenance-auth';
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

  // The analysed graph excludes artefacts, so a run that flagged one has
  // changed every downstream answer — clustering, centrality, insights.
  if (!dryRun && flagged.length) invalidateGraphAnalysis();

  return {
    seededDomainRules,
    notes: { total: rows.length, updated, byKind },
    artefacts: { flagged, alreadyFlagged, notFound },
  };
}

export const GET: RequestHandler = async () => json({ dryRun: true, ...(await run(true)) });

export const POST: RequestHandler = async ({ request, locals }) => {
  // Owner session from a browser, or the maintenance secret for a one-off run
  // from the box — the same arrangement /api/jkai/intel/backfill uses.
  if (!(await isMaintenanceAuthorized(request, locals))) {
    return json({ error: 'not authorised' }, { status: 403 });
  }
  return json({ dryRun: false, ...(await run(false)) });
};
