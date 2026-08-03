import { and, eq, inArray, or } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import {
  workflowEdges,
  workflowNodes,
  type WorkflowEdge,
  type WorkflowNode,
} from '$lib/db/schema';
import { recordAudit, recordAuditBatch, type AuditInput } from './audit';
import { diffNodePatch } from './audit-diff';
import { findSensitive, type SensitiveKind } from '$lib/security/sensitive';
import { isDisplayOnlyType } from '$lib/workflows/types';

/**
 * The server-side writers for `workflow_nodes` and `workflow_edges`.
 * `adapter.server.ts` is read/lifecycle only, and until now every config write
 * was inlined in the PATCH route — which is how the merge, the version check
 * and the audit entry drifted apart. The human canvas, the nightly workflow
 * doctor and the chat `workflow_*` tools all come through here so the rails are
 * the same rails.
 *
 * Every writer takes an optional `tx`. Without it they run on the pool exactly
 * as before; with it several of them compose into one atomic amend (see
 * `amend.server.ts`).
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
 * An edge endpoint that is not a node of this workflow.
 *
 * The chat `workflow_add_edge` used to insert source/target straight from the
 * model's arguments, so a hallucinated or cross-canvas id wired two graphs
 * together and only the foreign key stopped a wholly invented one.
 */
export class EdgeEndpointError extends Error {
  nodeIds: string[];
  constructor(nodeIds: string[]) {
    super(`not a node of this workflow: ${nodeIds.join(', ')}`);
    this.name = 'EdgeEndpointError';
    this.nodeIds = nodeIds;
  }
}

export class EdgeNotFoundError extends Error {
  edgeId: string;
  constructor(edgeId: string) {
    super(`edge not found: ${edgeId}`);
    this.name = 'EdgeNotFoundError';
    this.edgeId = edgeId;
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
  /**
   * Optional retype. Validate it against the registry BEFORE calling — this
   * writer knows nothing about node types, only that a change of one is an
   * edit worth a version bump and an audit entry.
   */
  type?: string;
  position?: { x: number; y: number };
  /** Supplied → optimistic concurrency. Omitted → last write wins, as before. */
  expectedVersion?: number;
  actor: string;
  reason: string;
  /** Run inside a caller's transaction. Omitted → the pool, as before. */
  tx?: DbExecutor;
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
  const conn = input.tx ?? db;

  const [node] = await conn
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
  if (typeof input.type === 'string') updates.type = input.type;
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

  const [updated] = await conn.update(workflowNodes).set(updates).where(where).returning();
  if (!updated) {
    if (typeof expectedVersion === 'number') {
      const [now] = await conn
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
  const auditEntries: AuditInput[] = entries.map((e) => ({
    workflowId,
    entity: 'node' as const,
    entityId: nodeId,
    action: e.action,
    details: { ...e.details, label: updated.label, nodeType: updated.type, actor, reason },
  }));
  if (typeof input.type === 'string' && input.type !== node.type) {
    auditEntries.push({
      workflowId,
      entity: 'node' as const,
      entityId: nodeId,
      action: 'update' as const,
      details: {
        field: 'type',
        old: node.type,
        new: input.type,
        label: updated.label,
        nodeType: updated.type,
        actor,
        reason,
      },
    });
  }
  if (auditEntries.length > 0) await recordAuditBatch(auditEntries, input.tx);

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
  tx?: DbExecutor,
): Promise<NodeMutationResult> {
  const conn = tx ?? db;
  const [row] = await conn
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
    tx,
  });
}

export interface NodeCreateInput {
  workflowId: string;
  /** Validate against the registry before calling — see `NodeMutationInput.type`. */
  type: string;
  label: string;
  config?: Record<string, unknown>;
  /** Omitted → the next free slot in the canvas grid. */
  position?: { x: number; y: number };
  actor: string;
  reason: string;
  tx?: DbExecutor;
}

/**
 * Insert a node through the same door as every other node write.
 *
 * The credential gate applies here too: `mutateNodeConfig` refusing a patch is
 * worth little if the same value can be typed in on the way IN, and a node
 * created holding a key is one the owner then cannot edit at all.
 */
export async function createNode(input: NodeCreateInput): Promise<WorkflowNode> {
  const conn = input.tx ?? db;
  const config = input.config ?? {};

  const offending = credentialFields(config);
  if (offending.length > 0) throw new SensitiveRefusalError(offending);

  const position = input.position ?? (await nextNodePosition(input.workflowId, conn));

  const [node] = await conn
    .insert(workflowNodes)
    .values({
      workflowId: input.workflowId,
      type: input.type,
      label: input.label,
      config,
      position,
    })
    .returning();

  await recordAudit(
    {
      workflowId: input.workflowId,
      entity: 'node',
      entityId: node.id,
      action: 'create',
      details: {
        nodeType: node.type,
        label: node.label,
        actor: input.actor,
        reason: input.reason,
      },
    },
    input.tx,
  );

  return node;
}

export interface NodeDeleteInput {
  workflowId: string;
  nodeId: string;
  actor: string;
  reason: string;
  tx?: DbExecutor;
}

export interface NodeDeleteResult {
  node: WorkflowNode;
  /** The edges that went with it — enough to rewire the graph on a change of mind. */
  edges: WorkflowEdge[];
}

/**
 * Delete a node and the edges touching it.
 *
 * Deliberately NOT credential-gated: "delete the node, never edit it" is the
 * prescribed remedy for a node whose config holds a key, so refusing here would
 * strand exactly the nodes that most need removing. Nothing of the config
 * reaches the audit row.
 */
export async function deleteNode(input: NodeDeleteInput): Promise<NodeDeleteResult> {
  const { workflowId, nodeId, actor, reason } = input;
  const conn = input.tx ?? db;

  const [node] = await conn
    .select()
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, nodeId), eq(workflowNodes.workflowId, workflowId)));
  if (!node) throw new NodeNotFoundError(nodeId);

  const edges = await conn
    .select()
    .from(workflowEdges)
    .where(
      and(
        eq(workflowEdges.workflowId, workflowId),
        or(eq(workflowEdges.sourceNodeId, nodeId), eq(workflowEdges.targetNodeId, nodeId)),
      ),
    );

  // Explicit, though the FK cascades: the cascade deletes silently, and an
  // amend that severed three branches has to be readable in the audit log.
  if (edges.length > 0) {
    await conn.delete(workflowEdges).where(
      inArray(
        workflowEdges.id,
        edges.map((e) => e.id),
      ),
    );
  }
  await conn.delete(workflowNodes).where(eq(workflowNodes.id, nodeId));

  await recordAuditBatch(
    [
      {
        workflowId,
        entity: 'node' as const,
        entityId: nodeId,
        action: 'delete' as const,
        details: { nodeType: node.type, label: node.label, actor, reason },
      },
      ...edges.map((e) => ({
        workflowId,
        entity: 'edge' as const,
        entityId: e.id,
        action: 'delete' as const,
        details: { from: e.sourceNodeId, to: e.targetNodeId, actor, reason },
      })),
    ],
    input.tx,
  );

  return { node, edges };
}

