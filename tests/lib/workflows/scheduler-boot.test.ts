import { describe, it, expect, vi } from 'vitest';

// Mock the DB and scheduler before importing index
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock('$lib/workflows/scheduler', () => ({
  startScheduler: vi.fn().mockResolvedValue(undefined),
}));

// Mock all the heavy deps that index.ts imports
vi.mock('$lib/workflows/whatsapp/service', () => ({
  getWhatsAppService: vi.fn(),
}));
vi.mock('$lib/workflows/whatsapp/orchestrator-bridge', () => ({
  OrchestratorBridge: vi.fn(),
}));
vi.mock('$lib/workflows/prompts/loader', () => ({
  syncPrompts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/workflows/site-tools/custom-tool-loader', () => ({
  loadCustomTools: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/workflows/chat/memory-review', () => ({
  startMemoryReview: vi.fn(),
}));
vi.mock('$lib/workflows/homeassistant/service', () => ({
  initHomeAssistantService: vi.fn(),
}));
vi.mock('$lib/workflows/orchestrator/dynamic-nodes', () => ({
  DYNAMIC_NODES_DIR: '/tmp/test-nodes',
  loadDynamicNodeDefinitions: vi.fn().mockReturnValue([]),
  loadDynamicNodeExecutor: vi.fn().mockResolvedValue(null),
  ensureDynamicNodesDir: vi.fn(),
}));
vi.mock(import('$lib/db/schema'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});
vi.mock(import('drizzle-orm'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual };
});

describe('scheduler boot', () => {
  it('calls startScheduler on module load', async () => {
    const { startScheduler } = await import('$lib/workflows/scheduler');
    await import('$lib/workflows/index');
    expect(startScheduler).toHaveBeenCalled();
  }, 30000);
});
