/**
 * Concurrency limiting for the deep-research engine.
 *
 * `pLimit` now lives in the shared $lib/llm/resilience module (the workflow LLM
 * gateway needs the same counting-semaphore). Re-exported here so existing
 * deep-research importers (phase2, tests) keep working unchanged.
 */
export { pLimit } from '$lib/llm/resilience';

/**
 * Read the DEEPDIVE_LLM_CONCURRENCY env var. Falls back to 3.
 * Kept in a function so test code can re-invoke after setting process.env.
 */
export function getLlmConcurrencyLimit(): number {
  const raw = process.env.DEEPDIVE_LLM_CONCURRENCY;
  if (!raw) return 3;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : 3;
}
