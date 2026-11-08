import { ramblerDay } from '$lib/landing/ramblers/day.server';
import type { PageServerLoad } from './$types';

// The same coarse bands the landing page carries, for the "right now" readout.
export const load: PageServerLoad = async () => ({ day: await ramblerDay() });
