import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflowNodes, type WorkflowNode } from '$lib/db/schema';
import { recordAuditBatch } from './audit';
import { diffNodePatch } from './audit-diff';
import { findSensitive, type SensitiveKind } from '$lib/security/sensitive';

/**
 * The one server-side writer for `workflow_nodes`. `adapter.server.ts` is
 * read/lifecycle only, and until now every config write was inlined in the
 * PATCH route — which is how the merge, the version check and the audit entry
 * drifted apart. Both the human canvas and the nightly workflow doctor come
 * through here so the rails are the same rails.
 */

export class NodeNotFoundError extends Error {
  nodeId: string;
  constructor(nodeId: string) {
    super(`node not found: ${nodeId}`);
    this.name = 'NodeNotFoundError';
    this.nodeId = nodeId;
  }
}

export class VersionConflictError extends Error {
  currentVersion: number;
  expectedVersion: number;
  constructor(currentVersion: number, expectedVersion: number) {
    super(`version mismatch: expected ${expectedVersion}, stored ${currentVersion}`);
    this.name = 'VersionConflictError';
    this.currentVersion = currentVersion;
    this.expectedVersion = expectedVersion;
  }
}

/** Carries field NAMES only. A refusal must never restate what it refused over. */
export class SensitiveRefusalError extends Error {
  fields: string[];
  constructor(fields: string[]) {
    super(`node config holds a credential (${fields.join(', ')}) — refusing to patch`);
    this.name = 'SensitiveRefusalError';
    this.fields = fields;
  }
}

/**
 * The kinds that make a stored value a SECRET, and so the kinds that earn a
 * hard refusal.
 *
 * Deliberately narrower than `hasSensitive()`. Scanning the 97 live
 * `workflow_nodes` rows (2026-08-02) found 11 whose config trips the
 * personal-data patterns: nine whatsapp `to` recipients, one email `to`, and a
 * `builder-chat` whose `maxTokensPerHour: 1000000` is caught by the 7+ digit
 * rule. Gating on the full detector would make those nodes — including the
 * morning-briefing sender — permanently uneditable, to close a hole that
 * redaction already closes: `diffNodePatch` now placeholders EVERY kind on its
 * way into `workflow_audit_log.details`, personal data included. Only a
 * credential earns the refusal, because only a credential is the thing you
 * cannot fix by patching (the PATCH republishes it as the `old` side).
 */
const CREDENTIAL_KINDS: ReadonlySet<SensitiveKind> = new Set<SensitiveKind>([
  'api-key',
  'token',
  'private-key',
]);

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * Top-level config keys whose name or value carries a credential. Key and value
 * are scanned together so a key that is itself a secret cannot slip through.
 * Returns names — the values never leave this function.
 */
export function credentialFields(config: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(config ?? {})) {
    if (findSensitive(stringify({ [key]: value })).some((m) => CREDENTIAL_KINDS.has(m.kind))) {
      out.push(key);
    }
  }
  return out;
}

export interface NodeMutationInput {
  workflowId: string;
  nodeId: string;
  /** Shallow-merged over the stored config. Absent keys are kept, not dropped. */
  patch?: Record<string, unknown>;
  /** Applied after the merge — the only way to delete a config key. */
  removeKeys?: string[];
  /** Optional rename, so one caller-level edit stays one version bump. */
  label?: string;
  position?: { x: number; y: number };
  /** Supplied → optimistic concurrency. Omitted → last write wins, as before. */
  expectedVersion?: number;
  actor: string;
  reason: string;
}

/**
 * Enough to put the node back. Only the keys the write touched — never the
 * whole config, so a before-image is not a second copy of the node.
 */
export interface NodeBeforeImage {
  nodeId: string;
  version: number;
  changedFields: Record<string, unknown>;
  /**
   * Keys the write ADDED. `changedFields[k] = undefined` would say the same
   * thing until it round-trips through jsonb, where it disappears — so absence
   * is recorded positionally instead.
   */
  addedKeys?: string[];
}

export interface NodeMutationResult {
  before: NodeBeforeImage;
  after: { version: number };
  node: WorkflowNode;
}

/**
 * Read-modify-write one node's config (and optionally its label/position).
 *
 * Throws `NodeNotFoundError`, `VersionConflictError` or `SensitiveRefusalError`
 * — all distinguishable, because the callers map them to different outcomes: a
 * 404, a 409, and "delete the node, do not patch it".
 */
