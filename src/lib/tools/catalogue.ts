import type { CataloguePayload } from './invoke-contract';
import { loadToolRegistry } from './load-registry';
import { remoteCatalogue, remoteInvokeTarget } from './remote';

/**
 * The seam for READING the tool catalogue, beside `executor.ts`, which is the
 * seam for running one.
 *
 * `executor.ts` was made a seam so that execution could cross a process
 * boundary. That is half the problem, and the smaller half. Six modules on
 * chat's path ask the catalogue a question without running anything — the prompt
 * builder (`llm-tools`), the meta-tools, the platform guard, the custom-tool
 * loader, the chat loop, and the executor's own predicates — and every one of
 * them reached `load-registry` directly. So `site-tools/registry` stayed on
 * chat's runtime graph however careful the executor was, and with it the 175
 * tool modules and, through `tools/workflows.ts`, the workflow node registry:
 * 256 files that a chat process running in another repository cannot have.
 *
 * Measured on the extraction branch: the route surface's runtime closure is 812
 * files, of which `workflows/site-tools` is 66 and `workflows/nodes` is 139. Both
 * enter here, through this one edge.
 *
 * ## The rule
 *
 * **Nothing outside this file and `executor.ts` may import `./load-registry`.**
 * `registry-closure.test.ts` asserts it. Reach the catalogue through a function
 * here and the day it becomes an HTTP call is the day this file changes and
 * nothing else does.
 *
 * In SR-Main every function below reads the local registry, exactly as before.
 * With `JKAI_TOOL_INVOKE_URL` set they read one cached document fetched from the
 * owning process instead.
 */

type Registry = Awaited<ReturnType<typeof loadToolRegistry>>;

/** OpenAI-shaped tool definitions, the form every prompt path wants. */
type ToolDefinition = {
	type: 'function';
	function: { name: string; description: string; parameters: unknown };
};

const asDefinition = (t: { name: string; description: string; parameters: unknown }): ToolDefinition => ({
	type: 'function',
	function: { name: t.name, description: t.description, parameters: t.parameters }
});

async function local(): Promise<Registry | null> {
	return remoteInvokeTarget() ? null : loadToolRegistry();
}

async function payload(): Promise<CataloguePayload> {
	const target = remoteInvokeTarget();
	if (!target) throw new Error('no remote catalogue configured');
	return remoteCatalogue(target);
}

export async function toolsetDefinitions(toolset: string): Promise<ToolDefinition[]> {
	const reg = await local();
	if (reg) return reg.getToolsetDefinitions(toolset) as ToolDefinition[];
	return (await payload()).tools.filter((t) => t.toolset === toolset).map(asDefinition);
}

export async function toolDefinitionsByName(names: readonly string[]): Promise<ToolDefinition[]> {
	const reg = await local();
	if (reg) return reg.getToolDefinitionsByName(names) as ToolDefinition[];
	const { tools } = await payload();
	// Silently skips a name that is not registered, exactly as the local reader
	// does: the caller is a prompt-assembly path and must not fail a turn because
	// a tool was renamed.
	return names.flatMap((n) => {
		const t = tools.find((x) => x.name === n);
		return t ? [asDefinition(t)] : [];
	});
}

export async function systemPromptSection(): Promise<string> {
	const reg = await local();
	if (reg) return reg.buildSystemPromptSection();
	return (await payload()).promptSection;
}

export async function availableToolsets(): Promise<string[]> {
	const reg = await local();
	if (reg) return reg.getAvailableToolsets();
	return (await payload()).toolsets;
}

export async function toolsetManifest(): Promise<CataloguePayload['manifest']> {
	const reg = await local();
	if (reg) return reg.getToolsetManifest();
	return (await payload()).manifest;
}

export async function isRegisteredTool(name: string): Promise<boolean> {
	const reg = await local();
	if (reg) return reg.isRegisteredTool(name);
	return (await payload()).tools.some((t) => t.name === name);
}

/**
 * **Fails CLOSED across the wire.** A name the catalogue does not carry, or a
 * catalogue that could not be read at all, is destructive: the direction of a
 * wrong answer is not symmetric, because a needless confirmation is an annoyance
 * and a skipped one sends the email.
 *
 * In-process it does NOT fail closed, deliberately — there, a name the registry
 * lacks means the tool does not exist, and the chat loop has already refused it
 * at `isRegisteredTool`. Only across a wire can silence also mean "could not
 * ask".
 */
export async function isDestructiveTool(name: string): Promise<boolean> {
	const reg = await local();
	if (reg) return reg.getTool(name)?.destructive === true;
	try {
		return (await payload()).tools.find((t) => t.name === name)?.destructive ?? true;
	} catch {
		return true;
	}
}

/** The whole list, for the two callers that genuinely want every name. */
export async function allTools(): Promise<Array<{ name: string; description: string; toolset: string; destructive: boolean }>> {
	const reg = await local();
	if (reg) {
		return reg.getTools().map((t) => ({
			name: t.name,
			description: t.description,
			toolset: t.toolset,
			destructive: t.destructive === true
		}));
	}
	return (await payload()).tools;
}

/** Name, description and argument schema — what a prompt or an audit wants. */
export async function toolShapes(): Promise<Array<{ name: string; description: string; parameters: unknown }>> {
	const reg = await local();
	if (reg) return reg.getTools().map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
	return (await payload()).tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/**
 * The full declared shape of every tool — everything except the handler.
 *
 * `getTools()` on the registry returns live `ToolDefinition`s, handler included,
 * and a caller that only reads metadata was importing the barrel for it. This is
 * that metadata, and it is the same object either side of the boundary.
 */
export async function catalogueTools(): Promise<CataloguePayload['tools']> {
	const reg = await local();
	if (reg) {
		return reg.getTools().map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.parameters,
			toolset: t.toolset,
			category: t.category,
			destructive: t.destructive === true
		}));
	}
	return (await payload()).tools;
}
