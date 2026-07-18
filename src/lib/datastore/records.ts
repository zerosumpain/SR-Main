// $lib/datastore/records.ts
//
// Record CRUD + query + aggregate. Every mutating path enforces permissions via
// `$lib/datastore/permissions`, validates against the collection schema, honours
// payload / maxRecords guardrails, bumps the optimistic `version`, and writes a
// before/after audit image. All Postgres access goes through `db.execute(sql\`\`)`
// with parameterized fragments (precedent: src/lib/workflows/nodes/data-store.ts).

import { db } from '$lib/db';
import { sql, type SQL } from 'drizzle-orm';
import { DatastoreError } from './types';
import type {
  AggregateOptions,
  CollectionSettings,
  DatastoreCollection,
  DatastoreRecord,
  QueryFilter,
  QueryOptions,
  RecordChanges,
  RecordInput,
  RecordRef,
} from './types';
import { getCollectionBySlug } from './collections';
import { assertCan, resolvePermissions, readableSqlPredicate } from './permissions';
import { validateAgainstSchema } from './validate';
import { compileFilters, compileSort, clampLimit, clampOffset, pathLiteral } from './query';
import { auditDatastore } from './audit';

const DEFAULT_MAX_PAYLOAD_BYTES = 262144; // 256 KB
const DEFAULT_MAX_RECORDS = 50000;
const BULK_CAP = 100;

type Row = Record<string, unknown>;

function asDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}
function rowsOf(res: unknown): Row[] {
  return ((res as { rows?: Row[] }).rows ?? []) as Row[];
}

function mapRecordRow(r: Row): DatastoreRecord {
  return {
    id: String(r.id),
    collectionId: String(r.collection_id),
    key: (r.key as string) ?? null,
    data: (r.data as Record<string, unknown>) ?? {},
    permissions: (r.permissions as DatastoreRecord['permissions']) ?? null,
    version: Number(r.version ?? 1),
    createdBy: (r.created_by as string) ?? null,
    updatedBy: (r.updated_by as string) ?? null,
    createdAt: asDate(r.created_at),
    updatedAt: asDate(r.updated_at),
    expiresAt: r.expires_at ? asDate(r.expires_at) : null,
  };
}

async function getCollectionOrThrow(slug: string): Promise<DatastoreCollection> {
  const collection = await getCollectionBySlug(slug);
  if (!collection) throw new DatastoreError('not_found', `collection "${slug}" not found`);
  return collection;
}

function settingsOf(collection: DatastoreCollection): CollectionSettings {
  return collection.settings ?? {};
}

function assertPayloadWithinLimit(collection: DatastoreCollection, data: Record<string, unknown>): void {
  const max = settingsOf(collection).maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const bytes = Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8');
  if (bytes > max) {
    throw new DatastoreError('limit', `record payload ${bytes} bytes exceeds limit of ${max} bytes`);
  }
}

function assertSchemaValid(collection: DatastoreCollection, data: Record<string, unknown>): void {
  if (!collection.schema) return;
  const result = validateAgainstSchema(data, collection.schema);
  if (!result.ok) {
    throw new DatastoreError('validation', `schema validation failed: ${result.errors.join('; ')}`);
  }
}

function jsonbParam(value: unknown): SQL {
  return value === undefined || value === null ? sql`NULL` : sql`${JSON.stringify(value)}::jsonb`;
}

/** WHERE fragment scoped to a collection, optionally AND-ed with compiled filters. */
function scopedWhere(collectionId: string, filters?: QueryFilter[]): SQL {
  const filterSql = compileFilters(filters);
  return filterSql
    ? sql`collection_id = ${collectionId} AND (${filterSql})`
    : sql`collection_id = ${collectionId}`;
}

