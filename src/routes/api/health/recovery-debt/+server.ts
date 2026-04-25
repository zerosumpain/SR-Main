import { json } from '@sveltejs/kit';
import { getRecoveryDebt } from '$lib/health/services/recovery-debt-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getRecoveryDebt());
  } catch (err) {
    console.error('Failed to compute recovery debt:', err);
    return json({ error: 'Failed to compute recovery debt' }, { status: 500 });
  }
};
