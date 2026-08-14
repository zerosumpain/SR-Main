/**
 * Measured durations per depth tier.
 *
 * The launcher quotes these instead of the numbers in a tier's blurb, so
 * "how long will this take" is answered from this machine's own completed runs.
 *
 * Lives in `$lib` rather than beside the endpoint because a `+server.ts` may
 * only export request handlers — any other export makes SvelteKit reject the
 * whole route at runtime with a 500 ("Invalid export"), which is exactly how
 * this function first broke.
 */
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { RESEARCH_DEPTHS } from './depth';

export interface DepthTiming {
  p50Ms: number | null;
  p95Ms: number | null;
  n: number;
}

export async function depthTimings(): Promise<Record<string, DepthTiming>> {
  const rows = await db
    .select({ depth: researchSessions.depth, durationMs: researchSessions.durationMs })
    .from(researchSessions)
    .where(eq(researchSessions.status, 'complete'));

  const out: Record<string, DepthTiming> = {};
  for (const depth of RESEARCH_DEPTHS) {
    const ds = rows
      .filter((r) => r.depth === depth && typeof r.durationMs === 'number')
      .map((r) => r.durationMs as number)
      .sort((a, b) => a - b);
    out[depth] = ds.length
      ? {
          p50Ms: ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.5))],
          p95Ms: ds[Math.min(ds.length - 1, Math.floor(ds.length * 0.95))],
          n: ds.length,
        }
      : { p50Ms: null, p95Ms: null, n: 0 };
  }
  return out;
}
