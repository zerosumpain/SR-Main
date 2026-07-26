// SERVER-ONLY half of lenses: CRUD and live-query evaluation.
//
// Split from ./lenses.ts because that module is imported by
// timeline/+page.svelte. See the note there for why a dynamic import was not
// enough of a boundary.
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { intelEntities, intelLenses, type IntelLens } from '$lib/db/schema';
import {
  buildLensFilter,
  describeLensFilters,
  lensGrowth,
  nextFreeSlug,
  normaliseLensFilters,
  slugify,
  MAX_FACET_VALUES,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_INSTRUCTIONS_LENGTH,
  type LensFilters,
  type LensGrowth,
} from './lenses';

// ── CRUD (dynamic `$lib/db` import — see the file header) ────────────────────

export interface StoredLens {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  filters: LensFilters;
  standingInstructions: string | null;
  isDefault: boolean;
  cron: string | null;
  lastRunAt: Date | null;
  lastCount: number | null;
  /** Derived, so the picker can show what a lens narrows without re-deriving. */
  summary: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LensInput {
  name?: unknown;
  description?: unknown;
  filters?: unknown;
  standingInstructions?: unknown;
  isDefault?: unknown;
  cron?: unknown;
}

function toStored(row: IntelLens): StoredLens {
  const filters = normaliseLensFilters(row.filters);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    filters,
    standingInstructions: row.standingInstructions,
    isDefault: row.isDefault,
    cron: row.cron,
    lastRunAt: row.lastRunAt,
    lastCount: row.lastCount,
    summary: describeLensFilters(filters),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function trimmed(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

export async function listLenses(): Promise<StoredLens[]> {
  const { db } = await import('$lib/db');
  const rows = await db
    .select()
    .from(intelLenses)
    .orderBy(desc(intelLenses.isDefault), asc(intelLenses.name))
    .limit(200);
  return rows.map(toStored);
}

/** Fetch by id or slug — a lens is addressed both ways (URL vs API). */
export async function getLens(idOrSlug: string): Promise<StoredLens | null> {
  const { db } = await import('$lib/db');
  const key = String(idOrSlug ?? '').trim();
  if (!key) return null;
  const [row] = await db
    .select()
    .from(intelLenses)
    .where(or(eq(intelLenses.id, key), eq(intelLenses.slug, key)))
    .limit(1);
  return row ? toStored(row) : null;
}

/** Exactly one lens is the default; setting a new one clears the old. */
async function clearOtherDefaults(exceptId: string | null): Promise<void> {
  const { db } = await import('$lib/db');
  await db
    .update(intelLenses)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(exceptId ? and(eq(intelLenses.isDefault, true), sql`${intelLenses.id} <> ${exceptId}`) : eq(intelLenses.isDefault, true));
}

export async function createLens(input: LensInput): Promise<StoredLens> {
  const { db } = await import('$lib/db');
  const name = trimmed(input.name, MAX_NAME_LENGTH);
  if (!name) throw new Error('name is required');

  const base = slugify(name);
  const taken = (
    await db.select({ slug: intelLenses.slug }).from(intelLenses).where(ilike(intelLenses.slug, `${base}%`))
  ).map((r) => r.slug);

  const isDefault = Boolean(input.isDefault);
  if (isDefault) await clearOtherDefaults(null);

  const [row] = await db
    .insert(intelLenses)
    .values({
      slug: nextFreeSlug(base, taken),
      name,
      description: trimmed(input.description, MAX_DESCRIPTION_LENGTH),
      filters: normaliseLensFilters(input.filters) as unknown as Record<string, unknown>,
      standingInstructions: trimmed(input.standingInstructions, MAX_INSTRUCTIONS_LENGTH),
      isDefault,
      cron: trimmed(input.cron, 120),
    })
    .returning();

  return toStored(row);
}

export async function updateLens(id: string, patch: LensInput): Promise<StoredLens | null> {
  const { db } = await import('$lib/db');
  const values: Record<string, unknown> = { updatedAt: new Date() };

  if (patch.name !== undefined) {
    const name = trimmed(patch.name, MAX_NAME_LENGTH);
    if (!name) throw new Error('name cannot be empty');
    values.name = name;
  }
  if (patch.description !== undefined) values.description = trimmed(patch.description, MAX_DESCRIPTION_LENGTH);
  if (patch.filters !== undefined) values.filters = normaliseLensFilters(patch.filters);
  if (patch.standingInstructions !== undefined) {
    values.standingInstructions = trimmed(patch.standingInstructions, MAX_INSTRUCTIONS_LENGTH);
  }
  if (patch.cron !== undefined) values.cron = trimmed(patch.cron, 120);
  if (patch.isDefault !== undefined) {
    values.isDefault = Boolean(patch.isDefault);
    if (values.isDefault) await clearOtherDefaults(id);
  }

  const [row] = await db.update(intelLenses).set(values).where(eq(intelLenses.id, id)).returning();
  return row ? toStored(row) : null;
}

export async function deleteLens(id: string): Promise<boolean> {
  const { db } = await import('$lib/db');
  const deleted = await db
    .delete(intelLenses)
    .where(eq(intelLenses.id, id))
    .returning({ id: intelLenses.id });
  return deleted.length > 0;
}

// ── Applying a lens ──────────────────────────────────────────────────────────

/**
 * The entity ids a lens currently selects.
 *
 * SQL narrows first; the community facet is applied afterwards against the
 * cached Louvain partition, because clusters are computed, not stored. Only
 * loading the analysis when a community filter is actually set keeps the common
 * case a single query.
 */
export async function lensEntityIds(filters: LensFilters): Promise<string[]> {
  const { db } = await import('$lib/db');
  const plan = buildLensFilter(filters);

  const rows = await db
    .select({ id: intelEntities.id })
    .from(intelEntities)
    .where(and(...plan.conditions));

  let ids = rows.map((r) => r.id);

  if (plan.needsAnalysis) {
    const { getGraphAnalysis } = await import('./analytics/load');
    const { community } = await getGraphAnalysis();
    const wanted = new Set(plan.communityIds);
    ids = ids.filter((id) => {
      const c = community.membership.get(id);
      return c !== undefined && wanted.has(c);
    });
  }

  return ids;
}

export interface LensCheck extends LensGrowth {
  lensId: string;
  slug: string;
  name: string;
  /** Most recently added matches — context for whoever reports the growth. */
  newest: Array<{ id: string; name: string }>;
  checkedAt: Date;
}

/**
 * Evaluate a live query.
 *
 * Counts the current matches, compares against the count stored by the previous
 * run and records the new one. Deliberately does NOT raise an insight: the
 * watchlist owns what a delta means and how loudly to say it, and a module that
 * both measures and alarms cannot be re-run to check a number.
 */
export async function runLensCheck(lensId: string): Promise<LensCheck | null> {
  const { db } = await import('$lib/db');
  const lens = await getLens(lensId);
  if (!lens) return null;

  const ids = await lensEntityIds(lens.filters);
  const growth = lensGrowth(ids.length, lens.lastCount);
  const checkedAt = new Date();

  const newest = ids.length
    ? await db
        .select({ id: intelEntities.id, name: intelEntities.name })
        .from(intelEntities)
        .where(inArray(intelEntities.id, ids.slice(0, MAX_FACET_VALUES * 10)))
        .orderBy(desc(intelEntities.createdAt))
        .limit(5)
    : [];

  await db
    .update(intelLenses)
    .set({ lastCount: growth.count, lastRunAt: checkedAt, updatedAt: checkedAt })
    .where(eq(intelLenses.id, lens.id));

  return { ...growth, lensId: lens.id, slug: lens.slug, name: lens.name, newest, checkedAt };
}

/**
 * Run every lens that has a cron set — the batch half of a live query.
 *
 * `runLensCheck` only ever fired when someone hit the endpoint, so a "live"
 * query was live only while being watched. The cron string is deliberately
 * treated as a flag rather than parsed: the nightly engine is the only caller
 * and runs once a day, so honouring an arbitrary schedule would need a real
 * cron runner for no benefit at this scale. A lens wanting finer granularity
 * should be a monitor.
 *
 * Returns only lenses whose result set actually GREW — no growth is not news.
 */
export async function runDueLensChecks(): Promise<LensCheck[]> {
  const { db } = await import('$lib/db');
  const due = await db
    .select({ id: intelLenses.id })
    .from(intelLenses)
    .where(isNotNull(intelLenses.cron));

  const changes: LensCheck[] = [];
  for (const row of due) {
    try {
      const check = await runLensCheck(row.id);
      if (check?.grew) changes.push(check);
    } catch (err) {
      // One broken lens filter must not stop the rest.
      console.error('[intel:lenses] check failed for', row.id, err instanceof Error ? err.message : err);
    }
  }
  return changes;
}
