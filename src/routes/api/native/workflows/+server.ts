import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { allocateCanvasName, createCanvas } from '$lib/canvas/adapter.server';
import { listWorkflowCards } from '$lib/workflows/native/workflows.server';
import { startBuildFromPrompt } from '$lib/workflows/build-from-prompt.server';

/**
 * GET /api/native/workflows — every canvas workflow, needs-attention first,
 * then most recently changed.
 *
 * POST — a new canvas.
 *   { title }            → blank: `createCanvas`, exactly what POST /api/canvas
 *                          does (a trigger and the unwired chat panel), under a
 *                          slug allocated from the title rather than typed.
 *   { prompt, title? }   → built by the model in the background
 *                          (`build-from-prompt.server`); `building` reads true
 *                          on the detail until the build lands or fails.
 *   → 201 { slug, building }
 */
export const GET: RequestHandler = withDevice(async () => {
  return { workflows: await listWorkflowCards() };
});

export const POST: RequestHandler = withDevice(async ({ request }) => {
  let body: { title?: unknown; prompt?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : '';

  if (prompt) {
    const { slug } = await startBuildFromPrompt({ prompt, title: title || null });
    return json({ slug, building: true }, { status: 201 });
  }
  if (!title) {
    return json({ error: 'Give it a name, or describe what it should do.' }, { status: 400 });
  }
  const { slug } = await allocateCanvasName(title);
  await createCanvas(slug, title);
  return json({ slug, building: false }, { status: 201 });
});
