/** Main never starts Policy work; the independent application owns that lane. */
export function webWorkerOptions(
  _background: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, never> | null {
  return env.JKAI_RUN_WORKER === '1' && env.JKAI_RUN_WORKER_IN_WEB === '1' ? {} : null;
}
