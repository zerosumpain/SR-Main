import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

export const GET: RequestHandler = async () => {
  const service = getWhatsAppService();
  return json(service.getState());
};
