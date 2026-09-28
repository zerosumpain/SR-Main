import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { commissionResponse } from '$lib/daydream/commission-http.server';

export const GET: RequestHandler = withDevice(commissionResponse);
export const POST: RequestHandler = withDevice(commissionResponse);
