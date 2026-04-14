import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';

export const POST: RequestHandler = async () => {
  const service = getHomeAssistantService();
  const result = await service.testConnection();

  if (result.success) {
    return json({ connected: true, message: 'Connected to Home Assistant' });
  }

  return json({ connected: false, error: result.error }, { status: 502 });
};
