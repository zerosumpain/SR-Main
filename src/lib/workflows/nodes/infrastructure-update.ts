import type { ExecutionContext, JsonSchema, NodeExecutor, NodeResult } from '../types';
import { getHomeAssistantService } from '../homeassistant/service';

export { infrastructureUpdateDef } from './infrastructure-update.def';
export const SAFE_UPDATE_ACTIONS = ['verify_only', 'home_assistant_check'] as const;
type SafeAction = typeof SAFE_UPDATE_ACTIONS[number];

function hasApprovedUpstream(context: ExecutionContext): boolean {
  const id = context._currentNodeId;
  if (!id) return false;
  const seen = new Set<string>();
  const queue = context.getIncomingEdges(id).map((edge) => edge.sourceNodeId);
  while (queue.length) {
    const nodeId = queue.shift()!;
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = context.getNodeConfig(nodeId);
    if (node?.type === 'approval') return true;
    queue.push(...context.getIncomingEdges(nodeId).map((edge) => edge.sourceNodeId));
  }
  return false;
}

export function validateUpdateManifest(input: Record<string, unknown>, configuredAction: unknown): SafeAction {
  if (input.approved !== true) throw new Error('infrastructure-update: explicit approved:true input is required.');
  if (!hasOwn(input, 'manifest') || !input.manifest || typeof input.manifest !== 'object' || Array.isArray(input.manifest)) throw new Error('infrastructure-update: a manifest object is required.');
  const manifest = input.manifest as Record<string, unknown>;
  if (Object.keys(manifest).some((key) => key !== 'action')) throw new Error('infrastructure-update: manifest may only contain the allowlisted action.');
  if (manifest.action !== configuredAction || !SAFE_UPDATE_ACTIONS.includes(manifest.action as SafeAction)) throw new Error('infrastructure-update: manifest action is not allowlisted or does not match configured action.');
  return manifest.action as SafeAction;
}
function hasOwn(value: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }

export const infrastructureUpdateExecutor: NodeExecutor = {
  type: 'infrastructure-update',
  async execute(input: Record<string, unknown>, config: Record<string, unknown>, context: ExecutionContext): Promise<NodeResult> {
    const action = validateUpdateManifest(input, config.action);
    if (!hasApprovedUpstream(context)) throw new Error('infrastructure-update: an approval node must be wired upstream.');
    if (context.dryRun) return { output: { action, simulated: true, verified: false }, rowCount: 1, logs: ['[dry-run] update action suppressed.'] };
    if (action === 'verify_only') return { output: { action, applied: false, verified: true, rollbackNeeded: false, message: 'No update operation is implemented; verification-only manifest completed.' }, rowCount: 1 };
    const health = await getHomeAssistantService().testConnection();
    return { output: { action, applied: false, verified: health.success, rollbackNeeded: !health.success, health: health.success ? health.data : undefined, failure: health.success ? undefined : health.error }, rowCount: 1 };
  },
  getInputSchema(): JsonSchema { return { type: 'object', required: ['approved', 'manifest'], description: 'approved:true from an approval node and {manifest:{action}} only.' }; },
  getOutputSchema(): JsonSchema { return { type: 'object', properties: { applied: { type: 'boolean' }, verified: { type: 'boolean' }, rollbackNeeded: { type: 'boolean' } } }; },
};
