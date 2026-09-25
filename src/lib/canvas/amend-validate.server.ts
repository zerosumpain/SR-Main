import type { AmendOp } from './amend.server';

/**
 * The screen every amend passes BEFORE `applyAmendOps` opens its transaction.
 *
 * It lived inline in the `workflow_amend` chat tool. The iPhone's
 * `/api/native/workflows/[slug]/amend` writes through the same executor, and a
 * second copy of these checks would be the drift `mutate.server.ts` was written
 * to end — two front doors to one table, with different ideas of what a valid
 * node is. So both callers come here, and the messages are the tool's own:
 * the model reads them as its repair instructions, the phone as a sentence.
 *
 * Registry imports are lazy, as they were in the tool, to avoid an init cycle
 * between site-tools and the workflow registry.
 */

/**
 * The op shapes, spelled out in prose rather than JSON Schema.
 *
 * A discriminated union of six op objects expands to a schema several times the
 * size of every other workflow tool's, and it is prefilled on every turn once
 * the model knows the tool exists. Prose costs a fraction of that and the
 * handler validates each op anyway — an invalid op comes back as a named
 * failure, which is the slot the model actually reads. Also the vocabulary the
 * native `/ask` prompt teaches, so a proposal is written in the ops `/amend`
 * accepts.
 */
export const AMEND_OPS_DESCRIPTION =
  'Ordered list of edits, applied as ONE transaction. Each op is an object with an `op` key:\n' +
  '• {op:"insert_between", sourceNodeId, targetNodeId, type, label, config?} — splice a new node into an EXISTING edge (the "put a delay before the WhatsApp send" case). Cuts the edge and rewires both halves.\n' +
  '• {op:"add_node", type, label, config?, position?, ref?} — `ref:"delay"` names it so a later op can point at it as "#delay" before it has an id.\n' +
  '• {op:"update_node", nodeId, config?, removeConfigKeys?, label?, type?} — config is MERGED; a null value drops the key.\n' +
  '• {op:"remove_node", nodeId} — also removes every edge touching it.\n' +
  '• {op:"add_edge", sourceNodeId, targetNodeId, sourceHandle?, targetHandle?}\n' +
  '• {op:"remove_edge", edgeId}\n' +
  'Node ids come from workflow_inspect. Any nodeId/sourceNodeId/targetNodeId may be "#ref" instead.';

/**
 * The op kinds the executor implements.
 *
 * `set_schedule` and `update_edge` are the obvious guesses (the first was in an
 * earlier draft of the tool, the second is a standalone tool), and an op kind
 * nobody implemented used to be dropped in silence and counted as applied. An
 * amend either does everything asked or nothing, so an unrecognised op fails
 * the whole call.
 */
export const KNOWN_AMEND_OPS: ReadonlySet<string> = new Set<AmendOp['op']>([
  'insert_between',
  'add_node',
  'update_node',
  'remove_node',
  'add_edge',
  'remove_edge',
]);

/** Every op that carries a node type, so the registry check happens before the transaction opens. */
export function amendOpNodeSpec(op: AmendOp): { type: string; config: Record<string, unknown> } | null {
  if (op.op === 'add_node' || op.op === 'insert_between') {
    return { type: op.type, config: (op.config ?? {}) as Record<string, unknown> };
  }
  return null;
}

/**
 * Validate a node type string against the registry. Null if valid, else an
 * error listing the valid types.
 */
export async function validateNodeType(type: string): Promise<string | null> {
  const { registry } = await import('$lib/workflows');
  if (registry.getDefinition(type)) return null;
  const valid = registry.listDefinitions().map((d) => d.type).sort();
  return `Unknown node type "${type}". Valid types: ${valid.join(', ')}. If you need a new integration, use create_node via workflow_create instead of inventing a type name.`;
}

/** Validate config against a node's configSchema + semantic rules. Null if OK, else an error string. */
export async function validateNodeConfig(type: string, config: Record<string, unknown>): Promise<string | null> {
  const { registry } = await import('$lib/workflows');
  const def = registry.getDefinition(type);
  // Defer to the shared validator from the orchestrator — same checks on every
  // entry point (unknown keys, unsupported templates, code-execute typos,
  // per-operation semantic gaps).
  const { validateNodeConfigPreSubmit } = await import('$lib/workflows/orchestrator/verify');
  const err = validateNodeConfigPreSubmit(type, config, def);
  if (err) return err;
  const missingRequired = (def?.configSchema?.required || []).filter((k: string) => !(k in config));
  if (missingRequired.length > 0) {
    return `Missing required config keys for "${type}": ${missingRequired.join(', ')}`;
  }
  return null;
}

export interface AmendValidationFailure {
  /** 0-based index of the offending op. */
  index: number;
  /** The whole sentence, already prefixed with `op N (kind):`. */
  error: string;
}

/**
 * Screen an ops list: known op kinds, registered node types, and configs the
 * registry accepts. Returns the FIRST failure, or null when every op passes.
 */
export async function validateAmendOps(ops: unknown[]): Promise<AmendValidationFailure | null> {
  if (ops.length === 0) {
    return { index: -1, error: 'Pass at least one op. See the `ops` description for the six shapes.' };
  }
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as AmendOp;
    const kind = (op as { op?: unknown } | null)?.op;
    const where = `op ${i + 1} (${typeof kind === 'string' ? kind : 'no "op" key'})`;
    if (typeof kind !== 'string' || !KNOWN_AMEND_OPS.has(kind)) {
      return {
        index: i,
        error:
          `${where}: unrecognised op. The only shapes are ${[...KNOWN_AMEND_OPS].join(', ')} — ` +
          `see the \`ops\` description. Nothing was written; re-send the whole ops list with that op ` +
          `expressed as one of those, or drop it.`,
      };
    }
    const spec = amendOpNodeSpec(op);
    if (spec) {
      const typeErr = await validateNodeType(spec.type);
      if (typeErr) return { index: i, error: `${where}: ${typeErr}` };
      const configErr = await validateNodeConfig(spec.type, spec.config);
      if (configErr) return { index: i, error: `${where}: ${configErr}` };
    }
    if (op.op === 'update_node' && typeof op.type === 'string') {
      const typeErr = await validateNodeType(op.type);
      if (typeErr) return { index: i, error: `${where}: ${typeErr}` };
    }
  }
  return null;
}
