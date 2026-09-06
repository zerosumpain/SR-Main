// The taxonomy: what a node IS (`intel_entity_types`) and where knowledge CAME
// FROM (`intel_categories`).
//
// Both were governed from a panel on /jkai/intel/quality that rendered the
// whole taxonomy as a chip list and two <select>s. On production that is 257
// types — 29 active, 227 proposed, 1 retired — in a control with 257 options
// and no search, which is not a thing a person can navigate. And the only
// decision it offered was "move everything from X into Y", with no opinion at
// all about which X and which Y.
//
// This module supplies the opinion. Every suggestion carries the evidence for
// it, because a suggestion whose reasoning you cannot see is one you have to
// re-derive before you dare act on it.
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { normaliseName, significantTokens, tokenOverlap } from './resolve/match';

export interface TaxonomyType {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: 'active' | 'proposed' | 'retired';
  description: string;
  proposedRationale: string | null;
  /** Live entities carrying this type. */
  count: number;
  /** Live entities carrying it that a human has confirmed. */
  confirmed: number;
  createdAt: Date;
}

export interface TypeMergeSuggestion {
  /** The type to retire. */
  fromId: string;
  fromName: string;
  fromCount: number;
  /** The type to keep. Null for a suggestion that is a retirement, not a merge. */
  intoId: string | null;
  intoName: string | null;
  intoCount: number;
  suggestedAction?: 'merge' | 'broader' | 'related' | 'defer';
  kind: 'plural' | 'contained' | 'overlap' | 'relation' | 'empty-proposal';
  /** 0..1 — how sure the rule is. Ordering only; nothing acts on it. */
  confidence: number;
  /** One sentence a person can check. */
  reason: string;
}

// ── Suggestion rules (pure) ────────────────────────────────────────────────

/** `data_source` → `data source`; the underscore convention is not meaning. */
export function typeWords(name: string): string[] {
  return significantTokens(name.replace(/[_-]+/g, ' '));
}

/**
 * `risks` and `risk` are one type written twice — as are `policy` and
 * `policies`, which is the form the -s rule alone misses.
 *
 * Deliberately three narrow rules rather than a stemmer: a stemmer would also
 * call `status` and `statuses` a pair (correct) and `analysis` and `analyses` a
 * pair (correct) and `bus` and `buses` a pair (correct) — and then quietly
 * collapse `standard` onto `standards` when one of them is a real distinction.
 * These three cover what actually appears in a taxonomy and nothing else.
 */
export function isPluralPair(a: string, b: string): boolean {
  const [x, y] = [normaliseName(a.replace(/[_-]+/g, ' ')), normaliseName(b.replace(/[_-]+/g, ' '))];
  if (!x || !y || x === y) return false;
  const [shortSide, longSide] = x.length <= y.length ? [x, y] : [y, x];
  return (
    longSide === `${shortSide}s` ||
    longSide === `${shortSide}es` ||
    (shortSide.endsWith('y') && longSide === `${shortSide.slice(0, -1)}ies`)
  );
}

/**
 * Suggestions from the type list alone.
 *
 * Ordered by confidence, and every one names the type to RETIRE first — the
 * smaller of the pair, because moving 3 entities is a smaller mistake to undo
 * than moving 1,144.
 */
