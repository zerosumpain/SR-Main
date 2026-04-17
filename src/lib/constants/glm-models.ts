export interface GlmModel {
  id: string;
  label: string;
  description: string;
}

export const GLM_MODELS: GlmModel[] = [
  { id: 'glm-5.1', label: 'GLM 5.1', description: 'Full GLM-5.1 — highest quality' },
  { id: 'glm-5-turbo', label: 'GLM 5 Turbo', description: 'Faster/cheaper GLM-5 variant' },
  { id: 'glm-5v-turbo', label: 'GLM 5V Turbo', description: 'Multimodal (vision) GLM-5 turbo' },
];

export const DEFAULT_GLM_MODEL_ID = 'glm-5.1';
