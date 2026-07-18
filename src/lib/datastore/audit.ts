// $lib/datastore/audit.ts
//
// Fire-and-forget audit trail (precedent: src/lib/jkai/llm-usage-log.ts). Audit
// writes must NEVER break a datastore operation, so this swallows its own errors
// — both synchronous (a bad mock / missing db) and asynchronous (insert failure).
// Every mutating access-layer call records a before/after image here; the log
// doubles as revision history for the admin "restore" feature.

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

export type AuditAction =
  | 'insert'
  | 'update'
  | 'delete'
  | 'expire'
  | 'permissions'
  | 'collection_create'
  | 'collection_update'
  | 'collection_delete';

export interface AuditEntry {
  collectionId: string | null;
  recordId?: string | null;
  actor: string;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
}

export function auditDatastore(entry: AuditEntry): void {
  try {
    const before = entry.before === undefined ? null : JSON.stringify(entry.before);
    const after = entry.after === undefined ? null : JSON.stringify(entry.after);
    void db
      .execute(sql`
        INSERT INTO datastore_audit_log (collection_id, record_id, actor, action, before, after)
        VALUES (
          ${entry.collectionId},
          ${entry.recordId ?? null},
          ${entry.actor},
          ${entry.action},
          ${before}::jsonb,
          ${after}::jsonb
        )
      `)
      .catch((err: unknown) => {
        console.error(
          '[datastore-audit] failed to write audit row:',
          err instanceof Error ? err.message : err,
        );
      });
  } catch (err) {
    console.error(
      '[datastore-audit] audit write threw synchronously:',
      err instanceof Error ? err.message : err,
    );
  }
}