export async function mutateNodeConfig(input: NodeMutationInput): Promise<NodeMutationResult> {
  const { workflowId, nodeId, patch, removeKeys, expectedVersion, actor, reason } = input;

  const [node] = await db
    .select()
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, nodeId), eq(workflowNodes.workflowId, workflowId)));
  if (!node) throw new NodeNotFoundError(nodeId);

  const currentVersion = node.version ?? 0;
  if (typeof expectedVersion === 'number' && currentVersion !== expectedVersion) {
    throw new VersionConflictError(currentVersion, expectedVersion);
  }

  const beforeConfig = (node.config as Record<string, unknown>) ?? {};
  const touchesConfig = patch !== undefined || (removeKeys?.length ?? 0) > 0;

  const afterConfig: Record<string, unknown> = { ...beforeConfig, ...(patch ?? {}) };
  for (const key of removeKeys ?? []) delete afterConfig[key];

  // The refusal gate. Checked on BOTH sides: the before-side is the live
  // incident (a PATCH that removes a credential publishes it as `old`), the
  // after-side stops a new one being typed in. A label move or a drag is not a
  // config write and is not blocked — nothing of the config reaches the log.
  if (touchesConfig) {
    const offending = [
      ...new Set([...credentialFields(beforeConfig), ...credentialFields(afterConfig)]),
    ];
    if (offending.length > 0) throw new SensitiveRefusalError(offending);
  }

  const touched = new Set([...Object.keys(patch ?? {}), ...(removeKeys ?? [])]);
  const changedFields: Record<string, unknown> = {};
  const addedKeys: string[] = [];
  for (const key of touched) {
    if (key in beforeConfig) changedFields[key] = beforeConfig[key];
    else addedKeys.push(key);
  }

  const updates: Record<string, unknown> = { version: currentVersion + 1 };
  if (touchesConfig) updates.config = afterConfig;
  if (typeof input.label === 'string') updates.label = input.label;
  if (input.position) updates.position = input.position;

  // When the caller supplied a version, fold it into the WHERE as well: a
  // read-then-check alone still loses an edit made between the two statements,
  // and the doctor's revert path is specified to 409 rather than clobber.
  const where =
    typeof expectedVersion === 'number'
      ? and(
          eq(workflowNodes.id, nodeId),
          eq(workflowNodes.workflowId, workflowId),
          eq(workflowNodes.version, expectedVersion),
        )
      : and(eq(workflowNodes.id, nodeId), eq(workflowNodes.workflowId, workflowId));

  const [updated] = await db.update(workflowNodes).set(updates).where(where).returning();
  if (!updated) {
    if (typeof expectedVersion === 'number') {
      const [now] = await db
        .select()
        .from(workflowNodes)
        .where(and(eq(workflowNodes.id, nodeId), eq(workflowNodes.workflowId, workflowId)));
      if (now) throw new VersionConflictError(now.version ?? 0, expectedVersion);
    }
    throw new NodeNotFoundError(nodeId);
  }

  const entries = diffNodePatch(
    {
      label: node.label,
      config: beforeConfig,
      position: (node.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    },
    {
      label: typeof input.label === 'string' ? input.label : undefined,
      config: touchesConfig ? afterConfig : undefined,
    },
  );
  if (entries.length > 0) {
    await recordAuditBatch(
      entries.map((e) => ({
        workflowId,
        entity: 'node' as const,
        entityId: nodeId,
        action: e.action,
        details: { ...e.details, label: updated.label, nodeType: updated.type, actor, reason },
      })),
    );
  }

  return {
    before: {
      nodeId,
      version: currentVersion,
      changedFields,
      ...(addedKeys.length > 0 ? { addedKeys } : {}),
    },
    after: { version: updated.version ?? 0 },
    node: updated,
  };
}

/**
 * Put a node back to a recorded before-image, through the same door.
 *
 * `version + 1` is what the fix left behind, so anything else means a human has
 * edited since and the revert 409s instead of overwriting them.
 */
export async function revertNodeConfig(
  beforeImage: NodeBeforeImage,
  actor: string,
): Promise<NodeMutationResult> {
  const [row] = await db
    .select({ workflowId: workflowNodes.workflowId })
    .from(workflowNodes)
    .where(eq(workflowNodes.id, beforeImage.nodeId));
  if (!row) throw new NodeNotFoundError(beforeImage.nodeId);

  return mutateNodeConfig({
    workflowId: row.workflowId,
    nodeId: beforeImage.nodeId,
    patch: beforeImage.changedFields,
    removeKeys: beforeImage.addedKeys,
    expectedVersion: beforeImage.version + 1,
    actor,
    reason: 'revert',
  });
}
