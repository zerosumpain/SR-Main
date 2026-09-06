import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ setting: vi.fn(), chat: vi.fn() }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: mocks.setting }));
vi.mock('$lib/server/models/workload-settings', () => ({ resolveChatTurnModel: mocks.chat }));
import { resolveDaydreamModel } from './model';

describe('daydream model inheritance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setting.mockResolvedValue(null);
    mocks.chat.mockResolvedValue({ provider: 'codex', modelId: 'codex/gpt-5.6-terra' });
  });
  it('follows the JKAI default as it changes between runs', async () => {
    expect((await resolveDaydreamModel()).modelId).toBe('codex/gpt-5.6-terra');
    mocks.chat.mockResolvedValue({ provider: 'codex', modelId: 'codex/gpt-5.6-luna' });
    expect((await resolveDaydreamModel()).modelId).toBe('codex/gpt-5.6-luna');
  });
  it('preserves an explicit daydream override', async () => {
    mocks.setting.mockResolvedValue({ modelId: 'codex/gpt-5.6-luna' });
    expect((await resolveDaydreamModel()).modelId).toBe('codex/gpt-5.6-luna');
    expect(mocks.chat).not.toHaveBeenCalled();
  });
});
