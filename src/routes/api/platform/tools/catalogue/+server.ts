import { json, error } from '@sveltejs/kit';
import { invokeLaneFor } from '$lib/server/invoke-auth';
import { loadToolRegistry } from '$lib/tools/load-registry';
import { remoteInvokeTarget } from '$lib/tools/remote';
import { type CataloguePayload } from '$lib/tools/invoke-contract';
import { declaredTier } from '$lib/tools/declared-tier';
import { renderSkillIndex } from '$lib/jkai/skills/registry';
import { CAPABILITIES, CAPABILITIES_VERSION, isCustomToolset } from '$lib/capabilities/manifest';
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
export const GET: RequestHandler = async ({ request, url }) => {
	if (invokeLaneFor(request) === 'none') throw error(401, 'invalid token');
	// A process that delegates its own tools has no catalogue worth serving, and
	// answering would let a self-pointing configuration look like it works.
	if (remoteInvokeTarget()) throw error(409, 'this process delegates its tools and does not serve them');

	const registry = await loadToolRegistry();
	// `?audience=unattended` is what a caller with nobody to answer a gate
	// fetches (SR-Workflows: canvas nodes). It leaves out the re-enabled custom
	// tools, which run only on an attended owner turn (`executeTool` refuses
	// them anyway); the default is the owner's chat catalogue.
	const unattended = url.searchParams.get('audience') === 'unattended';
	const keep = (toolset: string) => !(unattended && isCustomToolset(toolset));
	const payload: CataloguePayload = {
		tools: registry
			.getTools()
			.filter((t) => keep(t.toolset))
			.map((t) => ({
				name: t.name,
				description: t.description,
				parameters: t.parameters,
				toolset: t.toolset,
				category: t.category,
				destructive: t.destructive === true || declaredTier(t).effect === 'destructive',
				// Manifest M0: every row carries an explicit tier; a tool that
				// declared no effect is served as destructive (fails closed).
				...declaredTier(t)
			})),
		toolsets: registry.getAvailableToolsets().filter(keep),
		manifest: registry.getToolsetManifest().filter((m) => keep(m.toolset)),
		promptSection: registry.buildSystemPromptSection(),
		// Main holds the skills library (`data/skills`) and runs `skill_view`;
		// the chat process prints this index as its Skills section.
		skillsIndex: renderSkillIndex(),
		// Slice 7b: the capability manifest. Additive; Core and Workflows read
		// it with `coerceCatalogueCapabilities` and keep their hand tables
		// when an older Main sends none.
		capabilities: CAPABILITIES.map((c) => ({
			id: c.id,
			title: c.title,
			blurb: c.blurb,
			app: c.app,
			status: c.status,
			toolsets: [...c.toolsets],
			tools: [...c.tools],
			host: c.host ?? 'main',
			alwaysOn: [...(c.alwaysOn ?? [])],
			keywords: [...(c.keywords ?? [])],
			...(c.domain ? { domain: c.domain } : {}),
			pages: [...c.pages],
			...(c.native ? { native: c.native } : {}),
			memberSafe: c.memberSafe,
			...(c.notes ? { notes: c.notes } : {})
		})),
		capabilitiesVersion: CAPABILITIES_VERSION
	};
	return json(payload);
};
