// Shared model option lists for LLM-flavoured node panels.
//
// Despite the filename, the canonical chat default for jkai is z.ai (GLM*),
// not Vertex/Anthropic. The naming reflects what `$lib/vertex` *would have*
// been if the project had landed on Vertex — instead we route through
// `resolveLLMClient` (src/lib/workflows/nodes/llm-helpers.ts):
//
//   - empty / sentinel       → admin chat default (currently `glm-5-turbo`)
//   - bare id (no slash)     → admin default's provider with this modelId
//   - slashed id (e.g.       → OpenRouter
//     `openai/gpt-4o`)
//
// So the panels list a curated mix of bare GLM ids + slashed OpenRouter ids
// and the routing falls out automatically. This file just keeps the list
// in one place so all the panels render the same options.

export interface ModelOption {
  /** Stored as `config.model`. Empty string → admin default. */
  value: string;
  /** Human-readable label for the dropdown. */
  label: string;
}

/**
 * Default option list for jkai-flavoured LLM nodes (LlmCall, LlmAgent,
 * LlmRouter). Includes the empty "Default" sentinel so users can fall
 * back to the admin-configured chat default.
 */
export const VERTEX_MODEL_OPTIONS: ModelOption[] = [
  { value: '', label: 'Default (site setting)' },
  { value: 'glm-5-turbo', label: 'GLM 5 Turbo — Z.AI' },
  { value: 'glm-5.1', label: 'GLM 5.1 — Z.AI' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
  { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
  { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];

/**
 * Variant for the Think node — defaults to a concrete model rather than the
 * admin sentinel (the node itself defaults to `glm-5-turbo`).
 */
export const THINK_MODEL_OPTIONS: ModelOption[] = [
  { value: 'glm-5-turbo', label: 'GLM 5 Turbo — Z.AI (jkai default)' },
  { value: 'glm-5.1', label: 'GLM 5.1 — Z.AI' },
  { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini (fast, cheap)' },
  { value: 'openai/gpt-4o', label: 'GPT-4o (balanced)' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (smart)' },
  { value: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4 (very fast)' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
];