async function countInCollection(collectionId: string, filters?: QueryFilter[]): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(*)::int AS count FROM datastore_records WHERE ${scopedWhere(collectionId, filters)}`,
  );
  const [row] = rowsOf(res);
  return Number(row?.count ?? 0);
}

/** WHERE fragment scoped to a collection AND restricted to rows the actor may read. */
function readableWhere(collection: DatastoreCollection, actor: string, filters?: QueryFilter[]): SQL {
  return sql`${scopedWhere(collection.id, filters)} AND ${readableSqlPredicate(collection, actor)}`;
}

/** Count only the rows `actor` is permitted to read (for read-facing totals). */
async function countReadable(
  collection: DatastoreCollection,
  actor: string,
  filters?: QueryFilter[],
): Promise<number> {
  const res = await db.execute(
    sql`SELECT count(*)::int AS count FROM datastore_records WHERE ${readableWhere(collection, actor, filters)}`,
  );
  const [row] = rowsOf(res);
  return Number(row?.count ?? 0);
}

/** Record counts for every collection in a single grouped query (owner-only admin views). */
export async function recordCountsByCollection(): Promise<Record<string, number>> {
  const res = await db.execute(
    sql`SELECT collection_id, count(*)::int AS count FROM datastore_records GROUP BY collection_id`,
  );
  const out: Record<string, number> = {};
  for (const r of rowsOf(res)) out[String(r.collection_id)] = Number(r.count ?? 0);
  return out;
}

async function fetchRow(collection: DatastoreCollection, ref: RecordRef): Promise<DatastoreRecord | null> {
  let res;
  if (ref.id) {
    res = await db.execute(
      sql`SELECT * FROM datastore_records WHERE id = ${ref.id} AND collection_id = ${collection.id} LIMIT 1`,
    );
  } else if (ref.key !== undefined && ref.key !== null) {
    res = await db.execute(
      sql`SELECT * FROM datastore_records WHERE collection_id = ${collection.id} AND key = ${ref.key} LIMIT 1`,
    );
  } else {
    throw new DatastoreError('validation', 'a record reference requires an id or key');
  }
  const [row] = rowsOf(res);
  return row ? mapRecordRow(row) : null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function insertRecord(
  slug: string,
  input: RecordInput,
  actor: string,
): Promise<DatastoreRecord> {
  const collection = await getCollectionOrThrow(slug);

  // Write gate is the collection default (the record does not exist yet). Do NOT
  // seed the fallback with the calling actor — otherwise the built-in default
  // `[creator,'owner','jkai']` would auto-grant whoever is inserting, so a
  // collection with no explicit defaultPermissions would have no insert-time
  // access control across actors. Fall back to the collection's own creator.
  assertCan('write', resolvePermissions({ permissions: null, createdBy: null }, collection), actor);
  assertSchemaValid(collection, input.data);
  assertPayloadWithinLimit(collection, input.data);

  const max = settingsOf(collection).maxRecords ?? DEFAULT_MAX_RECORDS;
  if ((await countInCollection(collection.id)) >= max) {
    throw new DatastoreError('limit', `collection "${slug}" is at its maxRecords limit (${max})`);
  }

  let res;
  try {
    res = await db.execute(sql`
      INSERT INTO datastore_records
        (collection_id, key, data, permissions, created_by, updated_by, expires_at)
      VALUES (
        ${collection.id},
        ${input.key ?? null},
        ${jsonbParam(input.data ?? {})},
        ${jsonbParam(input.permissions ?? null)},
        ${actor},
        ${actor},
        ${input.expiresAt ?? null}
      )
      RETURNING *
    `);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new DatastoreError('conflict', `a record with key "${input.key}" already exists in "${slug}"`);
    }
    throw err;
  }
  const record = mapRecordRow(rowsOf(res)[0]);
  auditDatastore({ collectionId: collection.id, recordId: record.id, actor, action: 'insert', after: record });
  return record;
}

export async function bulkInsertRecords(
  slug: string,
  inputs: RecordInput[],
  actor: string,
): Promise<DatastoreRecord[]> {
  if (inputs.length > BULK_CAP) {
    throw new DatastoreError('limit', `bulk insert is capped at ${BULK_CAP} records per batch`);
  }
  const out: DatastoreRecord[] = [];
  for (const input of inputs) {
    out.push(await insertRecord(slug, input, actor));
  }
  return out;
}

export async function upsertRecord(
  slug: string,
  input: RecordInput & { key: string },
  actor: string,
): Promise<DatastoreRecord> {
  const collection = await getCollectionOrThrow(slug);
  if (input.key === undefined || input.key === null || input.key === '') {
    throw new DatastoreError('validation', 'upsertRecord requires a non-empty key');
  }
  assertSchemaValid(collection, input.data);
  assertPayloadWithinLimit(collection, input.data);

  // Row-level write gate: honour an existing row's override if present; for a
  // brand-new row fall back to the collection default WITHOUT auto-granting the
  // calling actor (same reasoning as insertRecord).
  const existing = await fetchRow(collection, { key: input.key });
  const gatePerms = existing
    ? resolvePermissions(existing, collection)
    : resolvePermissions({ permissions: null, createdBy: null }, collection);
  assertCan('write', gatePerms, actor);

  // A new row via upsert must respect the collection's maxRecords cap too
  // (insertRecord enforces it; the upsert path previously bypassed it).
  if (!existing) {
    const max = settingsOf(collection).maxRecords ?? DEFAULT_MAX_RECORDS;
    if ((await countInCollection(collection.id)) >= max) {
      throw new DatastoreError('limit', `collection "${slug}" is at its maxRecords limit (${max})`);
    }
  }

  // Preserve an existing row's permissions when the caller does not supply any
  // (the common data-only update). Overwriting with excluded.permissions (NULL
  // when omitted) would silently widen a restricted row to the collection default.
  const permsOnConflict =
    input.permissions !== undefined && input.permissions !== null
      ? sql`excluded.permissions`
      : sql`datastore_records.permissions`;

  const res = await db.execute(sql`
    INSERT INTO datastore_records
      (collection_id, key, data, permissions, created_by, updated_by, expires_at)
    VALUES (
      ${collection.id},
      ${input.key},
      ${jsonbParam(input.data ?? {})},
      ${jsonbParam(input.permissions ?? null)},
      ${actor},
      ${actor},
      ${input.expiresAt ?? null}
    )
    ON CONFLICT (collection_id, key) WHERE key IS NOT NULL DO UPDATE SET
      data = excluded.data,
      permissions = ${permsOnConflict},
      version = datastore_records.version + 1,
      updated_at = now(),
      updated_by = ${actor},
      expires_at = excluded.expires_at
    RETURNING *
  `);
  const record = mapRecordRow(rowsOf(res)[0]);
  auditDatastore({
    collectionId: collection.id,
    recordId: record.id,
    actor,
    action: existing ? 'update' : 'insert',
    before: existing ?? undefined,
    after: record,
  });
  return record;
}

export async function updateRecord(
  slug: string,
  ref: RecordRef,
  changes: RecordChanges,
  actor: string,
): Promise<DatastoreRecord> {
  const collection = await getCollectionOrThrow(slug);
  const existing = await fetchRow(collection, ref);
  if (!existing) throw new DatastoreError('not_found', `record not found in "${slug}"`);
  const effectivePerms = resolvePermissions(existing, collection);
  assertCan('write', effectivePerms, actor);

  // Rewriting the permission map is an ownership-level action: a plain `write`
  // actor must not be able to grant itself delete/`*` or lock other actors out.
  // Require delete-level authority (owner always passes) to change permissions.
  if (changes.permissions !== undefined) {
    assertCan('delete', effectivePerms, actor);
  }

  if (changes.expectedVersion !== undefined && changes.expectedVersion !== existing.version) {
    throw new DatastoreError(
      'conflict',
      `version mismatch: expected ${changes.expectedVersion}, stored ${existing.version}`,
    );
  }

  const dataChanged = changes.data !== undefined || changes.patch !== undefined;
  const newData: Record<string, unknown> = changes.data
    ? changes.data
    : changes.patch
      ? { ...existing.data, ...changes.patch }
      : existing.data;

  if (dataChanged) {
    assertSchemaValid(collection, newData);
    assertPayloadWithinLimit(collection, newData);
  }

  const sets: SQL[] = [];
  if (dataChanged) sets.push(sql`data = ${jsonbParam(newData)}`);
  if (changes.permissions !== undefined) sets.push(sql`permissions = ${jsonbParam(changes.permissions)}`);
  if (changes.expiresAt !== undefined) sets.push(sql`expires_at = ${changes.expiresAt ?? null}`);
  sets.push(sql`version = datastore_records.version + 1`);
  sets.push(sql`updated_at = now()`);
  sets.push(sql`updated_by = ${actor}`);

  // Optimistic guard: the WHERE pins the version we read; a concurrent writer
  // that already bumped it makes this affect zero rows → conflict.
  const res = await db.execute(sql`
    UPDATE datastore_records SET ${sql.join(sets, sql`, `)}
    WHERE id = ${existing.id} AND version = ${existing.version}
    RETURNING *
  `);
  const [row] = rowsOf(res);
  if (!row) {
    throw new DatastoreError('conflict', 'record was modified concurrently; retry with a fresh version');
  }
  const after = mapRecordRow(row);
  const action = dataChanged ? 'update' : changes.permissions !== undefined ? 'permissions' : 'update';
  auditDatastore({ collectionId: collection.id, recordId: after.id, actor, action, before: existing, after });
  return after;
}

export async function deleteRecord(
  slug: string,
  ref: RecordRef,
  actor: string,
): Promise<{ deleted: boolean; id: string }> {
  const collection = await getCollectionOrThrow(slug);
  const existing = await fetchRow(collection, ref);
  if (!existing) throw new DatastoreError('not_found', `record not found in "${slug}"`);
  assertCan('delete', resolvePermissions(existing, collection), actor);

  await db.execute(sql`DELETE FROM datastore_records WHERE id = ${existing.id}`);
  auditDatastore({ collectionId: collection.id, recordId: existing.id, actor, action: 'delete', before: existing });
  return { deleted: true, id: existing.id };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getRecord(slug: string, id: string, actor: string): Promise<DatastoreRecord> {
  const collection = await getCollectionOrThrow(slug);
  const record = await fetchRow(collection, { id });
  if (!record) throw new DatastoreError('not_found', `record "${id}" not found in "${slug}"`);
  assertCan('read', resolvePermissions(record, collection), actor);
  return record;
}

export async function getRecordByKey(slug: string, key: string, actor: string): Promise<DatastoreRecord> {
  const collection = await getCollectionOrThrow(slug);
  const record = await fetchRow(collection, { key });
  if (!record) throw new DatastoreError('not_found', `record with key "${key}" not found in "${slug}"`);
  assertCan('read', resolvePermissions(record, collection), actor);
  return record;
}

/** Collection-level read gate for bulk operations. */
function assertCollectionReadable(collection: DatastoreCollection, actor: string): void {
  const perms = resolvePermissions({ permissions: null, createdBy: collection.createdBy }, collection);
  assertCan('read', perms, actor);
}

export async function queryRecords(
  slug: string,
  opts: QueryOptions,
  actor: string,
): Promise<{ records: DatastoreRecord[]; total?: number }> {
  const collection = await getCollectionOrThrow(slug);
  assertCollectionReadable(collection, actor);

  // Row-level read permissions are enforced INSIDE the query so LIMIT/OFFSET
  // page over only the rows the actor may read (a post-fetch JS filter returned
  // short pages and made restricted rows unreachable).
  const where = readableWhere(collection, actor, opts.filters);
  const order = compileSort(opts.sort);
  const limit = clampLimit(opts.limit);
  const offset = clampOffset(opts.offset);

  const res = await db.execute(sql`
    SELECT * FROM datastore_records WHERE ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}
  `);
  const records = rowsOf(res).map(mapRecordRow);

  if (opts.includeTotal) {
    // Total is over readable rows only — never leak the count of hidden rows.
    const total = await countReadable(collection, actor, opts.filters);
    return { records, total };
  }
  return { records };
}

export async function countRecords(
  slug: string,
  filters: QueryFilter[] | undefined,
  actor: string,
): Promise<number> {
  const collection = await getCollectionOrThrow(slug);
  assertCollectionReadable(collection, actor);
  return countReadable(collection, actor, filters);
}

export async function aggregateRecords(
  slug: string,
  opts: AggregateOptions,
  actor: string,
): Promise<{ value: number } | { groups: Array<{ group: string | null; value: number }> }> {
  const collection = await getCollectionOrThrow(slug);
  assertCollectionReadable(collection, actor);

  // Aggregate only over rows the actor may read — otherwise sum/avg/count leak
  // values from restricted rows.
  const where = readableWhere(collection, actor, opts.filters);

  let valueExpr: SQL;
  if (opts.op === 'count') {
    valueExpr = sql`count(*)::int`;
  } else {
    if (!opts.path) {
      throw new DatastoreError('validation', `aggregate "${opts.op}" requires a numeric path`);
    }
    const pl = pathLiteral(opts.path); // validates the path (throws on injection)
    // CASE-guard the numeric cast so a non-numeric value at this path yields
    // NULL (ignored by the aggregate) instead of aborting the whole query.
    const inner = sql`(CASE WHEN jsonb_typeof(data #> ${pl}::text[]) = 'number' THEN (data #>> ${pl}::text[])::numeric END)`;
    valueExpr =
      opts.op === 'sum'
        ? sql`sum(${inner})`
        : opts.op === 'avg'
          ? sql`avg(${inner})`
          : opts.op === 'min'
            ? sql`min(${inner})`
            : sql`max(${inner})`;
  }

  if (opts.groupBy) {
    const gl = pathLiteral(opts.groupBy);
    const res = await db.execute(sql`
      SELECT data #>> ${gl}::text[] AS grp, ${valueExpr} AS value
      FROM datastore_records WHERE ${where}
      GROUP BY grp ORDER BY value DESC
    `);
    const groups = rowsOf(res).map((r) => ({
      group: (r.grp as string) ?? null,
      value: Number(r.value ?? 0),
    }));
    return { groups };
  }

  const res = await db.execute(
    sql`SELECT ${valueExpr} AS value FROM datastore_records WHERE ${where}`,
  );
  const [row] = rowsOf(res);
  return { value: Number(row?.value ?? 0) };
}