export interface EdgeCreateInput {
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  actor: string;
  reason: string;
  tx?: DbExecutor;
}

/**
 * Connect two nodes, after checking they are both nodes of THIS workflow.
 *
 * An id the model invented, or borrowed from another canvas, used to reach the
 * table unchecked — the foreign key accepts any real node, from any graph.
 * Re-adding an edge that already exists returns the existing row rather than a
 * duplicate, matching the canvas POST route.
 *
 * "Already exists" means the same pair AND the same handles. A condition node's
 * error branch and its success branch run between the same two nodes and differ
 * only by `sourceHandle`, so deduping on the pair alone would quietly hand back
 * the success edge and report the error route as wired when it never was.
 */
export async function createEdge(input: EdgeCreateInput): Promise<WorkflowEdge> {
  const { workflowId, sourceNodeId, targetNodeId, actor, reason } = input;
  const conn = input.tx ?? db;

  if (sourceNodeId === targetNodeId) {
    throw new EdgeEndpointError([sourceNodeId]);
  }

  const endpoints = await conn
    .select()
    .from(workflowNodes)
    .where(
      and(
        eq(workflowNodes.workflowId, workflowId),
        inArray(workflowNodes.id, [sourceNodeId, targetNodeId]),
      ),
    );
  const found = new Set(endpoints.map((n) => n.id));
  const missing = [sourceNodeId, targetNodeId].filter((id) => !found.has(id));
  if (missing.length > 0) throw new EdgeEndpointError(missing);

  const displayOnly = endpoints.filter((n) => isDisplayOnlyType(n.type));
  if (displayOnly.length > 0) throw new EdgeEndpointError(displayOnly.map((n) => n.id));

  const sourceHandle = input.sourceHandle || null;
  const targetHandle = input.targetHandle || null;

  const between = await conn
    .select()
    .from(workflowEdges)
    .where(
      and(
        eq(workflowEdges.workflowId, workflowId),
        eq(workflowEdges.sourceNodeId, sourceNodeId),
        eq(workflowEdges.targetNodeId, targetNodeId),
      ),
    );
  const existing = between.find(
    (e) => (e.sourceHandle ?? null) === sourceHandle && (e.targetHandle ?? null) === targetHandle,
  );
  if (existing) return existing;

  const [edge] = await conn
    .insert(workflowEdges)
    .values({
      workflowId,
      sourceNodeId,
      targetNodeId,
      sourceHandle,
      targetHandle,
    })
    .returning();

  const labelById = new Map(endpoints.map((n) => [n.id, n.label]));
  await recordAudit(
    {
      workflowId,
      entity: 'edge',
      entityId: edge.id,
      action: 'create',
      details: {
        from: sourceNodeId,
        to: targetNodeId,
        fromLabel: labelById.get(sourceNodeId) ?? null,
        toLabel: labelById.get(targetNodeId) ?? null,
        actor,
        reason,
      },
    },
    input.tx,
  );

  return edge;
}

