import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryState = vi.fn();
const mockCallService = vi.fn();
const mockFireEvent = vi.fn();
const mockGetHistory = vi.fn();
const mockRenderTemplate = vi.fn();

vi.mock('$lib/workflows/homeassistant/service', () => ({
  getHomeAssistantService: () => ({
    queryState: mockQueryState,
    callService: mockCallService,
    fireEvent: mockFireEvent,
    getHistory: mockGetHistory,
    renderTemplate: mockRenderTemplate,
  }),
}));

import { homeAssistantExecutor, homeAssistantDef } from '$lib/workflows/nodes/home-assistant';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

const mockContext: ExecutionContext = makeExecutionContext({
  runId: 'run-1',
  workflowId: 'wf-1',
  workspaceDir: '/tmp',
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  getOutgoingEdges: vi.fn().mockReturnValue([]),
  getIncomingEdges: vi.fn().mockReturnValue([]),
  getNodeConfig: vi.fn(),
});

describe('homeAssistantExecutor', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('queries entity state', async () => {
    mockQueryState.mockResolvedValue({
      success: true,
      data: { entity_id: 'light.living_room', state: 'on', attributes: { brightness: 255 } },
    });
    const result = await homeAssistantExecutor.execute(
      {}, { operation: 'query_state', entityId: 'light.living_room' }, mockContext,
    );
    expect(mockQueryState).toHaveBeenCalledWith('light.living_room');
    expect(result.output.success).toBe(true);
    expect(result.output.count).toBe(1);
    expect((result.output.entities as unknown[])[0]).toMatchObject({
      entity_id: 'light.living_room',
      state: 'on',
    });
  });

  it('calls a service with interpolated entity ID', async () => {
    mockCallService.mockResolvedValue({ success: true, data: [{}] });
    const result = await homeAssistantExecutor.execute(
      { output: { entity: 'light.kitchen' } },
      { operation: 'call_service', entityId: '{{input.output.entity}}', domain: 'light', service: 'turn_on', serviceData: '{"brightness": 128}' },
      mockContext,
    );
    expect(mockCallService).toHaveBeenCalledWith('light', 'turn_on', 'light.kitchen', { brightness: 128 });
    expect(result.output.success).toBe(true);
  });

  it('fires an event', async () => {
    mockFireEvent.mockResolvedValue({ success: true, data: { message: 'Event fired.' } });
    const result = await homeAssistantExecutor.execute(
      {}, { operation: 'fire_event', eventType: 'custom_alert', eventData: '{"level":"high"}' }, mockContext,
    );
    expect(mockFireEvent).toHaveBeenCalledWith('custom_alert', { level: 'high' });
    expect(result.output.success).toBe(true);
  });

  it('gets history', async () => {
    mockGetHistory.mockResolvedValue({ success: true, data: [[{ state: '21.5' }]] });
    const result = await homeAssistantExecutor.execute(
      {}, { operation: 'get_history', entityId: 'sensor.temp', historyStart: '2026-04-14T00:00:00Z', historyEnd: '2026-04-14T12:00:00Z' }, mockContext,
    );
    expect(mockGetHistory).toHaveBeenCalledWith('sensor.temp', '2026-04-14T00:00:00Z', '2026-04-14T12:00:00Z');
    expect(result.output.success).toBe(true);
  });

  it('renders a template', async () => {
    mockRenderTemplate.mockResolvedValue({ success: true, data: { result: 'on' } });
    const result = await homeAssistantExecutor.execute(
      {}, { operation: 'render_template', template: '{{ states("light.living_room") }}' }, mockContext,
    );
    expect(mockRenderTemplate).toHaveBeenCalledWith('{{ states("light.living_room") }}');
    expect(result.output.success).toBe(true);
  });

  it('returns error for missing operation', async () => {
    const result = await homeAssistantExecutor.execute({}, {}, mockContext);
    expect(result.output.success).toBe(false);
    expect(result.output.error).toContain('operation');
  });
});

describe('homeAssistantDef', () => {
  it('is an integration node', () => {
    expect(homeAssistantDef.type).toBe('home-assistant');
    expect(homeAssistantDef.category).toBe('integration');
  });

  it('has input and output ports', () => {
    expect(homeAssistantDef.inputs).toHaveLength(1);
    expect(homeAssistantDef.outputs).toHaveLength(1);
  });

  it('has llmDescription', () => {
    expect(homeAssistantDef.llmDescription).toBeDefined();
    expect(homeAssistantDef.llmDescription!.length).toBeGreaterThan(20);
  });
});
