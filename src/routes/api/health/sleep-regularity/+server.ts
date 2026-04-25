import { json } from '@sveltejs/kit';
import { getSleepRegularity } from '$lib/health/services/sleep-regularity-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    return json(await getSleepRegularity());
  } catch (err) {
    console.error('Failed to compute sleep regularity:', err);
    return json({ error: 'Failed to compute sleep regularity' }, { status: 500 });
  }
};
