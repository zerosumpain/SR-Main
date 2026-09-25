/**
 * An `AmendOp` in plain words, for the canvas prompt bar's proposal panel —
 * the web twin of the iPhone's proposal sheet. Pure: the caller supplies how a
 * node id and a node type read to a person.
 *
 * Structural copy of `AmendOp` (from `amend.server.ts`) rather than an import:
 * this runs in the browser, and the type lives in a server module.
 */
export type ProposedOp =
  | { op: 'add_node'; ref?: string; type: string; label: string; config?: Record<string, unknown> }
  | {
      op: 'update_node';
      nodeId: string;
      config?: Record<string, unknown>;
      removeConfigKeys?: string[];
      label?: string;
      type?: string;
    }
  | { op: 'remove_node'; nodeId: string }
  | { op: 'add_edge'; sourceNodeId: string; targetNodeId: string; sourceHandle?: string }
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

export interface OpWording {
  /** 'add' | 'change' | 'remove' | 'wire' — drives the row's marker. */
  kind: 'add' | 'change' | 'remove' | 'wire';
  text: string;
}

export interface WordingContext {
  nodeName: (id: string) => string | null;
  typeLabel: (type: string) => string;
  /** Edge id → "A → B", when the edge is known. */
  edgeName?: (id: string) => string | null;
}

function quote(s: string): string {
  return `“${s}”`;
}

/** `#ref` names a step added earlier in the same proposal. */
function nameOf(id: string, ops: ProposedOp[], ctx: WordingContext): string {
  if (id.startsWith('#')) {
    const ref = id.slice(1);
    const added = ops.find(
      (o) => (o.op === 'add_node' || o.op === 'insert_between') && o.ref === ref,
    ) as { label: string } | undefined;
    return added ? `the new ${quote(added.label)}` : 'a new step';
  }
  const name = ctx.nodeName(id);
  return name ? quote(name) : 'a step that is no longer on the canvas';
}

function keyList(keys: string[]): string {
  if (keys.length <= 3) return keys.join(', ');
  return `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`;
}

export function describeOp(op: ProposedOp, ops: ProposedOp[], ctx: WordingContext): OpWording {
  switch (op.op) {
    case 'add_node':
      return { kind: 'add', text: `Add step ${quote(op.label)} (${ctx.typeLabel(op.type)})` };
    case 'insert_between':
      return {
        kind: 'add',
        text:
          `Insert step ${quote(op.label)} (${ctx.typeLabel(op.type)}) between ` +
          `${nameOf(op.sourceNodeId, ops, ctx)} and ${nameOf(op.targetNodeId, ops, ctx)}`,
      };
    case 'update_node': {
      const parts: string[] = [];
      if (op.label) parts.push(`rename it ${quote(op.label)}`);
      if (op.type) parts.push(`make it a ${ctx.typeLabel(op.type)} step`);
      const changed = Object.keys(op.config ?? {});
      if (changed.length) parts.push(`set ${keyList(changed)}`);
      if (op.removeConfigKeys?.length) parts.push(`clear ${keyList(op.removeConfigKeys)}`);
      return {
        kind: 'change',
        text: `Change ${nameOf(op.nodeId, ops, ctx)}${parts.length ? ` — ${parts.join('; ')}` : ''}`,
      };
    }
    case 'remove_node':
      return { kind: 'remove', text: `Remove ${nameOf(op.nodeId, ops, ctx)} and its connections` };
    case 'add_edge':
      return {
        kind: 'wire',
        text:
          `Connect ${nameOf(op.sourceNodeId, ops, ctx)} → ${nameOf(op.targetNodeId, ops, ctx)}` +
          (op.sourceHandle ? ` (from its ${quote(op.sourceHandle)} output)` : ''),
      };
    case 'remove_edge': {
      const edge = ctx.edgeName?.(op.edgeId);
      return { kind: 'remove', text: edge ? `Disconnect ${edge}` : 'Remove a connection' };
    }
    default:
      return { kind: 'change', text: 'An edit this page cannot describe' };
  }
}

/** Existing node ids a proposal touches — highlighted on the canvas while it is open. */
export function affectedNodeIds(ops: ProposedOp[], edgeEnds?: (id: string) => string[]): Set<string> {
  const out = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && !id.startsWith('#')) out.add(id);
  };
  for (const op of ops) {
    if (op.op === 'update_node' || op.op === 'remove_node') add(op.nodeId);
    if (op.op === 'add_edge' || op.op === 'insert_between') {
      add(op.sourceNodeId);
      add(op.targetNodeId);
    }
    if (op.op === 'remove_edge') for (const id of edgeEnds?.(op.edgeId) ?? []) add(id);
  }
  return out;
}
