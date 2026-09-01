import { json, error, type RequestHandler } from '@sveltejs/kit';
import {
  loadStacks,
  savePrompt,
  listVersions,
  resolveStack,
  stackTokens,
  type StackId,
} from '$lib/jkai/prompts/workbench';

const STACKS: StackId[] = ['builder'];
function asStack(v: unknown): StackId {
  if (typeof v === 'string' && (STACKS as string[]).includes(v)) return v as StackId;
  throw error(400, 'stack must be "builder"');
}

/**
 * Workbench API for /jkai/agents?tab=prompts. Owner-gated by hooks (the whole /api/jkai
 * tree is). `?resolve=<stack>` returns the assembled prompt, `?versions=<stack>
 * &file=<name>` the edit history; no query returns every stack.
 */
export const GET: RequestHandler = async ({ url }) => {
  const resolve = url.searchParams.get('resolve');
  if (resolve) return json(await resolveStack(asStack(resolve)));

  const versions = url.searchParams.get('versions');
  if (versions) {
    const file = url.searchParams.get('file');
    if (!file) throw error(400, 'file is required');
    return json({ versions: await listVersions(asStack(versions), file) });
  }

  const stacks = await loadStacks();
  return json({ stacks: stacks.map((s) => ({ ...s, approxTokens: stackTokens(s.files) })) });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { stack?: string; file?: string; content?: string };
  if (typeof body.content !== 'string') throw error(400, 'content must be a string');
  if (!body.file) throw error(400, 'file is required');
  try {
    await savePrompt(asStack(body.stack), body.file, body.content);
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'save failed');
  }
  const stacks = await loadStacks();
  return json({ success: true, stacks: stacks.map((s) => ({ ...s, approxTokens: stackTokens(s.files) })) });
};
