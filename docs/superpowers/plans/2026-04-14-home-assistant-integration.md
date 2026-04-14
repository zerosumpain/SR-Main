# Home Assistant Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Home Assistant into the workflows engine with a service wrapper, workflow node with visual entity browser, and LLM function-calling tools for WhatsApp conversational smart home control.

**Architecture:** An HA service singleton wraps the REST API and caches entity/device/area registries in Postgres. A workflow node provides visual entity selection and all five HA operations. The WhatsApp orchestrator bridge gains function-calling tools so the LLM can control HA directly in conversation.

**Tech Stack:** Home Assistant REST API, Drizzle ORM (Postgres), SvelteKit, Vitest, Svelte 5

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/db/schema.ts` | Modify | Add `homeAssistantConfig` table |
| `src/lib/workflows/homeassistant/types.ts` | Create | HA types (entity, device, area, operation result) |
| `src/lib/workflows/homeassistant/service.ts` | Create | HA REST API wrapper with registry caching |
| `src/lib/workflows/homeassistant/llm-tools.ts` | Create | Function definitions + entity summary for LLM |
| `src/lib/workflows/nodes/home-assistant.ts` | Create | HA workflow node (executor + definition) |
| `src/lib/workflows/index.ts` | Modify | Register HA node, boot HA service |
| `src/lib/workflows/registry-client.ts` | Modify | Add HA node to client-side registry |
| `src/lib/workflows/whatsapp/orchestrator-bridge.ts` | Modify | Add HA function calling to LLM conversation |
| `src/lib/components/workflows/HomeAssistantConfigPanel.svelte` | Create | Tabbed config with entity browser |
| `src/lib/components/workflows/nodes/HomeAssistantNode.svelte` | Create | Canvas node component |
| `src/routes/workflows/[id]/+page.svelte` | Modify | Register HA node component + config panel |
| `src/routes/api/workflows/homeassistant/config/+server.ts` | Create | Config GET/PUT |
| `src/routes/api/workflows/homeassistant/sync/+server.ts` | Create | Registry sync |
| `src/routes/api/workflows/homeassistant/entities/+server.ts` | Create | Entity registry query |
| `src/routes/api/workflows/homeassistant/areas/+server.ts` | Create | Area registry query |
| `src/routes/api/workflows/homeassistant/test/+server.ts` | Create | Connection test |
| `tests/lib/workflows/homeassistant/service.test.ts` | Create | HA service unit tests |
| `tests/lib/workflows/homeassistant/home-assistant-node.test.ts` | Create | HA node executor tests |

---

### Task 1: DB Schema and Types

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/workflows/homeassistant/types.ts`

- [ ] **Step 1: Add homeAssistantConfig table to schema**

Add at the end of `src/lib/db/schema.ts`, after the WhatsApp tables:

```typescript
// ==========================================
// Home Assistant Integration
// ==========================================

export const homeAssistantConfig = pgTable('home_assistant_config', {
  id: text('id').primaryKey().default('default'),
  url: text('url').notNull().default('http://localhost:8123'),
  token: text('token').notNull().default(''),
  entityRegistry: jsonb('entity_registry').notNull().default(sql`'[]'::jsonb`),
  deviceRegistry: jsonb('device_registry').notNull().default(sql`'[]'::jsonb`),
  areaRegistry: jsonb('area_registry').notNull().default(sql`'[]'::jsonb`),
  lastSynced: timestamp('last_synced', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HomeAssistantConfig = typeof homeAssistantConfig.$inferSelect;
export type NewHomeAssistantConfig = typeof homeAssistantConfig.$inferInsert;
```

- [ ] **Step 2: Create HA types file**

Create `src/lib/workflows/homeassistant/types.ts`:

```typescript
export interface HAEntity {
  entity_id: string;
  domain: string;
  friendly_name: string;
  area_id: string | null;
  area_name: string | null;
  device_id: string | null;
  state: string;
}

export interface HADevice {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  area_id: string | null;
  area_name: string | null;
}

export interface HAArea {
  id: string;
  name: string;
}

export interface HAStateResponse {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface HAOperationResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type HAOperation = 'query_state' | 'call_service' | 'fire_event' | 'get_history' | 'render_template';
```

- [ ] **Step 3: Push schema to database**

```bash
cd ~/strange_rambling_svelte && npx drizzle-kit push
```

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/db/schema.ts src/lib/workflows/homeassistant/types.ts
git commit -m "feat(ha): add home assistant db table and types"
```

---

### Task 2: HA Service (REST API Wrapper)

**Files:**
- Create: `src/lib/workflows/homeassistant/service.ts`
- Create: `tests/lib/workflows/homeassistant/service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/workflows/homeassistant/service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock DB
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/homeassistant/service.test.ts
```

Expected: FAIL — `Cannot find module '$lib/workflows/homeassistant/service'`

- [ ] **Step 3: Write the HA service**

Create `src/lib/workflows/homeassistant/service.ts`:

```typescript
import type { HAEntity, HAOperationResult, HAStateResponse } from './types';

