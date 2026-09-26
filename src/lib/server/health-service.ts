import { getFromExtracted, postToExtracted } from './extracted-app';
import type { SyncResult } from '$lib/health-sync/types';

export type WhoopStatus = { connected: boolean; valid: boolean };

export function getWhoopStatus(): Promise<WhoopStatus> {
  return getFromExtracted('health', '/api/health/whoop/status', { timeoutMs: 10_000 });
}

export async function syncWhoop(): Promise<SyncResult> {
  const result = await postToExtracted<{ whoop?: SyncResult }>(
    'health', '/api/health/sync', { fullBackfill: false }, { timeoutMs: 300_000 },
  );
  if (!result.whoop) throw new Error('Health returned no WHOOP sync result');
  return result.whoop;
}

export async function queryWhoop(operation: string, options: { limit: number; start?: string; end?: string }): Promise<unknown[]> {
  const result = await postToExtracted<{ rows: unknown[] }>(
    'health', '/api/health/whoop/query', { operation, ...options }, { timeoutMs: 60_000 },
  );
  if (!Array.isArray(result.rows)) throw new Error('Health returned no WHOOP rows');
  return result.rows;
}
