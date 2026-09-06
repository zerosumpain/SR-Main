import { pgTextArray } from '$lib/db/sql-array';
import { db, type DbExecutor } from '$lib/db';
import { sql } from 'drizzle-orm';
import { invalidateGraphAnalysis } from './analytics/load';
export type TaxonomyKind = 'type' | 'category';
export type TaxonomyAction = 'merge' | 'broader' | 'related' | 'reclassify';
type SavedRow = { table: string; id: string; field: string; before: unknown; after: unknown };
const TABLES = new Set(['intel_entities', 'intel_notes', 'drive_folder_settings', 'intel_entity_types']);
const FIELDS = new Set(['type_id', 'categories', 'category_ids', 'status']);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function changeField(tx: DbExecutor, table: string, id: string, field: string, value: unknown) {
  if (!TABLES.has(table) || !FIELDS.has(field)) throw new Error('Invalid taxonomy change');
  const json = field === 'categories' || field === 'category_ids';
  await tx.execute(sql`UPDATE ${sql.raw(table)} SET ${sql.raw(field)} = ${json ? sql`${JSON.stringify(value)}::jsonb` : sql`${String(value)}`} WHERE id=${id}`);
}

/** Every operation records exact assignments; undo refuses to overwrite a later edit. */
export async function changeTaxonomy(kind: TaxonomyKind, action: TaxonomyAction, fromId: string, intoId: string, memberIds?: string[]) {
  if (!['type', 'category'].includes(kind) || !['merge', 'broader', 'related', 'reclassify'].includes(action)) throw new Error('Unknown taxonomy operation');
  if (!fromId || !intoId || fromId === intoId) throw new Error('Choose two distinct taxonomy entries');
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('intel-taxonomy'))`);
    const table = kind === 'type' ? 'intel_entity_types' : 'intel_categories';
    const source = await tx.execute(sql`SELECT * FROM ${sql.raw(table)} WHERE id IN (${fromId}, ${intoId}) FOR UPDATE`);
    const from = source.rows.find(r => r.id === fromId), into = source.rows.find(r => r.id === intoId);
    if (!from || !into) throw new Error('Taxonomy entry not found');
    if (kind === 'type' && into.status !== 'active') throw new Error('The destination type must be active');
    const changes: SavedRow[] = [];
    let linkId: string | null = null;
    if (action === 'broader' || action === 'related') {
      if (action === 'broader') {
        const cycle = await tx.execute(sql`WITH RECURSIVE parents(id) AS (
          SELECT ${intoId}::text UNION SELECT l.into_id FROM intel_taxonomy_links l JOIN parents p ON l.from_id=p.id WHERE l.kind=${kind} AND l.relation='broader'
        ) SELECT id FROM parents WHERE id=${fromId}`);
        if (cycle.rows.length) throw new Error('This hierarchy would create a cycle');
      }
      const link = await tx.execute(sql`INSERT INTO intel_taxonomy_links(kind, from_id, into_id, relation) VALUES (${kind}, ${fromId}, ${intoId}, ${action}) ON CONFLICT DO NOTHING RETURNING id`);
      if (!link.rows.length) throw new Error('This relationship already exists');
      linkId = String(link.rows[0].id);
    } else {
      if (action === 'reclassify' && (!memberIds?.length || memberIds.length > 200)) throw new Error('Select 1–200 members to reclassify');
      const members = kind === 'type'
        ? await tx.execute(sql`SELECT id, type_id AS value FROM intel_entities WHERE type_id=${fromId} ${action === 'reclassify' ? sql`AND id=ANY(${pgTextArray(memberIds!)}::text[])` : sql``} FOR UPDATE`)
        : await tx.execute(sql`SELECT id, categories AS value FROM intel_notes WHERE categories ? ${String(from.slug)} ${action === 'reclassify' ? sql`AND id=ANY(${pgTextArray(memberIds!)}::text[])` : sql``} FOR UPDATE`);
      if (action === 'reclassify' && members.rows.length !== new Set(memberIds).size) throw new Error('Selected members no longer belong to the source');
      for (const row of members.rows) {
        const after = kind === 'type' ? intoId : [...new Set((row.value as string[]).map(v => v === from.slug ? String(into.slug) : v))];
        changes.push({ table: kind === 'type' ? 'intel_entities' : 'intel_notes', id: String(row.id), field: kind === 'type' ? 'type_id' : 'categories', before: row.value, after });
      }
      if (action === 'merge' && kind === 'category') {
        const folders = await tx.execute(sql`SELECT id, category_ids FROM drive_folder_settings WHERE category_ids ? ${fromId} FOR UPDATE`);
        for (const row of folders.rows) changes.push({ table: 'drive_folder_settings', id: String(row.id), field: 'category_ids', before: row.category_ids,
          after: [...new Set((row.category_ids as string[]).map(v => v === fromId ? intoId : v))] });
      }
      if (action === 'merge' && kind === 'type') changes.push({ table, id: fromId, field: 'status', before: from.status, after: 'retired' });
      for (const change of changes) await changeField(tx, change.table, change.id, change.field, change.after);
      if (action === 'merge' && kind === 'category') await tx.execute(sql`DELETE FROM intel_categories WHERE id=${fromId}`);
    }
    const snapshot = { changes, from, into, linkId };
    const inserted = await tx.execute(sql`INSERT INTO intel_taxonomy_changes(kind, action, from_id, into_id, snapshot)
      VALUES (${kind}, ${action}, ${fromId}, ${intoId}, ${JSON.stringify(snapshot)}::jsonb) RETURNING id`);
    return { id: String(inserted.rows[0].id), moved: changes.filter(c => c.table === 'intel_entities').length,
      notesRetagged: changes.filter(c => c.table === 'intel_notes').length, foldersRetagged: changes.filter(c => c.table === 'drive_folder_settings').length };
  });
  invalidateGraphAnalysis();
  return result;
}

export async function undoTaxonomy(id: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('intel-taxonomy'))`);
    const result = await tx.execute(sql`SELECT * FROM intel_taxonomy_changes WHERE id=${id} AND undone_at IS NULL FOR UPDATE`);
    const row = result.rows[0];
    if (!row) throw new Error('Change not found or already undone');
    const snapshot = row.snapshot as { changes: SavedRow[]; from: Record<string, unknown>; linkId: string | null };
    for (const change of snapshot.changes) {
      if (!TABLES.has(change.table) || !FIELDS.has(change.field)) throw new Error('Invalid saved change');
      const current = await tx.execute(sql`SELECT ${sql.raw(change.field)} AS value FROM ${sql.raw(change.table)} WHERE id=${change.id} FOR UPDATE`);
      if (!current.rows.length || !same(current.rows[0].value, change.after)) throw new Error('A member changed after this operation; review it before undoing');
    }
    if (row.kind === 'category' && row.action === 'merge') {
      await tx.execute(sql`INSERT INTO intel_categories SELECT * FROM jsonb_populate_record(NULL::intel_categories, ${JSON.stringify(snapshot.from)}::jsonb)`);
    }
    for (const change of snapshot.changes) await changeField(tx, change.table, change.id, change.field, change.before);
    if (snapshot.linkId) await tx.execute(sql`DELETE FROM intel_taxonomy_links WHERE id=${snapshot.linkId}`);
    await tx.execute(sql`UPDATE intel_taxonomy_changes SET undone_at=now() WHERE id=${id}`);
  });
  invalidateGraphAnalysis();
}

