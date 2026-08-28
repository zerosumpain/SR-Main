// src/lib/workflows/site-tools/llm-tools.ts

import { buildSystemPromptSection, getToolsetDefinitions, getToolDefinitionsByName } from './registry';
import { META_TOOL_DEFINITIONS } from './meta-tools';

/** Meta-tools only — used by general chat as the always-available base */
export { META_TOOL_DEFINITIONS };

/** Get tool definitions for a specific toolset — used by general chat for dynamic activation */
export { getToolsetDefinitions };
export { getToolDefinitionsByName };

export { buildSystemPromptSection as buildSiteSystemPromptSection };
