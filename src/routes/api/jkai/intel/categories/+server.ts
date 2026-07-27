// ER categories — the labels put on Drive folders and carried onto the intel
// they produce. Distinct from `intel_entity_types`, which say what a node IS;
// a category says where the knowledge CAME FROM.
//
//   GET     every category, with how many intel notes currently carry it
//   POST    create (or rename/recolour an existing one by id)
//   DELETE  remove it, unhook it from every folder, and re-sync affected notes
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelCategories, intelNotes } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { categorySlug } from '$lib/jkai/intel/source-policy';
import { deleteCategory } from '$lib/jkai/intel/source-policy.server';

const MAX_NAME = 60;
const MAX_DESCRIPTION = 400;

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(intelCategories).orderBy(intelCategories.name);

  // Usage is counted from the notes rather than the folders: a folder setting
  // that has never been extracted from is not evidence the category is in play.
  const usage = await db.execute(sql`
    SELECT slug, COUNT(*)::int AS note_count
    FROM intel_notes, jsonb_array_elements_text(categories) AS slug
    GROUP BY slug
  `);
  const counts = new Map<string, number>(
    (usage.rows as Array<Record<string, unknown>>).map((r) => [
      String(r.slug),
      Number(r.note_count ?? 0),
    ]),
  );

  return json({
    categories: rows.map((c) => ({ ...c, noteCount: counts.get(c.slug) ?? 0 })),
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? '').trim().slice(0, MAX_NAME);
  if (!name) return json({ error: 'name is required' }, { status: 400 });

  const description =
    typeof body.description === 'string' ? body.description.slice(0, MAX_DESCRIPTION) : null;
  const color = typeof body.color === 'string' && body.color.trim() ? body.color.trim() : '#7dd3fc';

  if (body.id) {
    // Rename/recolour only — the slug is deliberately immutable, because it is
    // the key already written onto every note this category has ever tagged.
    const [updated] = await db
      .update(intelCategories)
      .set({ name, description, color })
      .where(eq(intelCategories.id, String(body.id)))
      .returning();
    if (!updated) return json({ error: 'not found' }, { status: 404 });
    return json({ category: updated });
  }

  const slug = categorySlug(name);
  if (!slug) return json({ error: 'name must contain letters or numbers' }, { status: 400 });

  const [existing] = await db
    .select()
    .from(intelCategories)
    .where(eq(intelCategories.slug, slug))
    .limit(1);
  if (existing) return json({ category: existing, existed: true });

  const [created] = await db
    .insert(intelCategories)
    .values({ slug, name, description, color })
    .returning();
  return json({ category: created });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, { status: 400 });
  await deleteCategory(id);
  return json({ ok: true });
};
