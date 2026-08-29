import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadKeys, saveKeys, getKeysStatus } from '$lib/llm/keys';

export const GET: RequestHandler = async () => {
  return json(await getKeysStatus());
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const current = loadKeys();

  if (body.tavilyApiKey !== undefined) current.tavilyApiKey = body.tavilyApiKey;
  if (body.openrouterApiKey !== undefined) current.openrouterApiKey = body.openrouterApiKey;
  if (body.embeddingModel !== undefined) current.embeddingModel = body.embeddingModel;
  if (body.elevenlabsApiKey !== undefined) current.elevenlabsApiKey = body.elevenlabsApiKey;

  saveKeys(current);

  return json(await getKeysStatus());
};
