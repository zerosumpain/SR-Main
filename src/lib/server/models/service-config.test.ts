import { describe, it, expect, vi } from 'vitest';

/**
 * The served configuration is an allow-list and must never carry a credential,
 * even when the database hands one back.
 */
const h = vi.hoisted(() => ({
  rows: [
    { key: 'jkai.chat.default_model', value: { modelId: 'deepseek/deepseek-v4-flash' } },
    { key: 'jkai.projects.chat_model', value: { modelId: 'z-ai/glm-5.2' } },
    { key: 'codex.enabled', value: { enabled: true } },
    // What a widened query might return; the snapshot must still drop them.
    { key: 'openrouter.api_key', value: { value: 'sk-or-should-never-leave' } },
    { key: 'jkai.secret_model', value: { modelId: 'x' } },
    { key: 'whatsapp.bridge', value: { url: 'http://x' } },
  ],
}));

vi.mock('$lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => h.rows }) }) },
}));
vi.mock('$lib/llm/model-source', () => ({
  loadCatalogue: async () => [
    { id: 'a/b', promptPrice: 1e-7, completionPrice: 2e-7, maxCompletionTokens: 8192, inputModalities: ['text'], modality: 'text->text', supportedParameters: ['reasoning'] },
  ],
}));
vi.mock('./settings', () => ({
  resolveDefaultModel: async () => ({ provider: 'openrouter', modelId: 'deepseek/deepseek-v4-flash' }),
  isCodexEnabled: async () => true,
}));
vi.mock('./workload-settings', () => ({
  resolveWorkloadModel: async (def: { id: string }) => {
    if (def.id === 'vision') throw new Error('boom');
    return { provider: 'openrouter', modelId: `m/${def.id}` };
  },
}));

const { buildModelConfigSnapshot, isServedSettingKey, SERVED_SETTING_KEYS } = await import('./service-config');

describe('model service configuration', () => {
  it('never serves a credential-shaped key', async () => {
    const snap = await buildModelConfigSnapshot(new Date('2026-10-02T12:00:00Z'));
    expect(JSON.stringify(snap)).not.toContain('sk-or-should-never-leave');
    expect(Object.keys(snap.settings).sort()).toEqual(['codex.enabled', 'jkai.chat.default_model', 'jkai.projects.chat_model']);
    expect(isServedSettingKey('openrouter.api_key')).toBe(false);
    expect(SERVED_SETTING_KEYS).not.toContain('openrouter.api_key');
  });

  it('includes the resolution, the codex flag and the catalogue', async () => {
    const snap = await buildModelConfigSnapshot(new Date('2026-10-02T12:00:00Z'));
    expect(snap.contract).toBe(1);
    expect(snap.resolved.codexEnabled).toBe(true);
    expect(snap.resolved.defaultModel.modelId).toBe('deepseek/deepseek-v4-flash');
    expect(snap.resolved.workloads['project-chat']).toEqual({ provider: 'openrouter', modelId: 'm/project-chat' });
    // One role that fails to resolve is left to the application's fallback.
    expect(snap.resolved.workloads.vision).toBeUndefined();
    expect(snap.catalogue[0]).toMatchObject({ id: 'a/b', maxCompletionTokens: 8192 });
  });

  it('serves every workload key in the registry and the routing keys', () => {
    expect(SERVED_SETTING_KEYS).toContain('jkai.projects.chat_model');
    expect(SERVED_SETTING_KEYS).toContain('jkai.routing.assignments');
    expect(SERVED_SETTING_KEYS).toContain('jkai.chat.thinking_level');
  });
});
