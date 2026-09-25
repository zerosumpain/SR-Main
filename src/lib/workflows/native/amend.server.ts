import { applyAmendOps, AmendOpError, WorkflowNotFoundError, type AmendOp } from '$lib/canvas/amend.server';
import { validateAmendOps } from '$lib/canvas/amend-validate.server';
import { credentialFields, SensitiveRefusalError, VersionConflictError } from '$lib/canvas/mutate.server';
import { currentGraphVersion } from './workflows.server';

/**
 * The phone's graph edit: the chat tool's validation, the canvas's executor,
 * and two refusals that belong to a phone.
 *
 * 1. `validateAmendOps` — the SAME screen `workflow_amend` applies (known op
 *    kinds, registered types, configs the registry accepts).
 * 2. `nativeOpRefusal` — no destructive-tool approval and no credential, ever,
 *    from this lane (below).
 * 3. `applyAmendOps` — one transaction, audited, version-bumped, with the
 *    graph version checked inside it.
 */

export interface NativeAmendOutcome {
  op: AmendOp['op'];
  summary: string;
  nodeId?: string;
  edgeId?: string;
}

export type NativeAmendResult =
  | { ok: true; version: number; outcomes: NativeAmendOutcome[] }
  | { ok: false; status: 404 | 409 | 422; error: string; field?: string; version?: number };

/** Every config an op would write, with where it came from. */
function opConfigs(ops: AmendOp[]): Array<{ index: number; config: Record<string, unknown> }> {
  const out: Array<{ index: number; config: Record<string, unknown> }> = [];
  ops.forEach((op, index) => {
    if ((op.op === 'add_node' || op.op === 'insert_between' || op.op === 'update_node') && op.config) {
      out.push({ index, config: op.config as Record<string, unknown> });
    }
  });
  return out;
}

/**
 * What the phone may never write, even where the chat tools may.
 *
 * - `allowDestructive: true` on a site-tool step is the switch that lets a run
 *   send, publish or delete (once an approval step sits upstream). Turning it
 *   on is a decision to make where the approval wiring is visible — the canvas
 *   — not from a form field on a lock-screen-adjacent device. Turning it OFF is
 *   always allowed.
 * - A live credential in a config. `mutateNodeConfig`/`createNode` would refuse
 *   it mid-transaction anyway; refusing up front gives the phone the field
 *   name without a rollback.
 */
export function nativeOpRefusal(ops: AmendOp[]): { error: string; field?: string } | null {
  for (const { index, config } of opConfigs(ops)) {
    if (config.allowDestructive === true) {
      return {
        error:
          `Step ${index + 1} would let a tool send, publish or delete. ` +
          'Switch that on from the canvas on the web, where its approval step is visible.',
        field: 'allowDestructive',
      };
    }
    const secrets = credentialFields(config);
    if (secrets.length > 0) {
      return {
        error:
          `Step ${index + 1} has what looks like a password or API key in "${secrets[0]}". ` +
          'Keys never go in a step’s settings — store it as a credential on the site and refer to it by name.',
        field: secrets[0],
      };
    }
  }
  return null;
}

/** Validate without writing — shared by `/amend` and `/ask`, so a proposal is judged as an edit would be. */
export async function screenNativeOps(ops: AmendOp[]): Promise<{ error: string; field?: string } | null> {
  const invalid = await validateAmendOps(ops);
  if (invalid) return { error: invalid.error };
  return nativeOpRefusal(ops);
}

export async function applyNativeAmend(input: {
  workflowId: string;
  ops: AmendOp[];
  expectedVersion?: number;
}): Promise<NativeAmendResult> {
  const { workflowId, ops, expectedVersion } = input;

  const refused = await screenNativeOps(ops);
  if (refused) return { ok: false, status: 422, ...refused };

  let result;
  try {
    result = await applyAmendOps({
      workflowId,
      ops,
      actor: 'native',
      reason: 'iPhone edit',
      precondition:
        typeof expectedVersion === 'number'
          ? async (tx) => {
              const current = await currentGraphVersion(workflowId, tx);
              if (current !== expectedVersion) throw new VersionConflictError(current, expectedVersion);
            }
          : undefined,
    });
  } catch (err) {
    if (err instanceof WorkflowNotFoundError) return { ok: false, status: 404, error: 'Workflow not found' };
    const cause = err instanceof AmendOpError ? err.cause : err;
    if (cause instanceof VersionConflictError) {
      return {
        ok: false,
        status: 409,
        error: 'This workflow changed since you opened it. Reload and try again.',
        version: cause.currentVersion,
      };
    }
    if (cause instanceof SensitiveRefusalError) {
      return {
        ok: false,
        status: 422,
        error: `That looks like a password or API key in "${cause.fields[0]}". Store it as a credential instead.`,
        field: cause.fields[0],
      };
    }
    // A missing node or edge, an endpoint from another canvas, a bad ref: the
    // executor's sentence names the op, which is what the phone shows.
    if (err instanceof AmendOpError) return { ok: false, status: 422, error: err.message };
    throw err;
  }

  return {
    ok: true,
    version: await currentGraphVersion(workflowId),
    // `before` images stay server-side: they are the undo record for the
    // chat's own follow-up turn, and carry config values the phone did not
    // send and has no use for.
    outcomes: result.outcomes.map(({ op, summary, nodeId, edgeId }) => ({
      op,
      summary,
      ...(nodeId ? { nodeId } : {}),
      ...(edgeId ? { edgeId } : {}),
    })),
  };
}
