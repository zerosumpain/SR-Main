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
  { id: 'glm-5.2', label: 'GLM 5.2', description: 'Newest GLM-5.2 — latest flagship' },
  { id: 'glm-5.1', label: 'GLM 5.1', description: 'GLM-5.1 — high quality' },
  { id: 'glm-5-turbo', label: 'GLM 5 Turbo', description: 'Faster/cheaper GLM-5 variant' },
  { id: 'glm-5v-turbo', label: 'GLM 5V Turbo', description: 'Multimodal (vision) GLM-5 turbo' },
];

export const DEFAULT_GLM_MODEL_ID = 'glm-5.1';