export class HomeAssistantService {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  setConfig(url: string, token: string): void {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<HAOperationResult> {
    try {
      const res = await fetch(`${this.url}${path}`, {
        method: options.method || 'GET',
        headers: this.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (!res.ok) {
        return { success: false, error: `HA API error: ${res.status} ${res.statusText}` };
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        return { success: true, data };
      }

      const text = await res.text();
      return { success: true, data: { result: text } };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async queryState(entityId: string): Promise<HAOperationResult> {
    return this.request(`/api/states/${entityId}`);
  }

  async queryAllStates(): Promise<HAOperationResult> {
    return this.request('/api/states');
  }

  async callService(
    domain: string,
    service: string,
    entityId?: string,
    data?: Record<string, unknown>,
  ): Promise<HAOperationResult> {
    const body: Record<string, unknown> = { ...data };
    if (entityId) body.entity_id = entityId;
    return this.request(`/api/services/${domain}/${service}`, { method: 'POST', body });
  }

  async fireEvent(eventType: string, data?: Record<string, unknown>): Promise<HAOperationResult> {
    return this.request(`/api/events/${eventType}`, { method: 'POST', body: data || {} });
  }

  async getHistory(
    entityId: string,
    start?: string,
    end?: string,
  ): Promise<HAOperationResult> {
    const startTime = start || new Date(Date.now() - 86400000).toISOString();
    let path = `/api/history/period/${startTime}?filter_entity_id=${entityId}`;
    if (end) path += `&end_time=${end}`;
    return this.request(path);
  }

  async renderTemplate(template: string): Promise<HAOperationResult> {
    return this.request('/api/template', { method: 'POST', body: { template } });
  }

  async testConnection(): Promise<HAOperationResult> {
    return this.request('/api/');
  }

  parseEntityRegistry(states: HAStateResponse[]): HAEntity[] {
    return states.map((s) => ({
      entity_id: s.entity_id,
      domain: s.entity_id.split('.')[0],
      friendly_name:
        (s.attributes as Record<string, unknown>)?.friendly_name as string ||
        s.entity_id.split('.')[1].replace(/_/g, ' '),
      area_id: null,
      area_name: null,
      device_id: null,
      state: s.state,
    }));
  }

  async syncRegistries(): Promise<{ entities: HAEntity[]; entityCount: number }> {
    const result = await this.queryAllStates();
    if (!result.success || !Array.isArray(result.data)) {
      throw new Error(result.error || 'Failed to fetch states');
    }

    const entities = this.parseEntityRegistry(result.data);
    return { entities, entityCount: entities.length };
  }
}

// Singleton
let _instance: HomeAssistantService | null = null;

export function getHomeAssistantService(): HomeAssistantService {
  if (!_instance) {
    _instance = new HomeAssistantService('http://localhost:8123', '');
  }
  return _instance;
}

export function initHomeAssistantService(url: string, token: string): HomeAssistantService {
  _instance = new HomeAssistantService(url, token);
  return _instance;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/homeassistant/service.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/homeassistant/service.ts tests/lib/workflows/homeassistant/service.test.ts
git commit -m "feat(ha): add Home Assistant service with REST API wrapper"
```

---

### Task 3: HA Workflow Node

**Files:**
- Create: `src/lib/workflows/nodes/home-assistant.ts`
- Create: `tests/lib/workflows/homeassistant/home-assistant-node.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/workflows/homeassistant/home-assistant-node.test.ts`:

```typescript
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

const mockContext: ExecutionContext = {
  runId: 'run-1',
  workflowId: 'wf-1',
  workspaceDir: '/tmp',
  emit: vi.fn(),
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
  getOutgoingEdges: vi.fn().mockReturnValue([]),
  getNodeConfig: vi.fn(),
};

describe('homeAssistantExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries entity state', async () => {
    mockQueryState.mockResolvedValue({
      success: true,
      data: { entity_id: 'light.living_room', state: 'on', attributes: { brightness: 255 } },
    });

    const result = await homeAssistantExecutor.execute(
      {},
      { operation: 'query_state', entityId: 'light.living_room' },
      mockContext,
    );

    expect(mockQueryState).toHaveBeenCalledWith('light.living_room');
    expect(result.output.success).toBe(true);
    expect(result.output.data).toMatchObject({ state: 'on' });
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
      {},
      { operation: 'fire_event', eventType: 'custom_alert', eventData: '{"level":"high"}' },
      mockContext,
    );

    expect(mockFireEvent).toHaveBeenCalledWith('custom_alert', { level: 'high' });
    expect(result.output.success).toBe(true);
  });

  it('gets history', async () => {
    mockGetHistory.mockResolvedValue({ success: true, data: [[{ state: '21.5' }]] });

    const result = await homeAssistantExecutor.execute(
      {},
      { operation: 'get_history', entityId: 'sensor.temp', historyStart: '2026-04-14T00:00:00Z', historyEnd: '2026-04-14T12:00:00Z' },
      mockContext,
    );

    expect(mockGetHistory).toHaveBeenCalledWith('sensor.temp', '2026-04-14T00:00:00Z', '2026-04-14T12:00:00Z');
    expect(result.output.success).toBe(true);
  });

  it('renders a template', async () => {
    mockRenderTemplate.mockResolvedValue({ success: true, data: { result: 'on' } });

    const result = await homeAssistantExecutor.execute(
      {},
      { operation: 'render_template', template: '{{ states("light.living_room") }}' },
      mockContext,
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/homeassistant/home-assistant-node.test.ts
```

Expected: FAIL — `Cannot find module '$lib/workflows/nodes/home-assistant'`

- [ ] **Step 3: Write the HA node**

Create `src/lib/workflows/nodes/home-assistant.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getHomeAssistantService } from '../homeassistant/service';
import type { HAOperation } from '../homeassistant/types';

export const homeAssistantExecutor: NodeExecutor = {
  type: 'home-assistant',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as HAOperation | undefined;
    if (!operation) {
      return { output: { success: false, error: 'No operation configured' } };
    }

    const service = getHomeAssistantService();
    const entityId = interpolateTemplate((config.entityId as string) || '', input);

    switch (operation) {
      case 'query_state': {
        if (!entityId) return { output: { success: false, error: 'No entity_id configured' } };
        const result = await service.queryState(entityId);
        return { output: result };
      }

      case 'call_service': {
        const domain = interpolateTemplate((config.domain as string) || '', input) || entityId.split('.')[0];
        const svc = interpolateTemplate((config.service as string) || '', input);
        if (!domain || !svc) return { output: { success: false, error: 'domain and service are required' } };
        let serviceData: Record<string, unknown> | undefined;
        const rawData = interpolateTemplate((config.serviceData as string) || '', input);
        if (rawData) {
          try { serviceData = JSON.parse(rawData); } catch { serviceData = undefined; }
        }
        const result = await service.callService(domain, svc, entityId || undefined, serviceData);
        return { output: result };
      }

      case 'fire_event': {
        const eventType = interpolateTemplate((config.eventType as string) || '', input);
        if (!eventType) return { output: { success: false, error: 'No event_type configured' } };
        let eventData: Record<string, unknown> | undefined;
        const rawEvent = interpolateTemplate((config.eventData as string) || '', input);
        if (rawEvent) {
          try { eventData = JSON.parse(rawEvent); } catch { eventData = undefined; }
        }
        const result = await service.fireEvent(eventType, eventData);
        return { output: result };
      }

      case 'get_history': {
        if (!entityId) return { output: { success: false, error: 'No entity_id configured' } };
        const start = interpolateTemplate((config.historyStart as string) || '', input) || undefined;
        const end = interpolateTemplate((config.historyEnd as string) || '', input) || undefined;
        const result = await service.getHistory(entityId, start, end);
        return { output: result };
      }

      case 'render_template': {
        const template = interpolateTemplate((config.template as string) || '', input);
        if (!template) return { output: { success: false, error: 'No template configured' } };
        const result = await service.renderTemplate(template);
        return { output: result };
      }

      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` } };
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in config fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
        error: { type: 'string' },
      },
    };
  },
};

export const homeAssistantDef: NodeDefinition = {
  type: 'home-assistant',
  label: 'Home Assistant',
  category: 'integration',
  description: 'Control Home Assistant: query state, call services, fire events, get history, render templates.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'query_state | call_service | fire_event | get_history | render_template' },
      entityId: { type: 'string', description: 'Target entity ID. Supports {{input.field}} templates.' },
      domain: { type: 'string', description: 'Service domain (auto-derived from entityId if not set)' },
      service: { type: 'string', description: 'Service name (e.g. turn_on, turn_off, toggle, set_temperature)' },
      serviceData: { type: 'string', description: 'JSON service data. Supports templates.' },
      eventType: { type: 'string', description: 'Event type to fire' },
      eventData: { type: 'string', description: 'JSON event data. Supports templates.' },
      historyStart: { type: 'string', description: 'ISO 8601 start time for history' },
      historyEnd: { type: 'string', description: 'ISO 8601 end time for history' },
      template: { type: 'string', description: 'Jinja2 template to render' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'query_state', entityId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    {
      key: 'operation', label: 'Operation', type: 'dropdown',
      options: [
        { value: 'query_state', label: 'Query State' },
        { value: 'call_service', label: 'Call Service' },
        { value: 'fire_event', label: 'Fire Event' },
        { value: 'get_history', label: 'Get History' },
        { value: 'render_template', label: 'Render Template' },
      ],
    },
    { key: 'entityId', label: 'Entity ID', type: 'template-textarea', placeholder: 'light.living_room_ceiling' },
    { key: 'domain', label: 'Domain', type: 'text', placeholder: 'light', advancedOnly: true },
    { key: 'service', label: 'Service', type: 'text', placeholder: 'turn_on' },
    { key: 'serviceData', label: 'Service Data (JSON)', type: 'textarea', placeholder: '{"brightness": 128}', advancedOnly: true },
    { key: 'eventType', label: 'Event Type', type: 'text', placeholder: 'custom_event', advancedOnly: true },
    { key: 'eventData', label: 'Event Data (JSON)', type: 'textarea', advancedOnly: true },
    { key: 'historyStart', label: 'History Start', type: 'template-textarea', placeholder: '2026-04-14T00:00:00Z', advancedOnly: true },
    { key: 'historyEnd', label: 'History End', type: 'template-textarea', advancedOnly: true },
    { key: 'template', label: 'Template (Jinja2)', type: 'code', placeholder: '{{ states("light.living_room") }}', advancedOnly: true },
  ],
  llmDescription: `Control Home Assistant smart home devices. Supports five operations:

1. **query_state** — Get current state of an entity. Output: { state, attributes, last_changed }
2. **call_service** — Control a device (turn_on, turn_off, set_temperature, etc.). Specify domain, service, and optionally entity_id + serviceData.
3. **fire_event** — Fire a Home Assistant event to trigger automations.
4. **get_history** — Get historical state data for an entity over a time period.
5. **render_template** — Evaluate a Jinja2 template server-side.

IMPORTANT: Output is wrapped in \`output\`. Downstream nodes access \`input.output.success\`, \`input.output.data\`, \`input.output.error\`.

All text fields support \`{{input.field}}\` template interpolation.`,
  llmExamples: [
    { operation: 'query_state', entityId: 'sensor.living_room_temperature' },
    { operation: 'call_service', entityId: 'light.kitchen', domain: 'light', service: 'turn_off' },
    { operation: 'call_service', entityId: 'climate.living_room', domain: 'climate', service: 'set_temperature', serviceData: '{"temperature": 20}' },
    { operation: 'get_history', entityId: 'sensor.temperature', historyStart: '{{input.output.start_time}}' },
  ],
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/homeassistant/home-assistant-node.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/nodes/home-assistant.ts tests/lib/workflows/homeassistant/home-assistant-node.test.ts
git commit -m "feat(ha): add Home Assistant workflow node (executor + definition)"
```

---

### Task 4: LLM Tools for WhatsApp

**Files:**
- Create: `src/lib/workflows/homeassistant/llm-tools.ts`
- Modify: `src/lib/workflows/whatsapp/orchestrator-bridge.ts`

- [ ] **Step 1: Create LLM tools module**

Create `src/lib/workflows/homeassistant/llm-tools.ts`:

```typescript
import type { HAEntity } from './types';

export const HA_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'ha_query_state',
      description: 'Get the current state and attributes of a Home Assistant entity',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'Entity ID, e.g. light.living_room_ceiling' },
        },
        required: ['entity_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ha_call_service',
      description: 'Call a Home Assistant service to control a device (turn on/off lights, set temperature, play media, etc.)',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Service domain, e.g. light, climate, media_player, switch' },
          service: { type: 'string', description: 'Service name, e.g. turn_on, turn_off, toggle, set_temperature' },
          entity_id: { type: 'string', description: 'Target entity ID' },
          data: { type: 'object', description: 'Additional service data, e.g. { "brightness": 128 } or { "temperature": 20 }' },
        },
        required: ['domain', 'service'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ha_fire_event',
      description: 'Fire a Home Assistant event to trigger automations',
      parameters: {
        type: 'object',
        properties: {
          event_type: { type: 'string', description: 'Event type name' },
          data: { type: 'object', description: 'Event data payload' },
        },
        required: ['event_type'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ha_get_history',
      description: 'Get historical state data for an entity over a time period',
      parameters: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'Entity ID to get history for' },
          start: { type: 'string', description: 'ISO 8601 start time (default: 24h ago)' },
          end: { type: 'string', description: 'ISO 8601 end time (default: now)' },
        },
        required: ['entity_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ha_render_template',
      description: 'Evaluate a Home Assistant Jinja2 template server-side',
      parameters: {
        type: 'object',
        properties: {
          template: { type: 'string', description: 'Jinja2 template string' },
        },
        required: ['template'],
      },
    },
  },
];

export function buildEntitySummary(entities: HAEntity[]): string {
  const byArea = new Map<string, HAEntity[]>();
  for (const e of entities) {
    const area = e.area_name || 'Ungrouped';
    const list = byArea.get(area) || [];
    list.push(e);
    byArea.set(area, list);
  }

  const lines: string[] = [];
  for (const [area, areaEntities] of byArea) {
    const byDomain = new Map<string, string[]>();
    for (const e of areaEntities) {
      const list = byDomain.get(e.domain) || [];
      list.push(e.friendly_name);
      byDomain.set(e.domain, list);
    }

    const parts = Array.from(byDomain.entries())
      .map(([domain, names]) => {
        if (names.length <= 3) return `${names.join(', ')} (${domain})`;
        return `${names.length} ${domain}s`;
      })
      .join(', ');

    lines.push(`${area}: ${parts}`);
  }

  return lines.join('\n');
}

export function buildHASystemPromptSection(entities: HAEntity[]): string {
  if (entities.length === 0) return '';
  const summary = buildEntitySummary(entities);
  return `\n\n--- Home Assistant Smart Home ---\nYou can control the smart home using ha_* functions. Available areas and devices:\n\n${summary}\n\nUse exact entity_id values when calling functions (e.g. "light.living_room_ceiling", not "living room ceiling light").`;
}
```

- [ ] **Step 2: Update orchestrator bridge to support function calling**

In `src/lib/workflows/whatsapp/orchestrator-bridge.ts`, make these changes:

Add imports at the top:

```typescript
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { HA_TOOL_DEFINITIONS, buildHASystemPromptSection } from '$lib/workflows/homeassistant/llm-tools';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
```

Note: `db`, `eq`, `whatsappConversations`, and `asc` are already imported. Only add the new HA imports.

Replace the LLM call section in `handleMessage` (the part that builds messages and calls `client.chat.completions.create`) with a version that:

1. Loads HA entity registry from DB
2. Appends HA context to system prompt
3. Passes `HA_TOOL_DEFINITIONS` as `tools` to the LLM call
4. Handles tool call responses in a loop (max 5 rounds):
   - Parse tool calls from the LLM response
   - Execute each `ha_*` function via `getHomeAssistantService()`
   - Feed results back as tool messages
   - Continue until the LLM responds with text (no more tool calls)

The updated `handleMessage` method should look like this (replace everything from `// Build messages for the LLM` to the end of the try block):

```typescript
      // Load HA entity context if available
      let haEntities: any[] = [];
      try {
        const [haConfig] = await db
          .select()
          .from(homeAssistantConfig)
          .where(eq(homeAssistantConfig.id, 'default'))
          .limit(1);
        if (haConfig?.token && Array.isArray(haConfig.entityRegistry)) {
          haEntities = haConfig.entityRegistry as any[];
        }
      } catch {}

      // Build messages for the LLM
      const haSection = buildHASystemPromptSection(haEntities);
      const systemContent = this.soulMd
        ? `${SYSTEM_PROMPT}${haSection}\n\n--- Personality & Style ---\n${this.soulMd}`
        : `${SYSTEM_PROMPT}${haSection}`;

      const messages: Array<any> = [
        { role: 'system', content: systemContent },
      ];

      // Add conversation history
      const recentHistory = history.slice(-MAX_HISTORY - 1, -1);
      for (const h of recentHistory) {
        messages.push({ role: h.role, content: h.content });
      }
      messages.push({ role: 'user', content: text });

      // Call LLM with HA tools
      const client = getOpenAIClient();
      const model = getModel();
      const tools = haEntities.length > 0 ? HA_TOOL_DEFINITIONS : undefined;

      let responseText = '';
      const MAX_TOOL_ROUNDS = 5;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        let response;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            response = await client.chat.completions.create({
              model,
              messages,
              temperature: 0.7,
              max_tokens: 1024,
              ...(tools ? { tools } : {}),
            });
            break;
          } catch (err: any) {
            if (err?.status === 429 && attempt < 2) {
              await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
              continue;
            }
            throw err;
          }
        }

        const choice = response?.choices[0];
        if (!choice) break;

        const msg = choice.message;

        // If no tool calls, we have the final text response
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          responseText = msg.content?.trim() || "Sorry, I couldn't generate a response.";
          break;
        }

        // Process tool calls
        messages.push(msg);

        for (const toolCall of msg.tool_calls) {
          const fnName = toolCall.function.name;
          let fnArgs: Record<string, unknown>;
          try {
            fnArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: 'Invalid JSON arguments' }) });
            continue;
          }

          let toolResult: any;
          const haService = getHomeAssistantService();

          switch (fnName) {
            case 'ha_query_state':
              toolResult = await haService.queryState(fnArgs.entity_id as string);
              break;
            case 'ha_call_service':
              toolResult = await haService.callService(
                fnArgs.domain as string,
                fnArgs.service as string,
                fnArgs.entity_id as string | undefined,
                fnArgs.data as Record<string, unknown> | undefined,
              );
              break;
            case 'ha_fire_event':
              toolResult = await haService.fireEvent(
                fnArgs.event_type as string,
                fnArgs.data as Record<string, unknown> | undefined,
              );
              break;
            case 'ha_get_history':
              toolResult = await haService.getHistory(
                fnArgs.entity_id as string,
                fnArgs.start as string | undefined,
                fnArgs.end as string | undefined,
              );
              break;
            case 'ha_render_template':
              toolResult = await haService.renderTemplate(fnArgs.template as string);
              break;
            default:
              toolResult = { error: `Unknown function: ${fnName}` };
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }
      }

      if (!responseText) {
        responseText = "Sorry, I couldn't generate a response.";
      }
```

Also remove the `[WORKFLOW_NEEDED]` marker logic — with function calling, workflows can be triggered by a dedicated tool in the future rather than a text marker.

- [ ] **Step 3: Run all WhatsApp tests**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/whatsapp/
```

Expected: All tests pass (the bridge test mocks the LLM client, so the new tool flow doesn't break existing tests).

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/homeassistant/llm-tools.ts src/lib/workflows/whatsapp/orchestrator-bridge.ts
git commit -m "feat(ha): add LLM function-calling tools for WhatsApp HA control"
```

---

### Task 5: Register Node and Boot HA Service

**Files:**
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

- [ ] **Step 1: Register HA node in server-side index**

In `src/lib/workflows/index.ts`, add the import with the other node imports:

```typescript
import { homeAssistantDef, homeAssistantExecutor } from './nodes/home-assistant';
```

Add registration with the other `registry.register()` calls:

```typescript
registry.register(homeAssistantDef, homeAssistantExecutor);
```

Add HA service boot imports at the top (alongside existing HA/WhatsApp imports):

```typescript
import { initHomeAssistantService } from './homeassistant/service';
import { homeAssistantConfig } from '$lib/db/schema';
```

Note: `db`, `eq` are already imported from the WhatsApp boot code.

Add HA boot function after the WhatsApp boot function:

```typescript
// Boot Home Assistant service if configured
async function bootHomeAssistant() {
  try {
    const [config] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);

    if (!config?.token) {
      console.log('[ha] No token configured — skipping boot');
      return;
    }

    const service = initHomeAssistantService(config.url, config.token);

    // Sync registries if stale (older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 3600000);
    if (!config.lastSynced || new Date(config.lastSynced) < oneHourAgo) {
      try {
        const { entities, entityCount } = await service.syncRegistries();
        await db.update(homeAssistantConfig).set({
          entityRegistry: entities,
          lastSynced: new Date(),
          updatedAt: new Date(),
        }).where(eq(homeAssistantConfig.id, 'default'));
        console.log(`[ha] Synced ${entityCount} entities`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('[ha] Registry sync failed:', msg);
      }
    }

    console.log('[ha] Service booted');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ha] Boot failed:', msg);
  }
}

bootHomeAssistant();
```

- [ ] **Step 2: Add HA node to client-side registry**

In `src/lib/workflows/registry-client.ts`, add the HA node definition before the `builtInDefinitions` array (same pattern as the existing client-safe definitions — no executor import, just the definition object):

```typescript
// Home Assistant definition without importing the executor (which pulls in server-only modules)
const homeAssistantDef: NodeDefinition = {
  type: 'home-assistant',
  label: 'Home Assistant',
  category: 'integration',
  description: 'Control Home Assistant: query state, call services, fire events, get history, render templates.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'query_state | call_service | fire_event | get_history | render_template' },
      entityId: { type: 'string', description: 'Target entity ID. Supports {{input.field}} templates.' },
      domain: { type: 'string', description: 'Service domain' },
      service: { type: 'string', description: 'Service name' },
      serviceData: { type: 'string', description: 'JSON service data' },
      eventType: { type: 'string', description: 'Event type to fire' },
      eventData: { type: 'string', description: 'JSON event data' },
      historyStart: { type: 'string', description: 'ISO 8601 start time' },
      historyEnd: { type: 'string', description: 'ISO 8601 end time' },
      template: { type: 'string', description: 'Jinja2 template to render' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'query_state', entityId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'query_state', label: 'Query State' },
      { value: 'call_service', label: 'Call Service' },
      { value: 'fire_event', label: 'Fire Event' },
      { value: 'get_history', label: 'Get History' },
      { value: 'render_template', label: 'Render Template' },
    ]},
    { key: 'entityId', label: 'Entity ID', type: 'template-textarea', placeholder: 'light.living_room_ceiling' },
    { key: 'domain', label: 'Domain', type: 'text', placeholder: 'light', advancedOnly: true },
    { key: 'service', label: 'Service', type: 'text', placeholder: 'turn_on' },
    { key: 'serviceData', label: 'Service Data (JSON)', type: 'textarea', placeholder: '{"brightness": 128}', advancedOnly: true },
    { key: 'eventType', label: 'Event Type', type: 'text', placeholder: 'custom_event', advancedOnly: true },
    { key: 'eventData', label: 'Event Data (JSON)', type: 'textarea', advancedOnly: true },
    { key: 'historyStart', label: 'History Start', type: 'template-textarea', placeholder: '2026-04-14T00:00:00Z', advancedOnly: true },
    { key: 'historyEnd', label: 'History End', type: 'template-textarea', advancedOnly: true },
    { key: 'template', label: 'Template (Jinja2)', type: 'code', placeholder: '{{ states("light.living_room") }}', advancedOnly: true },
  ],
  llmDescription: 'Control Home Assistant smart home devices. Query state, call services, fire events, get history, or render Jinja2 templates.',
  llmExamples: [
    { operation: 'query_state', entityId: 'sensor.living_room_temperature' },
    { operation: 'call_service', entityId: 'light.kitchen', domain: 'light', service: 'turn_off' },
  ],
};
```

Add `homeAssistantDef` to the `builtInDefinitions` array.

- [ ] **Step 3: Verify build**

```bash
cd ~/strange_rambling_svelte && npx svelte-kit sync && npx vitest run tests/lib/workflows/ 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/index.ts src/lib/workflows/registry-client.ts
git commit -m "feat(ha): register HA node and auto-boot service on startup"
```

---

### Task 6: API Routes

**Files:**
- Create: `src/routes/api/workflows/homeassistant/config/+server.ts`
- Create: `src/routes/api/workflows/homeassistant/sync/+server.ts`
- Create: `src/routes/api/workflows/homeassistant/entities/+server.ts`
- Create: `src/routes/api/workflows/homeassistant/areas/+server.ts`
- Create: `src/routes/api/workflows/homeassistant/test/+server.ts`

- [ ] **Step 1: Create config endpoint**

Create `src/routes/api/workflows/homeassistant/config/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { initHomeAssistantService } from '$lib/workflows/homeassistant/service';

export const GET: RequestHandler = async () => {
  const [config] = await db
    .select()
    .from(homeAssistantConfig)
    .where(eq(homeAssistantConfig.id, 'default'))
    .limit(1);

  if (!config) {
    return json({ url: 'http://localhost:8123', hasToken: false, lastSynced: null, entityCount: 0, areaCount: 0 });
  }

  return json({
    url: config.url,
    hasToken: !!config.token,
    lastSynced: config.lastSynced,
    entityCount: Array.isArray(config.entityRegistry) ? (config.entityRegistry as any[]).length : 0,
    areaCount: Array.isArray(config.areaRegistry) ? (config.areaRegistry as any[]).length : 0,
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { url, token } = body;

  const values: Record<string, unknown> = { id: 'default', updatedAt: new Date() };
  if (typeof url === 'string') values.url = url;
  if (typeof token === 'string') values.token = token;

  await db
    .insert(homeAssistantConfig)
    .values(values as any)
    .onConflictDoUpdate({
      target: homeAssistantConfig.id,
      set: { ...values, id: undefined } as any,
    });

  // Re-init the service with new credentials
  if (url || token) {
    const [config] = await db.select().from(homeAssistantConfig).where(eq(homeAssistantConfig.id, 'default')).limit(1);
    if (config?.token) {
      initHomeAssistantService(config.url, config.token);
    }
  }

  return json({ success: true });
};
```

- [ ] **Step 2: Create sync endpoint**

Create `src/routes/api/workflows/homeassistant/sync/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';

export const POST: RequestHandler = async () => {
  const service = getHomeAssistantService();

  try {
    const { entities, entityCount } = await service.syncRegistries();

    // Extract unique areas from entities
    const areaMap = new Map<string, string>();
    for (const e of entities) {
      if (e.area_id && e.area_name) {
        areaMap.set(e.area_id, e.area_name);
      }
    }
    const areas = Array.from(areaMap.entries()).map(([id, name]) => ({ id, name }));

    await db.update(homeAssistantConfig).set({
      entityRegistry: entities,
      areaRegistry: areas,
      lastSynced: new Date(),
      updatedAt: new Date(),
    }).where(eq(homeAssistantConfig.id, 'default'));

    return json({ success: true, entityCount, areaCount: areas.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ success: false, error: message }, { status: 500 });
  }
};
```

- [ ] **Step 3: Create entities endpoint**

Create `src/routes/api/workflows/homeassistant/entities/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
  const domain = url.searchParams.get('domain');

  const [config] = await db
    .select()
    .from(homeAssistantConfig)
    .where(eq(homeAssistantConfig.id, 'default'))
    .limit(1);

  let entities = Array.isArray(config?.entityRegistry) ? (config.entityRegistry as any[]) : [];

  if (domain) {
    entities = entities.filter((e: any) => e.domain === domain);
  }

  return json({ entities });
};
```

- [ ] **Step 4: Create areas endpoint**

Create `src/routes/api/workflows/homeassistant/areas/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const [config] = await db
    .select()
    .from(homeAssistantConfig)
    .where(eq(homeAssistantConfig.id, 'default'))
    .limit(1);

  const areas = Array.isArray(config?.areaRegistry) ? config.areaRegistry : [];
  return json({ areas });
};
```

- [ ] **Step 5: Create test connection endpoint**

Create `src/routes/api/workflows/homeassistant/test/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';

export const POST: RequestHandler = async () => {
  const service = getHomeAssistantService();
  const result = await service.testConnection();

  if (result.success) {
    return json({ connected: true, message: 'Connected to Home Assistant' });
  }

  return json({ connected: false, error: result.error }, { status: 502 });
};
```

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/homeassistant/
git commit -m "feat(ha): add API routes for config, sync, entities, areas, and test"
```

---

### Task 7: Canvas Node Component and Config Panel

**Files:**
- Create: `src/lib/components/workflows/nodes/HomeAssistantNode.svelte`
- Create: `src/lib/components/workflows/HomeAssistantConfigPanel.svelte`
- Modify: `src/routes/workflows/[id]/+page.svelte`

- [ ] **Step 1: Create canvas node component**

Create `src/lib/components/workflows/nodes/HomeAssistantNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data, id } = $props();

  const operation: string = data.config?.operation ?? 'query_state';
  const entityId: string = data.config?.entityId ?? '';
  const opLabels: Record<string, string> = {
    query_state: 'Query',
    call_service: 'Service',
    fire_event: 'Event',
    get_history: 'History',
    render_template: 'Template',
  };
  const displayLabel: string = data.label
    ? `${data.label}${entityId ? ` · ${entityId.split('.').pop()}` : ''}`
    : `HA ${opLabels[operation] || operation}`;
</script>

<BaseNode
  id={id}
  description={data.config?.description || ""}
  label={displayLabel}
  nodeType="home-assistant"
  status={data.status}
  error={data.error}
  icon="🏠"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
```

- [ ] **Step 2: Create config panel component**

Create `src/lib/components/workflows/HomeAssistantConfigPanel.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import BasicConfigRenderer from './BasicConfigRenderer.svelte';
  import type { BasicConfigField } from '$lib/workflows/types';

  let {
    fields,
    config,
    variables = [],
    showAdvanced = false,
    onConfigChange,
  }: {
    fields: BasicConfigField[];
    config: Record<string, unknown>;
    variables: { path: string; type: string; description?: string }[];
    showAdvanced: boolean;
    onConfigChange: (config: Record<string, unknown>) => void;
  } = $props();

  type Tab = 'connection' | 'entities' | 'operation';
  let activeTab: Tab = $state('operation');

  // Connection state
  let haUrl: string = $state('http://localhost:8123');
  let haToken: string = $state('');
  let hasToken: boolean = $state(false);
  let lastSynced: string | null = $state(null);
  let entityCount: number = $state(0);
  let connectionTested: boolean | null = $state(null);
  let testError: string = $state('');
  let syncing = $state(false);
  let saving = $state(false);

  // Entity browser state
  let entities: any[] = $state([]);
  let searchQuery: string = $state('');
  let domainFilter: string = $state('');
  let entitiesLoaded = $state(false);

  const domainIcons: Record<string, string> = {
    light: '💡', switch: '🔌', sensor: '🌡️', binary_sensor: '🔘', climate: '🌡️',
    media_player: '📺', camera: '📷', cover: '🪟', fan: '🌀', lock: '🔒',
    device_tracker: '📍', person: '👤', automation: '⚙️', scene: '🎭', script: '📜',
    sun: '☀️',
  };

  let filteredEntities = $derived(() => {
    let result = entities;
    if (domainFilter) result = result.filter((e: any) => e.domain === domainFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e: any) =>
        e.friendly_name?.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q),
      );
    }
    return result;
  });

