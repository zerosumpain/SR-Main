// $lib/datastore — public API barrel.
//
// The single import surface for every datastore consumer (workflow `database`
// node, `datastore`/`apis` toolsets, admin UI, self-improvement engine). All
// mutating calls enforce permissions in `permissions.ts` and audit in `audit.ts`.
// Import from `$lib/datastore` only — never reach into individual sub-modules.

export * from './types';

// Collection lifecycle.
export {
  ensureCollection,
  getCollectionBySlug,
  listCollections,
  updateCollection,
  deleteCollection,
  mapCollectionRow,
} from './collections';

// Record CRUD + query + aggregate.
export {
  insertRecord,
  bulkInsertRecords,
  upsertRecord,
  getRecord,
  getRecordByKey,
  queryRecords,
  updateRecord,
  deleteRecord,
  countRecords,
  aggregateRecords,
} from './records';

// Permission primitives (surfaces derive their own actor; these are the checks).
export { resolvePermissions, assertCan, canDo } from './permissions';
export type { PermissionAction } from './permissions';

// Schema-subset validation + query-DSL compiler (exposed for reuse/testing).
export { validateAgainstSchema } from './validate';
export type { ValidationResult } from './validate';
export { compileFilters, compileSort, clampLimit, clampOffset } from './query';

// TTL reaper (wired into hooks by Task 4).
export { startDatastoreReaper, stopDatastoreReaper, sweepExpired } from './ttl-reaper';
