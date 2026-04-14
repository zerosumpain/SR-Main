import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPromptFiles, syncPrompts } from '$lib/workflows/prompts/loader';

export const GET: RequestHandler = async () => {
  const files = getPromptFiles();
  return json({ files });
};

export const POST: RequestHandler = async () => {
  await syncPrompts();
  const files = getPromptFiles();
  return json({ success: true, files });
};
