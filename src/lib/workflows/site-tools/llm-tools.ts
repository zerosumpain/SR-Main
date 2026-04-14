// Re-exports from the tool registry for backwards compatibility.
// All tool definitions and system prompt logic lives in registry.ts.
import { getToolDefinitions, buildSystemPromptSection } from './registry';

export const SITE_TOOL_DEFINITIONS = getToolDefinitions();

export { buildSystemPromptSection as buildSiteSystemPromptSection };