export async function taxonomyEvidence(kind: TaxonomyKind, id: string) {
  const samples = kind === 'type'
    ? await db.execute(sql`SELECT id, name AS title, summary AS excerpt FROM intel_entities WHERE type_id=${id} AND merged_into_id IS NULL ORDER BY updated_at DESC LIMIT 20`)
    : await db.execute(sql`SELECT n.id, n.title, left(coalesce(n.processed_content,n.raw_content),320) AS excerpt FROM intel_notes n JOIN intel_categories c ON n.categories ? c.slug WHERE c.id=${id} ORDER BY n.created_at DESC LIMIT 20`);
  return samples.rows;
}

/** Nightly exact-equivalence cleanup; semantic and hierarchical proposals remain reviewable. */
export async function runTaxonomyQuality(limit = 5) {
  const { listTypesWithUsage, listCategoriesWithUsage, suggestTypeMerges, suggestCategoryMerges } = await import('./taxonomy');
  const [types,categories] = await Promise.all([listTypesWithUsage(),listCategoriesWithUsage()]);
  const dismissed = await db.execute(sql`SELECT pair_key FROM intel_type_suggestion_dismissals`);
  const typeSuggestions = suggestTypeMerges(types,{dismissed:new Set(dismissed.rows.map(r=>String(r.pair_key)))});
  const categorySuggestions = suggestCategoryMerges(categories);
  let merged=0;
  const touched=new Set<string>();
  // Only matching definitions support automatic plural consolidation. Name similarity alone cannot.
  const normal=(s:string|null)=>s?.trim().toLowerCase().replace(/\s+/g,' ')??'';
  for(const s of typeSuggestions){
    if(merged>=limit)break;
    if(s.kind!=='plural'||!s.intoId||touched.has(s.fromId)||touched.has(s.intoId))continue;
    const a=types.find(t=>t.id===s.fromId),b=types.find(t=>t.id===s.intoId);
    if(!a||!b||b.status!=='active'||a.confirmed>0||a.count>20||!normal(a.description)||normal(a.description)!==normal(b.description))continue;
    const distinctions=await db.execute(sql`SELECT id FROM intel_taxonomy_links WHERE kind='type' AND (from_id IN (${a.id},${b.id}) OR into_id IN (${a.id},${b.id})) LIMIT 1`);
    if(distinctions.rows.length)continue;
    await changeTaxonomy('type','merge',a.id,b.id);merged++;touched.add(a.id);touched.add(b.id);
  }
  return { merged, typeSuggestions:typeSuggestions.length, categorySuggestions:categorySuggestions.length };
}
