import { json, error } from '@sveltejs/kit';
import { invokeLaneFor } from '$lib/server/invoke-auth';
import { loadToolRegistry } from '$lib/workflows/site-tools/load-registry';
import { remoteInvokeTarget } from '$lib/workflows/site-tools/remote';
import type { CataloguePayload } from '$lib/workflows/site-tools/invoke-contract';
import type { RequestHandler } from './$types';

/**
 * The tool catalogue, for a chat process that does not live inside this one.
 *
 * Not just names. The first cut of this served `{name, destructive}` on the
 * theory that a chat process composing a prompt gets the full definitions "from
 * the same place it always did" — but that place is `site-tools/registry`, the
 * 175-module barrel the boundary exists to leave behind. Six modules on chat's
 * path read it without running anything: the prompt builder, the meta-tools, the
 * platform guard, the custom-tool loader, the chat loop, and the executor's own
 * predicates. Serving them names only left five of them holding the catalogue,
 * and with it the workflow node registry underneath it — 256 files a chat
 * process in another repository cannot have.
 *
 * One document rather than an endpoint per question: the questions are all views
 * of the same list, and five endpoints would be five things to keep in step. It
 * is cached for a minute on the caller's side, which is the staleness chat
 * already tolerates — the self-improvement engine registers tools live.
 */
export const GET: RequestHandler = async ({ request }) => {
	if (invokeLaneFor(request) === 'none') throw error(401, 'invalid token');
	// A process that delegates its own tools has no catalogue worth serving, and
	// answering would let a self-pointing configuration look like it works.
	if (remoteInvokeTarget()) throw error(409, 'this process delegates its tools and does not serve them');

	const registry = await loadToolRegistry();
	const payload: CataloguePayload = {
		tools: registry.getTools().map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.parameters,
			toolset: t.toolset,
			category: t.category,
			destructive: t.destructive === true
		})),
		toolsets: registry.getAvailableToolsets(),
		manifest: registry.getToolsetManifest(),
		promptSection: registry.buildSystemPromptSection()
	};
	return json(payload);
};
