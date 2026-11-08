import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { braveSearch } from '$lib/deepdive/brave';

// Tests the Brave key itself, so it asks Brave directly rather than letting
// the search balancer pick a provider. Spends one request of the allowance and
// lands on /admin/ops/tavily as `admin.key-test`.
export const POST: RequestHandler = async () => {
  try {
    const data = await braveSearch('test connection', { purpose: 'admin.key-test', maxResults: 1 });
    return json({ success: true, resultCount: data.results.length, monthly: data.limits.monthly });
  } catch (err: any) {
    return json({ success: false, error: err.message ?? 'Connection failed' });
  }
};
