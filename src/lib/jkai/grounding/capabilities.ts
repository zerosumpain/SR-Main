import { describeWithPolicy, type ToolPolicyVersion } from '$lib/toolpolicy/policy';

export { rankCapabilities as resolveCapabilities } from '$lib/utils/capability-ranking';

export function applyCapabilityPolicy<T extends { function: { name: string; description?: string } }>(
  definitions: T[], policy: ToolPolicyVersion,
): T[] {
  return definitions.map(t => ({ ...t, function: { ...t.function,
    description: describeWithPolicy(policy, t.function.name, t.function.description ?? ''),
  } }));
}
