import { json } from '@sveltejs/kit';
import { getSleepAnalysis } from '$lib/health/sleep-analysis-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const result = await getSleepAnalysis();
    return json(result);
  } catch (e) {
    console.error('sleep-analysis error:', e);
    return json({ error: 'Internal error' }, { status: 500 });
  }
};