export function suggestTypeMerges(
  types: TaxonomyType[],
  opts: { relationshipTypes?: ReadonlySet<string>; dismissed?: ReadonlySet<string> } = {},
): TypeMergeSuggestion[] {
  const relationshipTypes = opts.relationshipTypes ?? new Set<string>();
  const dismissed = opts.dismissed ?? new Set<string>();
  const out: TypeMergeSuggestion[] = [];
  const live = types.filter((t) => t.status !== 'retired');

  const push = (s: TypeMergeSuggestion) => {
    const key = s.intoId ? pairKeyForTypes(s.fromId, s.intoId) : `retire:${s.fromId}`;
    if (dismissed.has(key)) return;
    out.push(s);
  };

  // 1. A proposed type whose name is a RELATIONSHIP type.
  //
  // The strongest signal on the board and the least obvious: the extractor is
  // asked for entities and for relationships in one pass, and when it coins a
  // type it sometimes hands back the edge instead of the node. On production
  // `authored`, `includes`, `same_as`, `uses_data_source`, `paid_over`,
  // `route_via` and `offers` are all sitting in the entity taxonomy, and every
  // one of them is a live relationship type as well. None of them can ever be
  // what a thing IS.
  for (const t of live) {
    if (t.status !== 'proposed') continue;
    if (!relationshipTypes.has(t.name)) continue;
    push({
      fromId: t.id,
      fromName: t.name,
      fromCount: t.count,
      intoId: null,
      intoName: null,
      intoCount: 0,
      kind: 'relation',
      confidence: 0.95,
      reason: `"${t.name}" is a relationship type, not a kind of thing — it describes an edge between two entities.`,
    });
  }

  // 2. Proposed types nothing has ever been filed under.
  //
  // 227 of them on production. A proposed type re-enters the extraction prompt
  // as a legitimate option, so an empty one is not inert — it is an invitation
  // to file the next ambiguous thing under a category nobody chose.
  for (const t of live) {
    if (t.status !== 'proposed' || t.count > 0) continue;
    if (relationshipTypes.has(t.name)) continue; // already covered, and better
    push({
      fromId: t.id,
      fromName: t.name,
      fromCount: 0,
      intoId: null,
      intoName: null,
      intoCount: 0,
      kind: 'empty-proposal',
      confidence: 0.7,
      reason: 'Proposed but unused. Retire only if the definition adds no useful distinction.',
    });
  }

  // 3–5. Pairwise, over live types only.
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const [a, b] = [live[i], live[j]];
      // Retire the smaller side; ties break on the name so the answer is stable.
      const [from, into] =
        a.count !== b.count ? (a.count < b.count ? [a, b] : [b, a]) : a.name < b.name ? [b, a] : [a, b];
      const key = pairKeyForTypes(from.id, into.id);
      if (dismissed.has(key)) continue;

      if (isPluralPair(a.name, b.name)) {
        push({
          ...frame(from, into),
          suggestedAction: 'merge',
          kind: 'plural',
          confidence: 0.9,
          reason: `"${from.name}" is the plural of "${into.name}" — the same type written twice.`,
        });
        continue;
      }

      const wa = typeWords(a.name);
      const wb = typeWords(b.name);
      if (!wa.length || !wb.length) continue;

      const setA = new Set(wa);
      const setB = new Set(wb);
      const containment =
        wa.length !== wb.length &&
        (wa.every((w) => setB.has(w)) || wb.every((w) => setA.has(w)));
      if (containment) {
        push({
          ...frame(from, into),
          suggestedAction: 'broader',
          kind: 'contained',
          confidence: 0.6,
          reason: `Every word of "${
            wa.length < wb.length ? a.name : b.name
          }" is in "${wa.length < wb.length ? b.name : a.name}" — review a broader/narrower relationship; containment does not prove equivalence.`,
        });
        continue;
      }

      const overlap = tokenOverlap(a.name.replace(/[_-]+/g, ' '), b.name.replace(/[_-]+/g, ' '));
      if (overlap >= 0.5) {
        push({
          ...frame(from, into),
          suggestedAction: 'related',
          kind: 'overlap',
          confidence: 0.4 + (overlap - 0.5) * 0.4,
          reason: `"${a.name}" and "${b.name}" share most of their words.`,
        });
      }
    }
  }

  return out.sort((x, y) => y.confidence - x.confidence || y.fromCount - x.fromCount);
}

function frame(from: TaxonomyType, into: TaxonomyType) {
  return {
    fromId: from.id,
    fromName: from.name,
    fromCount: from.count,
    intoId: into.id,
    intoName: into.name,
    intoCount: into.count,
  };
}

/** Order-independent key for a pair of type ids. */
export function pairKeyForTypes(x: string, y: string): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

// ── Loaders ────────────────────────────────────────────────────────────────

/** Every type with what is actually filed under it. */
export async function listTypesWithUsage(): Promise<TaxonomyType[]> {
  const res = await db.execute(sql`
    SELECT
      t.id, t.name, t.icon, t.color, t.status, t.description,
      t.proposed_rationale, t.created_at,
      COALESCE(u.n, 0)::int         AS n,
      COALESCE(u.confirmed, 0)::int AS confirmed
    FROM intel_entity_types t
    LEFT JOIN (
      SELECT type_id,
             COUNT(*)                                  AS n,
             COUNT(*) FILTER (WHERE confirmed)         AS confirmed
      FROM intel_entities
      WHERE merged_into_id IS NULL
      GROUP BY type_id
    ) u ON u.type_id = t.id
    ORDER BY COALESCE(u.n, 0) DESC, t.name
  `);

  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    icon: String(r.icon ?? '🔷'),
    color: String(r.color ?? '#7dd3fc'),
    status: (String(r.status ?? 'active') as TaxonomyType['status']),
    description: String(r.description ?? ''),
    proposedRationale: typeof r.proposed_rationale === 'string' ? r.proposed_rationale : null,
    count: Number(r.n ?? 0),
    confirmed: Number(r.confirmed ?? 0),
    createdAt: new Date(String(r.created_at)),
  }));
}

