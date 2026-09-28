// src/lib/daydream/think/context.server.ts
//
// What a note has turned into since it was written — the fact check it
// started and the build-queue item it became — plus whether its sources can
// be re-read at all. Two indexed reads for a whole page of notes, never one
// per note. The rules over the result live in `explain.ts` (`noteStage`).

import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { sourceReads } from '../commissioning';
import { PRIVATE_TOOLS } from './tools';
import type { NoteContext } from './notes';

const inList = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

// A page of notes still renders without its context; the stage falls back to
// the verdict alone, so the failure is logged rather than thrown.
function readFailed(e: unknown): { rows: Record<string, unknown>[] } {
  console.error('[daydream] note context read failed:', e instanceof Error ? e.message : e);
  return { rows: [] };
}

/** A fact check needs at least one private source it can replay. */
export function isCheckable(evidence: unknown): boolean {
  return sourceReads(evidence, PRIVATE_TOOLS).length > 0;
}

export async function loadNoteContexts(
  notes: ReadonlyArray<{ id: string; evidence: unknown }>,
  principal = 'owner',
): Promise<Map<string, NoteContext>> {
  const out = new Map<string, NoteContext>();
  if (!notes.length) return out;
  for (const n of notes) out.set(n.id, { checkable: isCheckable(n.evidence), commission: null, build: null });
  const ids = notes.map((n) => n.id);
  const refs = ids.map((id) => `thought:${id}`);

  const [commissions, builds] = await Promise.all([
    // The newest check per note: a superseded proposal is history, not state.
    db
      .execute(
        sql`SELECT DISTINCT ON (thought_id) thought_id, id::text AS id, state
          FROM daydream_commissions
          WHERE principal_id = ${principal} AND thought_id IN (${inList(ids)})
          ORDER BY thought_id, updated_at DESC`,
      )
      .catch(readFailed),
    // A build idea's backlog item cites `thought:<id>`. A commission's own
    // backlog group cites it too, but is the check, not a build — excluded.
    db
      .execute(
        sql`SELECT DISTINCT ON (c->>'ref') c->>'ref' AS ref, r.key AS slug, r.data->>'status' AS status,
            (r.data->'grooming'->>'acceptedAt') IS NOT NULL AS accepted
          FROM datastore_records r
          JOIN datastore_collections col ON col.id = r.collection_id AND col.slug = 'improvement_backlog'
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.data->'citations') = 'array' THEN r.data->'citations' ELSE '[]'::jsonb END) c
          WHERE r.data->>'commissionId' IS NULL
            AND c->>'ref' IN (${inList(refs)})
          ORDER BY c->>'ref', r.updated_at DESC`,
      )
      .catch(readFailed),
  ]);

  for (const r of commissions.rows) {
    const ctx = out.get(String(r.thought_id));
    if (ctx) ctx.commission = { id: String(r.id), state: String(r.state) };
  }
  for (const r of builds.rows) {
    const ctx = out.get(String(r.ref).slice('thought:'.length));
    if (ctx) ctx.build = { slug: String(r.slug), status: String(r.status ?? 'open'), accepted: r.accepted === true };
  }
  return out;
}
