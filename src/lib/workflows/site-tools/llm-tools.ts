// src/lib/workflows/site-tools/llm-tools.ts
//
// The LLM-facing view of the tool catalogue.
//
// Every accessor here is async and loads `./registry` dynamically. That module
// imports all 52 tool modules for their register() side effects, and through a
// cycle back via general-chat it reaches the workflow engine — so a static
// import of it put 696 files in the closure of anything that assembles a
// prompt. Loading it on demand costs the same once and takes the catalogue off
// the static graph.

import { toolsetDefinitions, toolDefinitionsByName, systemPromptSection } from './catalogue';

export { getMetaToolDefinitions } from './meta-tools';

/** OpenAI-format definitions for one toolset — general chat's dynamic activation. */
export async function getToolsetDefinitions(toolset: string) {
	return toolsetDefinitions(toolset);
}

/** OpenAI-format definitions for specific tools, by name. */
export async function getToolDefinitionsByName(names: readonly string[]) {
	return toolDefinitionsByName(names);
}

/** The site-tools section of the system prompt. */
export async function buildSiteSystemPromptSection() {
	return systemPromptSection();
}
