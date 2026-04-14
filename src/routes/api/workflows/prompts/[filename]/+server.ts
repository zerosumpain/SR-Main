import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPromptFiles, savePromptFile, syncPrompts } from '$lib/workflows/prompts/loader';

export const GET: RequestHandler = async ({ params }) => {
  const { filename } = params;
  const files = getPromptFiles();
  const file = files.find((f) => f.name === filename);

  if (!file) {
    return json({ error: 'File not found' }, { status: 404 });
  }

  return json(file);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const { filename } = params;
  const body = await request.json();
  const { content } = body;

  if (typeof content !== 'string') {
    return json({ error: 'content is required' }, { status: 400 });
  }

  savePromptFile(filename, content);
  await syncPrompts();

  return json({ success: true });
};
