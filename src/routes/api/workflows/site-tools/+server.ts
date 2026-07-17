import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTools } from '$lib/workflows/site-tools/registry';
import { isDenylistedTool } from '$lib/workflows/nodes/site-tool-denylist';

/**
 * List the site tools invocable from the `site-tool` canvas node, for the
 * SiteToolPanel's toolset-grouped picker. Denylisted tools (arbitrary-code /
 * wipe surfaces) are excluded — they can never be selected. Auth is enforced by
 * hooks (owner-gated authed area), same as the sibling workflow API routes.
 */
export const GET: RequestHandler = async () => {
  const tools = getTools()
    .filter((t) => !isDenylistedTool(t.name))
    .map((t) => ({
      name: t.name,
      toolset: t.toolset,
      description: t.description,
      destructive: t.destructive === true,
      parameters: t.parameters,
    }))
    .sort((a, b) => a.toolset.localeCompare(b.toolset) || a.name.localeCompare(b.name));

  return json({ tools });
};