  let domains = $derived(() => {
    const d = new Set(entities.map((e: any) => e.domain));
    return Array.from(d).sort();
  });

  let groupedByArea = $derived(() => {
    const groups = new Map<string, any[]>();
    for (const e of filteredEntities()) {
      const area = e.area_name || 'Ungrouped';
      const list = groups.get(area) || [];
      list.push(e);
      groups.set(area, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Ungrouped') return 1;
      if (b === 'Ungrouped') return -1;
      return a.localeCompare(b);
    });
  });

  async function loadConfig() {
    try {
      const res = await fetch('/api/workflows/homeassistant/config');
      if (!res.ok) return;
      const data = await res.json();
      haUrl = data.url || 'http://localhost:8123';
      hasToken = data.hasToken;
      lastSynced = data.lastSynced;
      entityCount = data.entityCount;
    } catch {}
  }

  async function saveConfig() {
    saving = true;
    try {
      const body: Record<string, string> = { url: haUrl };
      if (haToken) body.token = haToken;
      await fetch('/api/workflows/homeassistant/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      hasToken = true;
      haToken = '';
      connectionTested = null;
    } finally {
      saving = false;
    }
  }

  async function testConnection() {
    connectionTested = null;
    testError = '';
    try {
      const res = await fetch('/api/workflows/homeassistant/test', { method: 'POST' });
      const data = await res.json();
      connectionTested = data.connected;
      if (!data.connected) testError = data.error || 'Connection failed';
    } catch {
      connectionTested = false;
      testError = 'Request failed';
    }
  }

  async function syncEntities() {
    syncing = true;
    try {
      const res = await fetch('/api/workflows/homeassistant/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        entityCount = data.entityCount;
        lastSynced = new Date().toISOString();
        await loadEntities();
      }
    } finally {
      syncing = false;
    }
  }

  async function loadEntities() {
    try {
      const res = await fetch('/api/workflows/homeassistant/entities');
      if (!res.ok) return;
      const data = await res.json();
      entities = data.entities || [];
      entitiesLoaded = true;
    } catch {}
  }

  function selectEntity(entityId: string) {
    const domain = entityId.split('.')[0];
    onConfigChange({ ...config, entityId, domain });
    activeTab = 'operation';
  }

  onMount(() => {
    loadConfig();
  });

  $effect(() => {
    if (activeTab === 'entities' && !entitiesLoaded) {
      loadEntities();
    }
  });
</script>

<!-- Tabs -->
<div class="flex border-b -mx-5 -mt-1 mb-4" style="border-color: var(--card-border);">
  <button
    onclick={() => { activeTab = 'connection'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'connection' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'connection' ? 'var(--accent)' : 'transparent'};"
  >Connection</button>
  <button
    onclick={() => { activeTab = 'entities'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'entities' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'entities' ? 'var(--accent)' : 'transparent'};"
  >Entities ({entityCount})</button>
  <button
    onclick={() => { activeTab = 'operation'; }}
    class="px-4 py-2.5 text-xs font-medium transition-colors"
    style="color: {activeTab === 'operation' ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === 'operation' ? 'var(--accent)' : 'transparent'};"
  >Operation</button>
</div>

<!-- Connection Tab -->
{#if activeTab === 'connection'}
  <div class="space-y-3">
    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">HA URL</label>
      <input type="text" bind:value={haUrl} class="w-full px-2 py-1.5 rounded text-xs border" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);" />
    </div>

    <div>
      <label class="text-[11px] uppercase tracking-wider mb-1 block" style="color: var(--text-ghost); font-family: var(--font-mono);">
        Access Token {#if hasToken}<span style="color: #22c55e;">(configured)</span>{/if}
      </label>
      <input type="password" bind:value={haToken} placeholder={hasToken ? '••••••••' : 'Long-lived access token'} class="w-full px-2 py-1.5 rounded text-xs border" style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);" />
    </div>

    <div class="flex gap-2">
      <button onclick={saveConfig} disabled={saving} class="flex-1 px-3 py-2 rounded text-xs font-medium" style="background: var(--accent); color: white; opacity: {saving ? 0.7 : 1};">
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button onclick={testConnection} class="flex-1 px-3 py-2 rounded text-xs border" style="border-color: var(--card-border); color: var(--text-primary);">
        Test Connection
      </button>
    </div>

    {#if connectionTested !== null}
      <div class="flex items-center gap-2 px-3 py-2 rounded text-xs" style="background: var(--card-bg); color: {connectionTested ? '#22c55e' : '#ef4444'};">
        {connectionTested ? '✓ Connected' : `✗ ${testError}`}
      </div>
    {/if}

    <div class="flex items-center justify-between px-3 py-2 rounded text-xs" style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-ghost);">
      <span>{entityCount} entities</span>
      <span>{lastSynced ? `Synced ${new Date(lastSynced).toLocaleTimeString()}` : 'Not synced'}</span>
    </div>

    <button onclick={syncEntities} disabled={syncing} class="w-full px-3 py-2 rounded text-xs border" style="border-color: var(--card-border); color: var(--text-primary); opacity: {syncing ? 0.7 : 1};">
      {syncing ? 'Syncing...' : 'Refresh Entities'}
    </button>
  </div>

<!-- Entity Browser Tab -->
{:else if activeTab === 'entities'}
  <div class="space-y-3">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder="Search entities..."
      class="w-full px-2 py-1.5 rounded text-xs border"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
    />

    <div class="flex flex-wrap gap-1">
      <button
        onclick={() => { domainFilter = ''; }}
        class="px-2 py-0.5 rounded text-[10px]"
        style="background: {domainFilter === '' ? 'var(--accent)' : 'var(--card-bg)'}; color: {domainFilter === '' ? 'white' : 'var(--text-ghost)'}; border: 1px solid var(--card-border);"
      >All</button>
      {#each domains() as domain}
        <button
          onclick={() => { domainFilter = domain; }}
          class="px-2 py-0.5 rounded text-[10px]"
          style="background: {domainFilter === domain ? 'var(--accent)' : 'var(--card-bg)'}; color: {domainFilter === domain ? 'white' : 'var(--text-ghost)'}; border: 1px solid var(--card-border);"
        >{domainIcons[domain] || '•'} {domain}</button>
      {/each}
    </div>

    <div class="max-h-64 overflow-y-auto space-y-2">
      {#each groupedByArea() as [area, areaEntities]}
        <div>
          <div class="text-[10px] uppercase tracking-wider px-1 py-0.5 mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">{area}</div>
          {#each areaEntities as entity}
            <button
              onclick={() => selectEntity(entity.entity_id)}
              class="w-full text-left px-2 py-1.5 rounded text-xs mb-0.5 border transition-colors hover:border-[var(--accent)]"
              style="background: var(--card-bg); border-color: {config.entityId === entity.entity_id ? 'var(--accent)' : 'var(--card-border)'}; color: var(--text-primary);"
            >
              <span>{domainIcons[entity.domain] || '•'} {entity.friendly_name}</span>
              <span class="float-right" style="color: var(--text-ghost); font-family: var(--font-mono); font-size: 10px;">{entity.state}</span>
              <div class="text-[10px] mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">{entity.entity_id}</div>
            </button>
          {/each}
        </div>
      {/each}

      {#if filteredEntities().length === 0}
        <p class="text-xs text-center py-4" style="color: var(--text-ghost);">
          {entitiesLoaded ? 'No entities match filter' : 'Loading entities...'}
        </p>
      {/if}
    </div>
  </div>

<!-- Operation Tab -->
{:else if activeTab === 'operation'}
  <BasicConfigRenderer
    {fields}
    {config}
    {variables}
    {showAdvanced}
    {onConfigChange}
  />
{/if}
```

- [ ] **Step 3: Register in page component**

In `src/routes/workflows/[id]/+page.svelte`:

Add lazy import variable alongside the existing ones:

```typescript
let HomeAssistantConfigPanelComponent: any = $state(null);
```

Add dynamic import alongside the existing ones:

```typescript
import('$lib/components/workflows/HomeAssistantConfigPanel.svelte').then(m => HomeAssistantConfigPanelComponent = m.default);
```

Add the node component import in the `Promise.all` block:

```typescript
import('$lib/components/workflows/nodes/HomeAssistantNode.svelte'),
```

Add to the destructuring and `nodeTypeComponents` map:

```typescript
// In destructuring: add `ha` at the end
// In nodeTypeComponents: add 'home-assistant': ha.default,
```

Add config panel check in the modal (before the WhatsApp check):

```svelte
{#if modalNode.data.nodeType === 'home-assistant' && HomeAssistantConfigPanelComponent}
  <svelte:component
    this={HomeAssistantConfigPanelComponent}
    fields={modalNodeDef?.basicConfig || []}
    config={modalNode.data.config || {}}
    variables={modalUpstreamVariables}
    showAdvanced={false}
    onConfigChange={(newConfig) => {
      nodes = nodes.map(n =>
        n.id === modalNodeId ? { ...n, data: { ...n.data, config: newConfig } } : n
      );
      editingConfig = {};
      for (const [k, v] of Object.entries(newConfig)) {
        editingConfig[k] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
      }
    }}
  />
{:else if modalNode.data.nodeType === 'whatsapp' && WhatsAppConfigPanelComponent}
```

Also add the same connection gate bypass as WhatsApp:

```typescript
if (node.data.nodeType === 'home-assistant') return true;
```

alongside the existing `if (node.data.nodeType === 'whatsapp') return true;` line.

- [ ] **Step 4: Verify build**

```bash
cd ~/strange_rambling_svelte && npx svelte-kit sync
```

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/workflows/nodes/HomeAssistantNode.svelte src/lib/components/workflows/HomeAssistantConfigPanel.svelte src/routes/workflows/[id]/+page.svelte
git commit -m "feat(ha): add HA canvas node, config panel with entity browser, and page integration"
```

---

### Task 8: Seed Config and Push Schema to VPS

**Files:**
- No new files

- [ ] **Step 1: Push schema to local database**

```bash
cd ~/strange_rambling_svelte && npx drizzle-kit push
```

- [ ] **Step 2: Seed local config with existing HA token**

```bash
cd ~/strange_rambling_svelte && node -e "
import pg from 'pg';
const client = new pg.Client('postgresql://app:test@localhost:5433/strange_rambling');
await client.connect();
await client.query(\`
  INSERT INTO home_assistant_config (id, url, token)
  VALUES ('default', 'http://localhost:8123', 'd68668e068dc4d393ba81e53b8a86a33f3b917a7a6c62d89c6be23d4b0726cbd3b7057f1abfae8266237d85fe354efa0e76350b0d1014a98e6fa1e77dff657d2')
  ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token, updated_at = NOW()
\`);
console.log('Local HA config seeded');
await client.end();
"
```

- [ ] **Step 3: Create table on VPS**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling -c \"
CREATE TABLE IF NOT EXISTS home_assistant_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  url TEXT NOT NULL DEFAULT 'http://localhost:8123',
  token TEXT NOT NULL DEFAULT '',
  entity_registry JSONB NOT NULL DEFAULT '[]'::jsonb,
  device_registry JSONB NOT NULL DEFAULT '[]'::jsonb,
  area_registry JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_synced TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
\""
```

- [ ] **Step 4: Seed VPS config with HA token**

Note: HA runs on homeserv (localhost:8123), not the VPS. The VPS needs to reach homeserv's HA instance. Since both are on Tailscale, use the Tailscale hostname:

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling -c \"
INSERT INTO home_assistant_config (id, url, token)
VALUES ('default', 'http://homeserv.tail668b8c.ts.net:8123', 'd68668e068dc4d393ba81e53b8a86a33f3b917a7a6c62d89c6be23d4b0726cbd3b7057f1abfae8266237d85fe354efa0e76350b0d1014a98e6fa1e77dff657d2')
ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, token = EXCLUDED.token, updated_at = NOW();
\""
```

- [ ] **Step 5: Verify**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "docker exec -i strange-rambling-app-db-1 psql -U app -d strange_rambling -c \"SELECT id, url, length(token) as token_length FROM home_assistant_config;\""
```

Expected: One row with VPS HA URL and token configured.

---

### Task 9: Deploy and Integration Test

- [ ] **Step 1: Run all tests**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/
```

Expected: All tests pass.

- [ ] **Step 2: Push and deploy**

```bash
cd ~/strange_rambling_svelte && git push origin master && bash scripts/deploy.sh
```

- [ ] **Step 3: Verify HA service boots**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "sleep 3 && sudo journalctl -u strange-rambling-svelte --no-pager -n 10 | grep ha"
```

Expected: `[ha] Synced N entities` and `[ha] Service booted`.

- [ ] **Step 4: Test WhatsApp HA control**

Send a WhatsApp message: "What's the living room temperature?"

Expected: The LLM calls `ha_query_state` on a temperature sensor and responds conversationally.

- [ ] **Step 5: Test HA workflow node in UI**

Open a workflow, add a Home Assistant node, open its config:
- Connection tab: should show "configured" token, entity count
- Entity Browser tab: should show entities grouped by area with domain filter pills
- Click an entity → auto-fills entityId in Operation tab
- Operation tab: standard config fields with Save button