/** Every relationship type name in use. The evidence for the `relation` rule. */
export async function loadRelationshipTypeNames(): Promise<Set<string>> {
  const res = await db.execute(sql`SELECT DISTINCT type FROM intel_relationships WHERE type IS NOT NULL`);
  return new Set((res.rows as Array<Record<string, unknown>>).map((r) => String(r.type)));
}

export interface TaxonomyCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  /** Notes carrying this category. */
  noteCount: number;
  /** Drive folders that assign it. */
  folderCount: number;
  createdAt: Date;
}

export async function listCategoriesWithUsage(): Promise<TaxonomyCategory[]> {
  const res = await db.execute(sql`
    SELECT
      c.id, c.slug, c.name, c.description, c.color, c.created_at,
      COALESCE(n.note_count, 0)::int   AS note_count,
      COALESCE(f.folder_count, 0)::int AS folder_count
    FROM intel_categories c
    LEFT JOIN (
      SELECT slug, COUNT(*) AS note_count
      FROM intel_notes, jsonb_array_elements_text(categories) AS slug
      GROUP BY slug
    ) n ON n.slug = c.slug
    LEFT JOIN (
      SELECT cid, COUNT(*) AS folder_count
      FROM drive_folder_settings, jsonb_array_elements_text(category_ids) AS cid
      GROUP BY cid
    ) f ON f.cid = c.id
    ORDER BY c.name
  `);

  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    slug: String(r.slug ?? ''),
    name: String(r.name ?? ''),
    description: typeof r.description === 'string' ? r.description : null,
    color: String(r.color ?? '#7dd3fc'),
    noteCount: Number(r.note_count ?? 0),
    folderCount: Number(r.folder_count ?? 0),
    createdAt: new Date(String(r.created_at)),
  }));
}

export interface CategoryMergeSuggestion {
  fromId: string;
  fromName: string;
  intoId: string;
  intoName: string;
  confidence: number;
  reason: string;
}

/** The same shape of question, one level up, over source categories. */
export function suggestCategoryMerges(categories: TaxonomyCategory[]): CategoryMergeSuggestion[] {
  const out: CategoryMergeSuggestion[] = [];
  for (let i = 0; i < categories.length; i++) {
    for (let j = i + 1; j < categories.length; j++) {
      const [a, b] = [categories[i], categories[j]];
      const [from, into] = a.noteCount <= b.noteCount ? [a, b] : [b, a];
      if (isPluralPair(a.name, b.name)) {
        out.push({
          fromId: from.id,
          fromName: from.name,
          intoId: into.id,
          intoName: into.name,
          confidence: 0.9,
          reason: `"${from.name}" is the plural of "${into.name}".`,
        });
        continue;
      }
      const overlap = tokenOverlap(a.name, b.name);
      if (overlap >= 0.6) {
        out.push({
          fromId: from.id,
          fromName: from.name,
          intoId: into.id,
          intoName: into.name,
          confidence: 0.4 + (overlap - 0.6) * 0.5,
          reason: `"${a.name}" and "${b.name}" share most of their words.`,
        });
      }
    }
  }
  return out.sort((x, y) => y.confidence - x.confidence);
}

/**
 * Fold one source category into another.
 *
 * A capability that did not exist: categories could be created and deleted and
 * nothing else, so the only way to correct a near-duplicate was to delete it —
 * which unhooks it from every folder and re-syncs the notes, losing the tagging
 * rather than moving it.
 *
 * Three places carry a category and all three have to move together:
 *   - `intel_notes.categories`, a jsonb array of SLUGS
 *   - `drive_folder_settings.category_ids`, a jsonb array of IDS
 *   - the row itself
 */
export async function mergeCategories(fromId: string, intoId: string): Promise<{
  notesRetagged: number;
  foldersRetagged: number;
}> {
  const { changeTaxonomy } = await import('./taxonomy-governance.server');
  return changeTaxonomy('category', 'merge', fromId, intoId);
}
