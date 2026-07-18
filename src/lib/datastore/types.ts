// $lib/datastore/types.ts
//
// Single source of truth for the datastore access-layer types. Later tasks
// (workflow `database` node, `datastore`/`apis` toolsets, admin UI, the
// self-improvement engine) import these names verbatim from the `$lib/datastore`
// barrel — do not rename.

/**
 * An actor is the principal a datastore call is made on behalf of. Concrete
 * forms: `owner` (admin UI / John), `jkai` (chat + Hermes), `system`
 * (engines / reapers / nightly loop), `workflow:<id>` (a specific workflow run).
 * In permission lists the wildcards `workflow:*` (any workflow) and `*` (any
 * authenticated principal) are also valid entries.
 */
export type DatastoreActor = string;

/** Capability map — which actors may read / write / delete. */
export interface PermissionSet {
  read?: string[];
  write?: string[];
  delete?: string[];
}

/** Per-collection guardrails (all optional). */
export interface CollectionSettings {
  ttlSeconds?: number;
  maxRecords?: number;
  maxPayloadBytes?: number;
}

export interface QueryFilter {
  path: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'exists' | 'in';
  value?: unknown;
}

export interface QuerySort {
  path?: string;
  field?: 'createdAt' | 'updatedAt' | 'key';
  dir: 'asc' | 'desc';
}

export interface QueryOptions {
  filters?: QueryFilter[];
  sort?: QuerySort;
  limit?: number;
  offset?: number;
  includeTotal?: boolean;
}

export interface AggregateOptions {
  op: 'count' | 'sum' | 'avg' | 'min' | 'max';
  path?: string;
  groupBy?: string;
  filters?: QueryFilter[];
}

export type DatastoreErrorCode = 'not_found' | 'forbidden' | 'validation' | 'conflict' | 'limit';

/** Typed error surfaced by the access layer; surfaces map `code` → status/message. */
export class DatastoreError extends Error {
  constructor(
    public code: DatastoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DatastoreError';
  }
}

export interface RecordInput {
  key?: string;
  data: Record<string, unknown>;
  permissions?: PermissionSet;
  expiresAt?: Date;
}

/** A materialised datastore record (mapped from the DB row). */
export interface DatastoreRecord {
  id: string;
  collectionId: string;
  key: string | null;
  data: Record<string, unknown>;
  permissions: PermissionSet | null;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

/** A materialised collection (mapped from the DB row). */
export interface DatastoreCollection {
  id: string;
  slug: string;
  name: string | null;
  description: string | null;
  schema: Record<string, unknown> | null;
  defaultPermissions: PermissionSet | null;
  settings: CollectionSettings | null;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Options accepted by `ensureCollection` / `updateCollection`. */
export interface CollectionOptions {
  name?: string;
  description?: string;
  schema?: Record<string, unknown> | null;
  defaultPermissions?: PermissionSet;
  settings?: CollectionSettings;
  isSystem?: boolean;
}

/** Mutations accepted by `updateRecord`. */
export interface RecordChanges {
  data?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  permissions?: PermissionSet;
  expiresAt?: Date | null;
  expectedVersion?: number;
}

/** A reference to a single record — by id or by natural key. */
export interface RecordRef {
  id?: string;
  key?: string;
}
