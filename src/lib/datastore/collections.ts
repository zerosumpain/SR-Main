// $lib/datastore/collections.ts
//
// Collection lifecycle: create-if-absent (`ensureCollection`), metadata read
// (`getCollectionBySlug`, ACL-free), ACL-filtered listing, update, and delete
// (system collections are delete-protected). Permission checks funnel through
// `$lib/datastore/permissions`; every mutation is audited.

import { db } from '$lib/db';
import { sql, type SQL } from 'drizzle-orm';
import { DatastoreError } from './types';
import type {
  CollectionOptions,
  DatastoreCollection,
  PermissionSet,
} from './types';
import { assertCan, canDo, resolvePermissions } from './permissions';
import { auditDatastore } from './audit';

/** Slugs: lowercase, start alphanumeric, then alphanumeric / hyphen / underscore. */
const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

type Row = Record<string, unknown>;

function asDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

export function mapCollectionRow(r: Row): DatastoreCollection {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: (r.name as string) ?? null,
    description: (r.description as string) ?? null,
    schema: (r.schema as Record<string, unknown>) ?? null,
    defaultPermissions: (r.default_permissions as PermissionSet) ?? null,
    settings: (r.settings as DatastoreCollection['settings']) ?? null,
    isSystem: r.is_system === true,
    createdBy: (r.created_by as string) ?? null,
    createdAt: asDate(r.created_at),
    updatedAt: asDate(r.updated_at),
  };
}

function rowsOf(res: unknown): Row[] {
  return ((res as { rows?: Row[] }).rows ?? []) as Row[];
}

/** Effective collection-level capability map (for update/delete gating). */
function collectionPerms(collection: DatastoreCollection): Required<PermissionSet> {
  return resolvePermissions({ permissions: null, createdBy: collection.createdBy }, collection);
}

function validateSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new DatastoreError(
      'validation',
      `invalid collection slug "${slug}" (lowercase alphanumeric, hyphen or underscore; must start alphanumeric)`,
    );
  }
}

function jsonbParam(value: unknown): SQL {
  return value === undefined || value === null
    ? sql`NULL`
    : sql`${JSON.stringify(value)}::jsonb`;
}

/** Metadata read — no ACL. Returns null when the slug does not exist. */
export async function getCollectionBySlug(slug: string): Promise<DatastoreCollection | null> {
  const res = await db.execute(
    sql`SELECT * FROM datastore_collections WHERE slug = ${slug} LIMIT 1`,
  );
  const [row] = rowsOf(res);
  return row ? mapCollectionRow(row) : null;
}

/**
 * Create the collection if it does not exist, else return the existing one
 * unchanged (idempotent — safe to call on every boot for system collections).
 */
export async function ensureCollection(
  slug: string,
  opts: CollectionOptions,
  actor: string,
): Promise<DatastoreCollection> {
  validateSlug(slug);
  const existing = await getCollectionBySlug(slug);
  if (existing) return existing;

  const res = await db.execute(sql`
    INSERT INTO datastore_collections
      (slug, name, description, schema, default_permissions, settings, is_system, created_by)
    VALUES (
      ${slug},
      ${opts.name ?? null},
      ${opts.description ?? null},
      ${jsonbParam(opts.schema ?? null)},
      ${jsonbParam(opts.defaultPermissions ?? null)},
      ${jsonbParam(opts.settings ?? null)},
      ${opts.isSystem === true},
      ${actor}
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING *
  `);
  const [row] = rowsOf(res);
  // ON CONFLICT DO NOTHING returns no row if another caller won the race — re-read.
  const created = row ? mapCollectionRow(row) : await getCollectionBySlug(slug);
  if (!created) throw new DatastoreError('conflict', `failed to create collection "${slug}"`);
  if (row) {
    auditDatastore({
      collectionId: created.id,
      actor,
      action: 'collection_create',
      after: created,
    });
  }
  return created;
}

/** List collections the actor may read (owner sees all). */
export async function listCollections(actor: string): Promise<DatastoreCollection[]> {
  const res = await db.execute(sql`SELECT * FROM datastore_collections ORDER BY updated_at DESC`);
  return rowsOf(res)
    .map(mapCollectionRow)
    .filter((c) => canDo('read', collectionPerms(c), actor));
}

export async function updateCollection(
  slug: string,
  patch: CollectionOptions,
  actor: string,
): Promise<DatastoreCollection> {
  const before = await getCollectionBySlug(slug);
  if (!before) throw new DatastoreError('not_found', `collection "${slug}" not found`);
  assertCan('write', collectionPerms(before), actor);

  const sets: SQL[] = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
  if (patch.schema !== undefined) sets.push(sql`schema = ${jsonbParam(patch.schema)}`);
  if (patch.defaultPermissions !== undefined)
    sets.push(sql`default_permissions = ${jsonbParam(patch.defaultPermissions)}`);
  if (patch.settings !== undefined) sets.push(sql`settings = ${jsonbParam(patch.settings)}`);
  if (patch.isSystem !== undefined) sets.push(sql`is_system = ${patch.isSystem === true}`);
  sets.push(sql`updated_at = now()`);

  const res = await db.execute(sql`
    UPDATE datastore_collections SET ${sql.join(sets, sql`, `)} WHERE slug = ${slug} RETURNING *
  `);
  const [row] = rowsOf(res);
  const after = row ? mapCollectionRow(row) : before;
  auditDatastore({ collectionId: after.id, actor, action: 'collection_update', before, after });
  return after;
}

export async function deleteCollection(slug: string, actor: string): Promise<{ deleted: boolean }> {
  const before = await getCollectionBySlug(slug);
  if (!before) throw new DatastoreError('not_found', `collection "${slug}" not found`);
  if (before.isSystem) {
    throw new DatastoreError('forbidden', `collection "${slug}" is a system collection and cannot be deleted`);
  }
  assertCan('delete', collectionPerms(before), actor);

  await db.execute(sql`DELETE FROM datastore_collections WHERE id = ${before.id}`);
  auditDatastore({ collectionId: before.id, actor, action: 'collection_delete', before });
  return { deleted: true };
}
