import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { viewerOf } from '$lib/server/viewer';
import { invokeWorkflowRuntime } from '$lib/workflows/runtime-client';
import { commissioningEnabled, decideCommission, prepareCommission } from './commission-service.server';
import { CommissionError, listCommissions, loadCommission } from './commission-store.server';
import { flushCommissionOutbox } from './commission-executor.server';

const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('prepare'), thoughtId: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal('decide'), id: z.string().uuid(), decision: z.enum(['approve', 'defer', 'decline', 'cancel', 'retry']),
    revision: z.number().int().positive(), specHash: z.string().regex(/^[a-f0-9]{64}$/), operationKey: z.string().uuid() }).strict(),
]);
export async function commissionResponse(event: { request: Request; url: URL; locals: App.Locals }) {
  if ((await viewerOf(event)).kind !== 'owner' || event.locals.viewingAs) return json({ error: 'Owner access required.' }, { status: 403 });
  try {
    if (event.request.method === 'GET') {
      if (!commissioningEnabled()) return json({ enabled: false, commissions: [] });
      const id = event.url.searchParams.get('id');
      return json(id ? { commission: await loadCommission(id) } : { enabled: true, commissions: await listCommissions() });
    }
    const input = command.safeParse(await event.request.json().catch(() => null));
    if (!input.success) throw new CommissionError(400, 'Invalid improvement request. Refresh and try again.');
    if (!commissioningEnabled()) throw new CommissionError(503, 'Daydream commissioning is not enabled here yet.');
    // Ensure the durable scheduler exists before accepting the first request.
    // Decisions, especially cancellation, stay available during runtime outages.
    if (input.data.action === 'prepare') await invokeWorkflowRuntime({ action: 'commission_bootstrap' });
    const p = input.data;
    const commission = p.action === 'prepare' ? await prepareCommission(p.thoughtId) : await decideCommission(p.id, p);
    // An acceleration only. The committed outbox and scheduled workflow recover it.
    void flushCommissionOutbox().catch(() => {});
    return json({ commission });
  } catch (err) {
    if (err instanceof CommissionError) return json({ error: err.message }, { status: err.status });
    console.error('[daydream-commission] request failed', err);
    return json({ error: 'The improvement service is unavailable. Your existing decisions are retained.' }, { status: 503 });
  }
}
