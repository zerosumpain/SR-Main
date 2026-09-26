export type WorkflowOwner = 'main' | 'workflows';
export type JkaiCoreOwner = 'main' | 'core';
function configuredOwner<T extends string>(
  value: string | undefined,
  key: string,
  allowed: readonly T[],
): T {
  const owner = (value ?? 'main').trim().toLowerCase();
  if (allowed.includes(owner as T)) return owner as T;
  throw new Error(`${key} must be ${allowed.join(' or ')}`);
}
export function workflowOwner(env: NodeJS.ProcessEnv = process.env): WorkflowOwner {
  return configuredOwner(env.SR_WORKFLOWS_OWNER, 'SR_WORKFLOWS_OWNER', ['main', 'workflows']);
}

export function jkaiCoreOwner(env: NodeJS.ProcessEnv = process.env): JkaiCoreOwner {
  return configuredOwner(env.SR_JKAI_CORE_OWNER, 'SR_JKAI_CORE_OWNER', ['main', 'core']);
}
