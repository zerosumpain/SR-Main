export interface GlmModel {
  id: string;
  label: string;
  description: string;
}

// Bare GLM ids route through the z.ai coding paas (provider 'zai') — the modelId
// is passed to the API verbatim (see $lib/jkai/llm-client.ts), so these must match
// z.ai's model names exactly (verified against GET /models: glm-5.2, glm-5.1,
// glm-5, glm-5-turbo, glm-4.7, glm-4.6 are all served).
export const GLM_MODELS: GlmModel[] = [
  { id: 'glm-5-turbo', label: 'GLM 5 Turbo', description: 'Fast/cheap — best for tool-heavy agentic chats & delegation' },
  { id: 'glm-5.1', label: 'GLM 5.1', description: 'High quality — balanced' },
  { id: 'glm-5.2', label: 'GLM 5.2', description: 'Newest flagship — highest quality, ~4× slower (heavy for long agentic tasks)' },
  // glm-5v-turbo removed: the current z.ai plan 429s it ("subscription does not
  // include GLM-5V-Turbo"), so it was an un-selectable dead option.
];

export const DEFAULT_GLM_MODEL_ID = 'glm-5.2';
