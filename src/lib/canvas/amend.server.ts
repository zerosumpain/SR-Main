import { and, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { workflowEdges, workflowNodes, workflows } from '$lib/db/schema';
import { discardAuditObs, flushAuditObs } from './audit';
import { publishWorkflowUpdate, type WorkflowUpdateEvent } from '$lib/jkai/workflow-updates-bus';
import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  mutateNodeConfig,
  nextNodePosition,
  NodeNotFoundError,
  type NodeBeforeImage,
} from './mutate.server';

/**
 * Apply several graph edits as ONE unit.
 *
 * Splicing a delay in front of a WhatsApp send is four writes — add the node,
 * cut the old edge, wire two new ones — and as four separate tool calls a
 * failure on the third leaves a dangling node and a severed branch, on a canvas
 * the owner is not looking at. Every write here runs on one transaction handle,
 * so the graph either moves or it doesn't.
 *
 * Type and config validation is NOT done here. It belongs to the caller, next
 * to the node registry and the credential-refusal copy it shares with the rest
 * of the workflow tools; this module is the transactional executor only.
 */

export type AmendOp =
  | {
      op: 'add_node';
      /** Name a later op can point at as `#ref`, before the row has an id. */
      ref?: string;
      type: string;
      label: string;
      config?: Record<string, unknown>;
      position?: { x: number; y: number };
    }
  | {
      op: 'update_node';
      nodeId: string;
      config?: Record<string, unknown>;
      removeConfigKeys?: string[];
      label?: string;
      type?: string;
    }
  | { op: 'remove_node'; nodeId: string }
  | {
      op: 'add_edge';
      sourceNodeId: string;
      targetNodeId: string;
      sourceHandle?: string;
      targetHandle?: string;
    }
  | { op: 'remove_edge'; edgeId: string }
  | {
      op: 'insert_between';
      sourceNodeId: string;
      targetNodeId: string;
      ref?: string;
      type: string;
      label: string;
      config?: Record<string, unknown>;
    };

export interface AmendOutcome {
  op: AmendOp['op'];
  /** What changed, in the words the chat can read back without another call. */
  summary: string;
  nodeId?: string;
  edgeId?: string;
  /** Present for update_node — the keys the write touched, enough to put it back. */
  before?: NodeBeforeImage;
}

export interface AmendResult {
  workflowId: string;
  outcomes: AmendOutcome[];
}

export class AmendOpError extends Error {
  /** 0-based index of the op that failed, so the model fixes THAT one. */
  index: number;
  cause: unknown;
  constructor(index: number, op: AmendOp['op'], cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`op ${index + 1} (${op}) failed: ${detail} — nothing was written`);
    this.name = 'AmendOpError';
    this.index = index;
    this.cause = cause;
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`workflow not found: ${workflowId}`);
    this.name = 'WorkflowNotFoundError';
  }
}

export interface AmendInput {
  workflowId: string;
  ops: AmendOp[];
  actor: string;
  reason: string;
}

/**
 * `#ref` points at a node created earlier in the same amend; anything else is a
 * real node id. Written as a prefix rather than a lookup-if-present so a real id
 * that happens to collide with a ref name can never be silently redirected.
 */
function resolveRef(id: string, refs: Map<string, string>): string {
  if (!id.startsWith('#')) return id;
  const resolved = refs.get(id.slice(1));
  if (!resolved) throw new Error(`unknown ref "${id}" — declare it as \`ref\` on an earlier add_node`);
  return resolved;
}

