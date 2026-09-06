import { changeTaxonomy, undoTaxonomy, taxonomyEvidence } from '$lib/jkai/intel/taxonomy-governance.server';
// The taxonomy surface's data and actions.
//
// Distinct from /api/jkai/intel/categories, which is the CRUD the Drive folder
// modal uses and which this leaves alone. This one answers the question that
// page actually asks: given 257 types and however many source categories, what
// should be folded into what?
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelTypeSuggestionDismissals } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import {
  listTypesWithUsage,
  listCategoriesWithUsage,
  loadRelationshipTypeNames,
  suggestTypeMerges,
  suggestCategoryMerges,
  mergeCategories,
  pairKeyForTypes,
} from '$lib/jkai/intel/taxonomy';
import {
  mergeEntityTypes,
  admitProposedType,
  rejectProposedType,
} from '$lib/jkai/intel/resolve/merge';

async function loadDismissals(): Promise<Set<string>> {
  const rows = await db.select({ k: intelTypeSuggestionDismissals.pairKey }).from(intelTypeSuggestionDismissals);
  return new Set(rows.map((r) => r.k));
}

export const GET: RequestHandler = async ({ url }) => {
  if (url.searchParams.has('evidence')) return json({ samples: await taxonomyEvidence(url.searchParams.get('kind') === 'category' ? 'category' : 'type', url.searchParams.get('evidence')!) });
  const history = await db.execute(sql`SELECT id, kind, action, from_id, into_id, created_at, undone_at FROM intel_taxonomy_changes ORDER BY created_at DESC LIMIT 30`);
  const links = await db.execute(sql`SELECT * FROM intel_taxonomy_links ORDER BY created_at DESC LIMIT 200`);
  const [types, categories, relationshipTypes, dismissed] = await Promise.all([
    listTypesWithUsage(),
    listCategoriesWithUsage(),
    loadRelationshipTypeNames(),
    loadDismissals(),
  ]);

  const suggestions = suggestTypeMerges(types, { relationshipTypes, dismissed });

  return json({
    history: history.rows,
    links: links.rows,
    types,
    categories,
    typeSuggestions: suggestions,
    categorySuggestions: suggestCategoryMerges(categories),
    stats: {
      total: types.length,
      active: types.filter((t) => t.status === 'active').length,
      proposed: types.filter((t) => t.status === 'proposed').length,
      retired: types.filter((t) => t.status === 'retired').length,
      // The number the old panel called "tiny types" without ever saying what
      // it meant. Two or fewer members makes a type filter useless and turns
      // the type into a magnet for anything the extractor was unsure about.
      tiny: types.filter((t) => t.status === 'active' && t.count > 0 && t.count <= 2).length,
      unused: types.filter((t) => t.count === 0).length,
      dismissed: dismissed.size,
    },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');
  if (action === 'assess') { const { assessTaxonomy } = await import('$lib/jkai/intel/taxonomy-assessment.server'); return json(await assessTaxonomy(body.kind === 'category' ? 'category' : 'type',String(body.fromId??''),String(body.intoId??''))); }
  if (action === 'undo') { await undoTaxonomy(String(body.id ?? '')); return json({ ok: true }); }
  if (action === 'relate' || action === 'reclassify') {
    const kind = body.kind === 'category' ? 'category' : 'type';
    const operation = action === 'reclassify' ? 'reclassify' : body.relation === 'broader' ? 'broader' : 'related';
    return json({ ok: true, result: await changeTaxonomy(kind, operation, String(body.fromId ?? ''), String(body.intoId ?? ''), Array.isArray(body.memberIds) ? body.memberIds.map(String) : undefined) });
  }

  if (action === 'merge-types') {
    const fromTypeId = String(body.fromTypeId ?? '');
    const intoTypeId = String(body.intoTypeId ?? '');
    if (!fromTypeId || !intoTypeId) throw error(400, 'fromTypeId and intoTypeId are required');
    if (fromTypeId === intoTypeId) throw error(400, 'cannot merge a type into itself');
    return json({ ok: true, moved: await mergeEntityTypes(fromTypeId, intoTypeId) });
  }

  // Retiring a proposal, one at a time or as the whole empty tail. `retire-all`
  // exists because 227 of them is not a list anybody clears by hand, and every
  // one of them re-enters the extraction prompt as a legitimate option until it
  // goes.
  if (action === 'retire-type' || action === 'retire-many') {
    const ids = action === 'retire-type'
      ? [String(body.typeId ?? '')]
      : (Array.isArray(body.typeIds) ? body.typeIds.map(String) : []);
    if (!ids.length || ids.some((id) => !id)) throw error(400, 'typeId(s) required');
    if (ids.length > 500) throw error(400, 'at most 500 types per request');

    // `rejectProposedType` retires the type whether or not anything is filed
    // under it, and an entity pointing at a retired type disappears from every
    // type filter without disappearing from the graph. So the guard lives here:
    // a bare retire is only allowed for a type nothing uses, and a type with
    // members needs somewhere for them to go.
    const intoTypeId = typeof body.intoTypeId === 'string' && body.intoTypeId ? body.intoTypeId : undefined;
    const usage = new Map((await listTypesWithUsage()).map((t) => [t.id, t]));

    const retired: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      const t = usage.get(id);
      if (!t) {
        failed.push({ id, reason: 'no such type' });
        continue;
      }
      if (t.count > 0 && !intoTypeId) {
        failed.push({ id, reason: `${t.count} entities are filed under "${t.name}" — choose a type to move them to` });
        continue;
      }
      try {
        await rejectProposedType(id, intoTypeId);
        retired.push(id);
      } catch (err) {
        failed.push({ id, reason: err instanceof Error ? err.message : 'retire failed' });
      }
    }
    return json({ ok: true, retired: retired.length, failed });
  }

  if (action === 'admit-type') {
    const typeId = String(body.typeId ?? '');
    if (!typeId) throw error(400, 'typeId is required');
    return json({ ok: true, result: await admitProposedType(typeId) });
  }

  // A suggestion the analyst has waved away. Without this the page recomputes
  // its suggestions from scratch on every load, so "no, policy and legislation
  // are different things" would come back on the next visit and every visit
  // after it — the same defect the entity queue had, one level up.
  if (action === 'dismiss-suggestion') {
    const fromTypeId = String(body.fromTypeId ?? '');
    const intoTypeId = typeof body.intoTypeId === 'string' && body.intoTypeId ? body.intoTypeId : null;
    if (!fromTypeId) throw error(400, 'fromTypeId is required');
    const key = intoTypeId ? pairKeyForTypes(fromTypeId, intoTypeId) : `retire:${fromTypeId}`;
    await db
      .insert(intelTypeSuggestionDismissals)
      .values({ pairKey: key })
      .onConflictDoNothing({ target: intelTypeSuggestionDismissals.pairKey });
    return json({ ok: true });
  }

  if (action === 'undismiss-all') {
    await db.execute(sql`DELETE FROM intel_type_suggestion_dismissals`);
    return json({ ok: true });
  }

  if (action === 'merge-categories') {
    const fromId = String(body.fromId ?? '');
    const intoId = String(body.intoId ?? '');
    if (!fromId || !intoId) throw error(400, 'fromId and intoId are required');
    try {
      return json({ ok: true, result: await mergeCategories(fromId, intoId) });
    } catch (err) {
      throw error(400, err instanceof Error ? err.message : 'merge failed');
    }
  }

  throw error(400, `unknown action "${action}"`);
};