export interface EdgeDeleteInput {
  workflowId: string;
  edgeId: string;
  actor: string;
  reason: string;
  tx?: DbExecutor;
}

/** Remove one edge, scoped to its workflow so a stray id cannot cut another canvas. */
export async function deleteEdge(input: EdgeDeleteInput): Promise<WorkflowEdge> {
  const { workflowId, edgeId, actor, reason } = input;
  const conn = input.tx ?? db;

  const [edge] = await conn
    .select()
    .from(workflowEdges)
    .where(and(eq(workflowEdges.id, edgeId), eq(workflowEdges.workflowId, workflowId)));
  if (!edge) throw new EdgeNotFoundError(edgeId);

  await conn.delete(workflowEdges).where(eq(workflowEdges.id, edgeId));

  await recordAudit(
    {
      workflowId,
      entity: 'edge',
      entityId: edgeId,
      action: 'delete',
      details: { from: edge.sourceNodeId, to: edge.targetNodeId, actor, reason },
    },
    input.tx,
  );

  return edge;
}

export interface EdgeUpdateInput {
  workflowId: string;
  edgeId: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  actor: string;
  reason: string;
  tx?: DbExecutor;
}

/** Re-route an edge. The new endpoints get the same membership check as a new one. */
export async function updateEdge(input: EdgeUpdateInput): Promise<WorkflowEdge> {
  const { workflowId, edgeId, actor, reason } = input;
  const conn = input.tx ?? db;

  const [edge] = await conn
    .select()
    .from(workflowEdges)
    .where(and(eq(workflowEdges.id, edgeId), eq(workflowEdges.workflowId, workflowId)));
  if (!edge) throw new EdgeNotFoundError(edgeId);

  const nextSource = input.sourceNodeId ?? edge.sourceNodeId;
  const nextTarget = input.targetNodeId ?? edge.targetNodeId;
  if (nextSource === nextTarget) throw new EdgeEndpointError([nextSource]);

  const moved = [
    ...(input.sourceNodeId ? [input.sourceNodeId] : []),
    ...(input.targetNodeId ? [input.targetNodeId] : []),
  ];
  if (moved.length > 0) {
    const endpoints = await conn
      .select({ id: workflowNodes.id, type: workflowNodes.type })
      .from(workflowNodes)
      .where(and(eq(workflowNodes.workflowId, workflowId), inArray(workflowNodes.id, moved)));
    const found = new Set(endpoints.map((n) => n.id));
    const missing = moved.filter((id) => !found.has(id));
    if (missing.length > 0) throw new EdgeEndpointError(missing);
    const displayOnly = endpoints.filter((n) => isDisplayOnlyType(n.type));
    if (displayOnly.length > 0) throw new EdgeEndpointError(displayOnly.map((n) => n.id));
  }

  const updates: Record<string, unknown> = {};
  if (input.sourceNodeId) updates.sourceNodeId = input.sourceNodeId;
  if (input.targetNodeId) updates.targetNodeId = input.targetNodeId;
  if (input.sourceHandle !== undefined) updates.sourceHandle = input.sourceHandle || null;
  if (input.targetHandle !== undefined) updates.targetHandle = input.targetHandle || null;

  const [updated] = await conn
    .update(workflowEdges)
    .set(updates)
    .where(eq(workflowEdges.id, edgeId))
    .returning();

  await recordAudit(
    {
      workflowId,
      entity: 'edge',
      entityId: edgeId,
      action: 'update',
      details: {
        from: updated.sourceNodeId,
        to: updated.targetNodeId,
        previousFrom: edge.sourceNodeId,
        previousTo: edge.targetNodeId,
        actor,
        reason,
      },
    },
    input.tx,
  );

  return updated;
}

/**
 * Pick a fresh canvas position for a brand-new node so individual adds don't
 * pile up at (0, 0). Lays nodes out in a 3-column grid below / to the right of
 * whatever's already there, matching the spacing `workflow_build_from_spec`
 * uses for batch inserts.
 */
export async function nextNodePosition(
  workflowId: string,
  conn: DbExecutor = db,
): Promise<{ x: number; y: number }> {
  const COL_W = 280;
  const ROW_H = 160;
  const COLS = 3;
  const ORIGIN_X = 240;
  const ORIGIN_Y = 20;
  const existing = await conn
    .select({ position: workflowNodes.position })
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, workflowId));
  const used = new Set<string>();
  for (const row of existing) {
    const p = row.position as { x?: number; y?: number } | null;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    used.add(`${Math.round(p.x)},${Math.round(p.y)}`);
  }
  for (let i = 0; i < 60; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = ORIGIN_X + col * COL_W;
    const y = ORIGIN_Y + row * ROW_H;
    if (!used.has(`${x},${y}`)) return { x, y };
  }
  // Past 60 slots — just stagger off the bottom so nothing exactly overlaps.
  return { x: ORIGIN_X, y: ORIGIN_Y + (existing.length + 1) * ROW_H };
}
