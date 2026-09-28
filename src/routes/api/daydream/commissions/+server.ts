import type { RequestHandler } from './$types';
import { commissionResponse } from '$lib/daydream/commission-http.server';

export const GET: RequestHandler = commissionResponse;
export const POST: RequestHandler = commissionResponse;