export async function applyAmendOps(input: AmendInput): Promise<AmendResult> {
  const { workflowId, ops, actor, reason } = input;

  if (ops.length === 0) throw new Error('no ops to apply');

  const [workflow] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.id, workflowId));
  if (!workflow) throw new WorkflowNotFoundError(workflowId);

  // Collected inside, published outside: a subscriber that patched its canvas
  // from an event the transaction then rolled back would show a graph that
  // does not exist.
  const events: WorkflowUpdateEvent[] = [];
  const outcomes: AmendOutcome[] = [];
  // Held so the audit rows' observability events can be released after COMMIT,
  // for the same reason `events` is: an announcement cannot be rolled back.
  const txRef: { current?: DbExecutor } = {};

  await db.transaction(async (tx) => {
    txRef.current = tx;
    const refs = new Map<string, string>();

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      try {
        switch (op.op) {
          case 'add_node': {
            const node = await createNode({
              workflowId,
              type: op.type,
              label: op.label,
              config: op.config,
              position: op.position,
              actor,
              reason,
              tx,
            });
            if (op.ref) refs.set(op.ref, node.id);
            events.push({
              workflowId,
              kind: 'node_added',
              nodeId: node.id,
              summary: node.label,
              node: {
                id: node.id,
                type: node.type,
                label: node.label,
                config: node.config,
                position: node.position,
              },
              ts: Date.now(),
            });
            outcomes.push({
              op: op.op,
              summary: `added ${op.type} node "${node.label}"`,
              nodeId: node.id,
            });
            break;
          }

          case 'update_node': {
            const nodeId = resolveRef(op.nodeId, refs);
            const removeKeys = [...(op.removeConfigKeys ?? [])];
            const patch = op.config ? { ...op.config } : undefined;
            // `null` means "drop this key" on the chat tools, and has meant so
            // since the LLM kept leaving null sentinels behind. Keep it here.
            if (patch) {
              for (const k of Object.keys(patch)) {
                if (patch[k] === null) {
                  delete patch[k];
                  removeKeys.push(k);
                }
              }
            }
            const res = await mutateNodeConfig({
              workflowId,
              nodeId,
              patch,
              removeKeys: removeKeys.length > 0 ? removeKeys : undefined,
              label: op.label,
              type: op.type,
              actor,
              reason,
              tx,
            });
            events.push({
              workflowId,
              kind: 'node_updated',
              nodeId: res.node.id,
              summary: res.node.label,
              node: {
                id: res.node.id,
                type: res.node.type,
                label: res.node.label,
                config: res.node.config,
                position: res.node.position,
              },
              ts: Date.now(),
            });
            outcomes.push({
              op: op.op,
              summary: `updated "${res.node.label}" (version ${res.before.version} → ${res.after.version})`,
              nodeId: res.node.id,
              before: res.before,
            });
            break;
          }

          case 'remove_node': {
            const nodeId = resolveRef(op.nodeId, refs);
            const res = await deleteNode({ workflowId, nodeId, actor, reason, tx });
            events.push({
              workflowId,
              kind: 'node_removed',
              nodeId,
              summary: res.node.label,
              ts: Date.now(),
            });
            outcomes.push({
              op: op.op,
              summary: `removed "${res.node.label}" and ${res.edges.length} edge${res.edges.length === 1 ? '' : 's'}`,
              nodeId,
            });
            break;
          }

          case 'add_edge': {
            const edge = await createEdge({
              workflowId,
              sourceNodeId: resolveRef(op.sourceNodeId, refs),
              targetNodeId: resolveRef(op.targetNodeId, refs),
              sourceHandle: op.sourceHandle,
              targetHandle: op.targetHandle,
              actor,
              reason,
              tx,
            });
            events.push({
              workflowId,
              kind: 'edge_added',
              edgeId: edge.id,
              edge: {
                id: edge.id,
                sourceNodeId: edge.sourceNodeId,
                targetNodeId: edge.targetNodeId,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
              },
              ts: Date.now(),
            });
            outcomes.push({
              op: op.op,
              summary: `wired ${edge.sourceNodeId} → ${edge.targetNodeId}`,
              edgeId: edge.id,
            });
            break;
          }

          case 'remove_edge': {
            const edge = await deleteEdge({ workflowId, edgeId: op.edgeId, actor, reason, tx });
            events.push({ workflowId, kind: 'edge_removed', edgeId: edge.id, ts: Date.now() });
            outcomes.push({
              op: op.op,
              summary: `cut ${edge.sourceNodeId} → ${edge.targetNodeId}`,
              edgeId: edge.id,
            });
            break;
          }

          case 'insert_between': {
            const sourceNodeId = resolveRef(op.sourceNodeId, refs);
            const targetNodeId = resolveRef(op.targetNodeId, refs);

            const [source, target] = await Promise.all([
              tx
                .select()
                .from(workflowNodes)
                .where(
                  and(eq(workflowNodes.id, sourceNodeId), eq(workflowNodes.workflowId, workflowId)),
                )
                .then((r) => r[0]),
              tx
                .select()
                .from(workflowNodes)
                .where(
                  and(eq(workflowNodes.id, targetNodeId), eq(workflowNodes.workflowId, workflowId)),
                )
                .then((r) => r[0]),
            ]);
            if (!source) throw new NodeNotFoundError(sourceNodeId);
            if (!target) throw new NodeNotFoundError(targetNodeId);

            const existing = await tx
              .select()
              .from(workflowEdges)
              .where(
                and(
                  eq(workflowEdges.workflowId, workflowId),
                  eq(workflowEdges.sourceNodeId, sourceNodeId),
                  eq(workflowEdges.targetNodeId, targetNodeId),
                ),
              );
            if (existing.length === 0) {
              throw new Error(
                `there is no edge from "${source.label}" to "${target.label}" to splice into — ` +
                  `call workflow_inspect and use the ids from its edge list`,
              );
            }

            // Sit the new node on the line it interrupts, so the canvas reads
            // in the order it now runs without anyone dragging it.
            const sp = (source.position as { x?: number; y?: number }) ?? {};
            const tp = (target.position as { x?: number; y?: number }) ?? {};
            const position =
              typeof sp.x === 'number' && typeof tp.x === 'number'
                ? { x: Math.round((sp.x + tp.x) / 2), y: Math.round(((sp.y ?? 0) + (tp.y ?? 0)) / 2) }
                : await nextNodePosition(workflowId, tx);

            const node = await createNode({
              workflowId,
              type: op.type,
              label: op.label,
              config: op.config,
              position,
              actor,
              reason,
              tx,
            });
            if (op.ref) refs.set(op.ref, node.id);

            for (const e of existing) {
              await deleteEdge({ workflowId, edgeId: e.id, actor, reason, tx });
              events.push({ workflowId, kind: 'edge_removed', edgeId: e.id, ts: Date.now() });
            }

            const upstream = await createEdge({
              workflowId,
              sourceNodeId,
              targetNodeId: node.id,
              sourceHandle: existing[0].sourceHandle,
              actor,
              reason,
              tx,
            });
            const downstream = await createEdge({
              workflowId,
              sourceNodeId: node.id,
              targetNodeId,
              targetHandle: existing[0].targetHandle,
              actor,
              reason,
              tx,
            });

            for (const edge of [upstream, downstream]) {
              events.push({
                workflowId,
                kind: 'edge_added',
                edgeId: edge.id,
                edge: {
                  id: edge.id,
                  sourceNodeId: edge.sourceNodeId,
                  targetNodeId: edge.targetNodeId,
                  sourceHandle: edge.sourceHandle,
                  targetHandle: edge.targetHandle,
                },
                ts: Date.now(),
              });
            }
            events.push({
              workflowId,
              kind: 'node_added',
              nodeId: node.id,
              summary: node.label,
              node: {
                id: node.id,
                type: node.type,
                label: node.label,
                config: node.config,
                position: node.position,
              },
              ts: Date.now(),
            });
            outcomes.push({
              op: op.op,
              summary: `spliced ${op.type} node "${node.label}" between "${source.label}" and "${target.label}"`,
              nodeId: node.id,
            });
            break;
          }

          default: {
            // Unreachable through the type, but ops arrive as JSON from a model
            // and an op kind nobody implemented used to match no case, push no
            // outcome and throw nothing — a silently dropped edit reported as a
            // success. The caller screens ops against the same list first; this
            // is the backstop that makes the drop impossible rather than
            // unlikely.
            const kind = (op as { op?: unknown }).op;
            throw new Error(
              `unknown op "${String(kind)}" — the six shapes are add_node, update_node, ` +
                `remove_node, add_edge, remove_edge, insert_between`,
            );
          }
        }
      } catch (err) {
        discardAuditObs(tx);
        throw new AmendOpError(i, op.op, err);
      }
    }
  });

  // The audit rows are committed now, so the observability bus may hear of them.
  if (txRef.current) flushAuditObs(txRef.current);
  for (const e of events) publishWorkflowUpdate(e);

  return { workflowId, outcomes };
}
