import { json, error } from '@sveltejs/kit';
import { invokeLaneFor } from '$lib/server/invoke-auth';
import { loadToolRegistry } from '$lib/workflows/site-tools/load-registry';
import { remoteInvokeTarget } from '$lib/workflows/site-tools/remote';
import type { RequestHandler } from './$types';

/**
 * What tools exist, and which of them need a human.
 *
 * Without this the invoke contract is half a seam. `executeSiteTool` is not the
 * only thing that reads the catalogue: `isRegisteredTool` decides whether chat
 * calls a tool at all, and `isDestructive` decides whether it raises a
 * confirmation card first. Both are the same question — "what does the
 * catalogue say about this name" — and both are on the far side of the boundary
 * once chat moves.
 *
 * Leaving them local would have failed in two ways, one loud and one silent:
 * every Main tool would answer `Unknown function: …` and never reach the invoke
 * endpoint at all, and — if only the first were fixed — every destructive tool
 * would report `false` and the confirmation card would quietly stop appearing.
 * The second is the one worth building an endpoint to avoid.
 *
 * Two fields per tool, deliberately. This is not the manifest: no descriptions,
 * no schemas, nothing the model reads. A chat process composing a prompt needs
 * the full definitions, but it gets those from the same place it always did —
 * this answers only the two questions the chat LOOP asks about a name it has
 * already been given.
 */
export const GET: RequestHandler = async ({ request }) => {
	if (invokeLaneFor(request) === 'none') throw error(401, 'invalid token');
	if (remoteInvokeTarget()) throw error(409, 'this process delegates its tools and does not serve them');

	const registry = await loadToolRegistry();
	return json({
		tools: registry.getTools().map((t) => ({ name: t.name, destructive: t.destructive === true })),
	});
};
