// Dossiers — the case file for one line of enquiry.
//
//   GET  ?status=open|parked|closed|all   the case files, newest activity first
//   POST { title, … }                     open a new one
//
// The graph answers "what is connected to what". A dossier answers the question
// that actually gets asked of it: "what am I currently working on, and what have
// I already found?" — which is why the counts come back with the list. A case
// file with no pinned items is an intention, not an enquiry, and the list says so.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelDossierItems, intelDossiers } from '$lib/db/schema';
import { desc, eq, inArray, like, sql } from 'drizzle-orm';

// Deliberately NOT exported: a non-handler export from a +server.ts breaks the
// route at runtime (see reference_sveltekit_server_exports).
const DOSSIER_STATUSES = ['open', 'parked', 'closed'] as const;

const MAX_TITLE = 200;
const MAX_SUMMARY = 4000;
const MAX_QUESTIONS = 40;
const MAX_QUESTION_LENGTH = 400;

function readStatus(value: unknown, fallback: string | null = null): string | null {
  if (value == null || value === '') return fallback;
  const status = String(value).trim().toLowerCase();
  if (!(DOSSIER_STATUSES as readonly string[]).includes(status)) {
    throw error(400, `status must be one of ${DOSSIER_STATUSES.join(', ')}`);
  }
  return status;
}

function readQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((q) => String(q ?? '').trim().slice(0, MAX_QUESTION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_QUESTIONS);
}

/** Slug body: lowercase, hyphenated, never empty. */
function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return base || 'dossier';
}

/**
 * A free slug for `title`.
 *
 * `intel_dossiers.slug` is uniquely indexed, so two case files opened with the
 * same title would otherwise collide with a 500. One read of the neighbouring
 * slugs is enough to pick the next free suffix.
 */
async function freeSlug(title: string): Promise<string> {
  const base = slugify(title);
  const taken = new Set(
    (
      await db
        .select({ slug: intelDossiers.slug })
        .from(intelDossiers)
        .where(like(intelDossiers.slug, `${base}%`))
    ).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/** Item counts per dossier, in one round trip rather than one per row. */
async function countsFor(dossierIds: string[]): Promise<Map<string, { items: number; entities: number }>> {
  const out = new Map<string, { items: number; entities: number }>();
  if (!dossierIds.length) return out;

  const rows = await db
    .select({
      dossierId: intelDossierItems.dossierId,
      items: sql<number>`count(*)::int`.as('items'),
      // Parenthesised on purpose: a cast written straight after FILTER(...) is
      // ambiguous to the parser.
      entities: sql<number>`(count(*) filter (where ${intelDossierItems.kind} = 'entity'))::int`.as('entities'),
    })
    .from(intelDossierItems)
    .where(inArray(intelDossierItems.dossierId, dossierIds))
    .groupBy(intelDossierItems.dossierId);

  for (const r of rows) out.set(r.dossierId, { items: Number(r.items), entities: Number(r.entities) });
  return out;
}

export const GET: RequestHandler = async ({ url }) => {
  const statusParam = url.searchParams.get('status');
  const status = statusParam === 'all' ? null : readStatus(statusParam);

  const rows = await db
    .select()
    .from(intelDossiers)
    .where(status ? eq(intelDossiers.status, status) : undefined)
    .orderBy(desc(intelDossiers.updatedAt))
    .limit(200);

  const counts = await countsFor(rows.map((r) => r.id));

  return json({
    dossiers: rows.map((d) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
      summary: d.summary,
      status: d.status,
      openQuestions: d.openQuestions ?? [],
      itemCount: counts.get(d.id)?.items ?? 0,
      entityCount: counts.get(d.id)?.entities ?? 0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE);
  if (!title) throw error(400, 'title is required');

  const [row] = await db
    .insert(intelDossiers)
    .values({
      slug: await freeSlug(title),
      title,
      summary: body.summary ? String(body.summary).slice(0, MAX_SUMMARY) : null,
      standingInstructions: body.standingInstructions
        ? String(body.standingInstructions).slice(0, MAX_SUMMARY)
        : null,
      lensId: body.lensId ? String(body.lensId) : null,
      status: readStatus(body.status, 'open') as string,
      openQuestions: readQuestions(body.openQuestions),
    })
    .returning();

  return json({ dossier: { ...row, itemCount: 0, entityCount: 0 } }, { status: 201 });
};

/**
 * Bulk close/park/reopen from the index, so tidying up a stale list is not
 * one round trip per case file.
 */
export const PATCH: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean);
  if (!ids.length) throw error(400, 'ids is required');

  const status = readStatus(body.status);
  if (!status) throw error(400, 'status is required');

  const updated = await db
    .update(intelDossiers)
    .set({ status, updatedAt: new Date() })
    .where(inArray(intelDossiers.id, ids))
    .returning({ id: intelDossiers.id });

  return json({ ok: true, affected: updated.length });
};
