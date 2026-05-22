import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { enumerateUnits } from '$lib/landing/hero-titles-buckets';
import { generateBatch, BATCH_SIZE } from '$lib/landing/hero-titles-service';

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid body');
  const b = body as Record<string, unknown>;

  const variantsPerBucket = clampInt(b.variantsPerBucket, 1, 5, 1);
  const headlineWords = clampInt(b.headlineWords, 1, 6, 3);
  const strapWords = clampInt(b.strapWords, 10, 40, 22);
  const style = typeof b.style === 'string' ? b.style.slice(0, 2000) : '';
  const batchIndex = clampInt(b.batchIndex, 0, 999, 0);

  const units = enumerateUnits(variantsPerBucket);
  const totalBatches = Math.ceil(units.length / BATCH_SIZE);
  if (batchIndex >= totalBatches) throw error(400, 'batchIndex out of range');

  const slice = units.slice(
    batchIndex * BATCH_SIZE,
    batchIndex * BATCH_SIZE + BATCH_SIZE,
  );
  const rows = await generateBatch(slice, { style, headlineWords, strapWords });

  return json({ totalBatches, batchIndex, rows });
};
