import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({
  homeAssistantConfig: { id: 'id' },
}));

import { HomeAssistantService } from '$lib/workflows/homeassistant/service';

describe('HomeAssistantService', () => {
  let service: HomeAssistantService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HomeAssistantService('http://localhost:8123', 'test-token');
  });

  it('queries entity state', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({
        entity_id: 'light.living_room',
        state: 'on',
        attributes: { brightness: 255, friendly_name: 'Living Room' },
        last_changed: '2026-04-14T10:00:00Z',
        last_updated: '2026-04-14T10:00:00Z',
      }),
    });

    const result = await service.queryState('light.living_room');

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ entity_id: 'light.living_room', state: 'on' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8123/api/states/light.living_room',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('calls a service', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve([{ entity_id: 'light.living_room', state: 'off' }]),
    });

    const result = await service.callService('light', 'turn_off', 'light.living_room');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8123/api/services/light/turn_off',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ entity_id: 'light.living_room' }),
      }),
    );
  });

  it('fires an event', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ message: 'Event fired.' }),
    });

    const result = await service.fireEvent('custom_event', { key: 'value' });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8123/api/events/custom_event',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ key: 'value' }),
      }),
    );
  });

  it('gets history', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve([[{ state: '20.5', last_changed: '2026-04-14T09:00:00Z' }]]),
    });

    const result = await service.getHistory('sensor.temperature', '2026-04-14T00:00:00Z', '2026-04-14T12:00:00Z');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/history/period/2026-04-14T00:00:00Z'),
      expect.any(Object),
    );
  });

  it('renders a template', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve('Living Room is on'),
    });

    const result = await service.renderTemplate('{{ states("light.living_room") }}');

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ result: 'Living Room is on' });
  });

  it('handles API errors gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const result = await service.queryState('light.nonexistent');

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
  });

  it('handles network failures gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await service.queryState('light.test');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('parses entity registry from states response', () => {
    const states: any[] = [
      {
        entity_id: 'light.living_room_ceiling',
        state: 'on',
        attributes: { friendly_name: 'Living Room Ceiling' },
      },
      {
        entity_id: 'sensor.temperature',
        state: '21.5',
        attributes: { friendly_name: 'Temperature', unit_of_measurement: '°C' },
      },
    ];

    const entities = service.parseEntityRegistry(states);

    expect(entities).toHaveLength(2);
    expect(entities[0]).toMatchObject({
      entity_id: 'light.living_room_ceiling',
      domain: 'light',
      friendly_name: 'Living Room Ceiling',
      state: 'on',
    });
    expect(entities[1]).toMatchObject({
      entity_id: 'sensor.temperature',
      domain: 'sensor',
      friendly_name: 'Temperature',
    });
  });
});
