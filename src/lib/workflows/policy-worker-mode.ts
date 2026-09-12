/** Explicit handover: existing installations retain web execution until configured. */
export function policyWorkerMode(env: NodeJS.ProcessEnv = process.env): 'web' | 'external' {
  const mode = env.POLICY_ANALYSIS_WORKER_MODE ?? 'web';
  if (mode !== 'web' && mode !== 'external') {
    throw new Error('POLICY_ANALYSIS_WORKER_MODE must be web or external');
  }
  return mode;
}

/** General workflow execution remains independent of the policy lane. */
export function webWorkerOptions(
  background: boolean,
  env: NodeJS.ProcessEnv = process.env,
): { policyOnly?: boolean } | null {
  const mode = policyWorkerMode(env);
  if (env.JKAI_RUN_WORKER === '1' && env.JKAI_RUN_WORKER_IN_WEB === '1') return {};
  if (mode === 'external' || env.POLICY_ANALYSIS_ENABLED === '0') return null;
  return background || env.POLICY_ANALYSIS_WORKER === '1' ? { policyOnly: true } : null;
}
