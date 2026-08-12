import { describe, expect, it, vi } from 'vitest';

vi.mock('../homeassistant/service', () => ({ getHomeAssistantService: vi.fn(() => ({ queryAllStates: vi.fn(async () => ({ success: true, data: [{ entity_id: 'sensor.ok', state: 'on' }, { entity_id: 'sensor.bad', state: 'unavailable' }] })) })) }));
vi.mock('../site-tools/executor', () => ({ executeSiteTool: vi.fn(async () => ({ success: true, data: [] })) }));
vi.mock('./data-store', () => ({ appendAtomic: vi.fn() }));

import { infrastructureStatusExecutor } from './infrastructure-status';

describe('infrastructure-status', () => {
  it('returns scoped live evidence and labels unavailable collectors without inventing health', async () => {
    const result = await infrastructureStatusExecutor.execute({}, { scope: 'all' }, { dryRun: true, workflowId: 'wf' } as never);
    expect(result.output).toMatchObject({ readOnly: true, updateCandidates: [] });
    const collectors = (result.output.collectors as Array<{ scope: string; status: string }>);
    expect(collectors).toContainEqual(expect.objectContaining({ scope: 'home_assistant', status: 'warning' }));
    expect(collectors).toContainEqual(expect.objectContaining({ scope: 'homeserv', status: 'unavailable' }));
    expect(collectors).toContainEqual(expect.objectContaining({ scope: 'pi_runner', status: 'unavailable' }));
  });
});
