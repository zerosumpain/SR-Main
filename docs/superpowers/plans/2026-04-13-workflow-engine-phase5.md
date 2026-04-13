# Workflow Engine Phase 5: First-Class Integrations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three first-class integration node types (Strava, Whoop, OpenRouter), update the orchestrator planner prompt to cover all 14 node types, and add an `integration-generate` API endpoint for dynamic integration registration.

**Architecture:** Each integration node follows the exact pattern of `src/lib/workflows/nodes/http-request.ts` — a named `*Executor` and `*Def` export. Server-side executors call the existing `src/lib/health/` functions and `src/lib/deepdive/keys.ts` OpenRouter client. Client-side definitions (no executor import) go in `registry-client.ts`. Svelte components extend `BaseNode.svelte`.

**Dependencies:** Phase 4 completed (all 10 existing nodes registered). Existing `src/lib/health/tokens.ts` `getValidToken()` handles OAuth refresh automatically.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), existing `src/lib/health/strava.ts`, `src/lib/health/whoop.ts`, `src/lib/health/tokens.ts`, OpenAI SDK via `src/lib/deepdive/keys.ts`.

**Design spec:** `docs/superpowers/specs/2026-04-12-workflow-engine-design.md` — Section "Integrations (pre-built, first-class)" and "Integration Generation".

**Parallelisation note:** Tasks 1, 2, and 3 (Strava, Whoop, OpenRouter nodes) are fully independent of each other. Task 4 (update prompts) and Task 5 (integration-generate endpoint) depend on the nodes existing.

---

## Task 1: Strava Node

**Files:**
- Create: `src/lib/workflows/nodes/strava.ts`
- Create: `tests/lib/workflows/nodes/strava.test.ts`
- Create: `src/lib/components/workflows/nodes/StravaNode.svelte`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

### Step 1.1: Write failing tests

Create `tests/lib/workflows/nodes/strava.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/health/tokens', () => ({
  getValidToken: vi.fn().mockResolvedValue('mock-strava-token'),
}));

vi.mock('$lib/health/strava', () => ({
  getStravaActivities: vi.fn().mockResolvedValue([
    { id: 1, name: 'Morning Run', type: 'Run', distance: 5000, moving_time: 1800, start_date: '2026-04-12T07:00:00Z' },
  ]),
}));

import { stravaExecutor } from '$lib/workflows/nodes/strava';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext = {} as ExecutionContext;

describe('stravaExecutor', () => {
  describe('list_activities', () => {
    it('returns activities array', async () => {
      const result = await stravaExecutor.execute({}, { operation: 'list_activities' }, mockContext);
      expect(result.output.activities).toHaveLength(1);
      expect(result.output.activities[0].name).toBe('Morning Run');
    });

    it('passes page and perPage config', async () => {
      const { getStravaActivities } = await import('$lib/health/strava');
      await stravaExecutor.execute({}, { operation: 'list_activities', page: 2, perPage: 10 }, mockContext);
      expect(getStravaActivities).toHaveBeenCalledWith('mock-strava-token', 2, 10);
    });
  });

  describe('no token', () => {
    beforeEach(() => {
      const { getValidToken } = require('$lib/health/tokens');
      getValidToken.mockResolvedValue(null);
    });

    it('throws when token not available', async () => {
      await expect(
        stravaExecutor.execute({}, { operation: 'list_activities' }, mockContext)
      ).rejects.toThrow('Strava token not available');
    });
  });
});
```

- [ ] **Step 1.2: Create executor and definition**

Create `src/lib/workflows/nodes/strava.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { getValidToken } from '$lib/health/tokens';
import { getStravaActivities } from '$lib/health/strava';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export const stravaExecutor: NodeExecutor = {
  type: 'strava',

  async execute(
    _input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'list_activities';
    const token = await getValidToken('strava');
    if (!token) throw new Error('Strava token not available. Connect Strava in Health settings.');

    switch (operation) {
      case 'list_activities': {
        const page = (config.page as number) ?? 1;
        const perPage = (config.perPage as number) ?? 30;
        const activities = await getStravaActivities(token, page, perPage);
        return { output: { activities, count: activities.length } };
      }

      case 'get_activity': {
        const activityId = config.activityId as string;
        if (!activityId) throw new Error('activityId is required for get_activity');
        const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Strava API error: ${res.status}`);
        const activity = await res.json();
        return { output: { activity } };
      }

      case 'get_athlete_stats': {
        const athleteRes = await fetch(`${STRAVA_API_BASE}/athlete`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!athleteRes.ok) throw new Error(`Strava API error: ${athleteRes.status}`);
        const athlete = await athleteRes.json();
        const statsRes = await fetch(`${STRAVA_API_BASE}/athletes/${athlete.id}/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!statsRes.ok) throw new Error(`Strava API error: ${statsRes.status}`);
        const stats = await statsRes.json();
        return { output: { athlete, stats } };
      }

      default:
        throw new Error(`Unknown Strava operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Optional overrides for operation parameters' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const operation = (config.operation as string) || 'list_activities';
    if (operation === 'list_activities') {
      return {
        type: 'object',
        properties: {
          activities: { type: 'array', description: 'Array of Strava activity objects' },
          count: { type: 'number', description: 'Number of activities returned' },
        },
      };
    }
    if (operation === 'get_activity') {
      return { type: 'object', properties: { activity: { type: 'object', description: 'Full activity detail' } } };
    }
    return { type: 'object', properties: { athlete: { type: 'object' }, stats: { type: 'object' } } };
  },
};

export const stravaDef: NodeDefinition = {
  type: 'strava',
  label: 'Strava',
  category: 'integration',
  description: 'Access Strava activity data. Requires Strava connected in Health settings.',
  configSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        description: 'list_activities | get_activity | get_athlete_stats',
      },
      page: { type: 'number', description: 'Page number for list_activities (default 1)' },
      perPage: { type: 'number', description: 'Results per page for list_activities (default 30, max 200)' },
      activityId: { type: 'string', description: 'Activity ID for get_activity' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list_activities', page: 1, perPage: 30 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
};
```

- [ ] **Step 1.3: Create Svelte component**

Create `src/lib/components/workflows/nodes/StravaNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();
  const operation = data.config?.operation || 'list_activities';

  const OPERATION_LABELS: Record<string, string> = {
    list_activities: 'List Activities',
    get_activity: 'Get Activity',
    get_athlete_stats: 'Athlete Stats',
  };
</script>

<BaseNode
  label={data.label}
  nodeType="strava"
  status={data.status}
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
  icon="🚴"
>
  {#snippet extra()}
    <div class="px-3 pb-2">
      <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: #fc4c0222; color: #fc4c02; font-family: var(--font-mono);">
        {OPERATION_LABELS[operation] ?? operation}
      </span>
    </div>
  {/snippet}
</BaseNode>
```

- [ ] **Step 1.4: Register in index.ts and registry-client.ts**

In `src/lib/workflows/index.ts`, add:
```typescript
import { stravaDef, stravaExecutor } from './nodes/strava';
// ...
registry.register(stravaDef, stravaExecutor);
```

In `src/lib/workflows/registry-client.ts`, add a client-only `stravaDef` constant (same shape as the server def, no executor import) and include it in `nodeDefinitions`.

- [ ] **Step 1.5: Run tests**

```bash
npm test -- tests/lib/workflows/nodes/strava.test.ts
```

---

## Task 2: Whoop Node

**Files:**
- Create: `src/lib/workflows/nodes/whoop.ts`
- Create: `tests/lib/workflows/nodes/whoop.test.ts`
- Create: `src/lib/components/workflows/nodes/WhoopNode.svelte`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

- [ ] **Step 2.1: Write failing tests**

Create `tests/lib/workflows/nodes/whoop.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/health/tokens', () => ({
  getValidToken: vi.fn().mockResolvedValue('mock-whoop-token'),
}));

vi.mock('$lib/health/whoop', () => ({
  getWhoopCycles: vi.fn().mockResolvedValue([{ id: 1, score: { strain: 12.5 } }]),
  getWhoopRecoveries: vi.fn().mockResolvedValue([{ cycle_id: 1, score: { recovery_score: 78 } }]),
  getWhoopSleeps: vi.fn().mockResolvedValue([{ id: 1, score: { sleep_performance_percentage: 85 } }]),
  getWhoopWorkouts: vi.fn().mockResolvedValue([{ id: 1, score: { strain: 8.2 } }]),
}));

import { whoopExecutor } from '$lib/workflows/nodes/whoop';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext = {} as ExecutionContext;

describe('whoopExecutor', () => {
  it('get_cycles returns cycles array', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_cycles' }, mockContext);
    expect(result.output.cycles).toHaveLength(1);
  });

  it('get_recovery returns recoveries', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_recovery' }, mockContext);
    expect(result.output.recoveries[0].score.recovery_score).toBe(78);
  });

  it('get_sleep returns sleeps', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_sleep' }, mockContext);
    expect(result.output.sleeps).toHaveLength(1);
  });

  it('get_workouts returns workouts', async () => {
    const result = await whoopExecutor.execute({}, { operation: 'get_workouts' }, mockContext);
    expect(result.output.workouts).toHaveLength(1);
  });

  it('throws on missing token', async () => {
    const { getValidToken } = await import('$lib/health/tokens');
    vi.mocked(getValidToken).mockResolvedValueOnce(null);
    await expect(
      whoopExecutor.execute({}, { operation: 'get_cycles' }, mockContext)
    ).rejects.toThrow('Whoop token not available');
  });
});
```

- [ ] **Step 2.2: Create executor and definition**

Create `src/lib/workflows/nodes/whoop.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { getValidToken } from '$lib/health/tokens';
import { getWhoopCycles, getWhoopRecoveries, getWhoopSleeps, getWhoopWorkouts } from '$lib/health/whoop';

export const whoopExecutor: NodeExecutor = {
  type: 'whoop',

  async execute(
    _input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'get_cycles';
    const token = await getValidToken('whoop');
    if (!token) throw new Error('Whoop token not available. Connect Whoop in Health settings.');

    const limit = (config.limit as number) ?? 10;
    const start = config.start as string | undefined;
    const end = config.end as string | undefined;
    const opts = { limit, ...(start ? { start } : {}), ...(end ? { end } : {}) };

    switch (operation) {
      case 'get_cycles': {
        const cycles = await getWhoopCycles(token, opts);
        return { output: { cycles, count: cycles.length } };
      }
      case 'get_recovery': {
        const recoveries = await getWhoopRecoveries(token, opts);
        return { output: { recoveries, count: recoveries.length } };
      }
      case 'get_sleep': {
        const sleeps = await getWhoopSleeps(token, opts);
        return { output: { sleeps, count: sleeps.length } };
      }
      case 'get_workouts': {
        const workouts = await getWhoopWorkouts(token, opts);
        return { output: { workouts, count: workouts.length } };
      }
      default:
        throw new Error(`Unknown Whoop operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Optional overrides (limit, start, end)' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const op = (config.operation as string) || 'get_cycles';
    const arrayKey = ({ get_cycles: 'cycles', get_recovery: 'recoveries', get_sleep: 'sleeps', get_workouts: 'workouts' } as Record<string, string>)[op] ?? 'records';
    return {
      type: 'object',
      properties: {
        [arrayKey]: { type: 'array', description: `Array of Whoop ${op.replace('get_', '')} records` },
        count: { type: 'number' },
      },
    };
  },
};

export const whoopDef: NodeDefinition = {
  type: 'whoop',
  label: 'Whoop',
  category: 'integration',
  description: 'Access Whoop health data. Requires Whoop connected in Health settings.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'get_cycles | get_recovery | get_sleep | get_workouts' },
      limit: { type: 'number', description: 'Max records to return (default 10)' },
      start: { type: 'string', description: 'ISO 8601 start date filter (optional)' },
      end: { type: 'string', description: 'ISO 8601 end date filter (optional)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'get_cycles', limit: 10 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
};
```

- [ ] **Step 2.3: Create Svelte component**

Create `src/lib/components/workflows/nodes/WhoopNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();
  const operation = data.config?.operation || 'get_cycles';

  const OPERATION_LABELS: Record<string, string> = {
    get_cycles: 'Cycles',
    get_recovery: 'Recovery',
    get_sleep: 'Sleep',
    get_workouts: 'Workouts',
  };
</script>

<BaseNode
  label={data.label}
  nodeType="whoop"
  status={data.status}
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
  icon="💚"
>
  {#snippet extra()}
    <div class="px-3 pb-2">
      <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: #00ff9022; color: #00cc77; font-family: var(--font-mono);">
        {OPERATION_LABELS[operation] ?? operation}
      </span>
    </div>
  {/snippet}
</BaseNode>
```

- [ ] **Step 2.4: Register in index.ts and registry-client.ts**

Same pattern as Strava: add import + `registry.register(whoopDef, whoopExecutor)` in `index.ts`, and client-only def in `registry-client.ts`.

- [ ] **Step 2.5: Run tests**

```bash
npm test -- tests/lib/workflows/nodes/whoop.test.ts
```

---

## Task 3: OpenRouter Node

**Files:**
- Create: `src/lib/workflows/nodes/openrouter.ts`
- Create: `tests/lib/workflows/nodes/openrouter.test.ts`
- Create: `src/lib/components/workflows/nodes/OpenRouterNode.svelte`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

- [ ] **Step 3.1: Write failing tests**

Create `tests/lib/workflows/nodes/openrouter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

const mockCreate = vi.fn().mockResolvedValue({
  id: 'gen-123',
  choices: [{ message: { content: 'Hello world' } }],
  usage: { prompt_tokens: 10, completion_tokens: 20 },
  model: 'openai/gpt-4o-mini',
});

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: vi.fn().mockReturnValue({
    chat: { completions: { create: mockCreate } },
  }),
  loadKeys: vi.fn().mockReturnValue({ openrouterApiKey: 'test-key' }),
}));

// Mock fetch for list_models and get_usage
global.fetch = vi.fn();

import { openrouterExecutor } from '$lib/workflows/nodes/openrouter';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext = {} as ExecutionContext;

describe('openrouterExecutor', () => {
  it('chat_completion returns response text', async () => {
    const result = await openrouterExecutor.execute(
      { topic: 'cats' },
      { operation: 'chat_completion', model: 'openai/gpt-4o-mini', userPrompt: 'Tell me about {{input.topic}}' },
      mockContext
    );
    expect(result.output.response).toBe('Hello world');
    expect(result.output.usage.promptTokens).toBe(10);
  });

  it('list_models fetches from OpenRouter API', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'openai/gpt-4o', name: 'GPT-4o' }] }),
    } as Response);
    const result = await openrouterExecutor.execute({}, { operation: 'list_models' }, mockContext);
    expect(result.output.models).toHaveLength(1);
  });
});
```

- [ ] **Step 3.2: Create executor and definition**

Create `src/lib/workflows/nodes/openrouter.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { getOpenRouterClient, loadKeys } from '$lib/deepdive/keys';
import { interpolateTemplate } from './template';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

export const openrouterExecutor: NodeExecutor = {
  type: 'openrouter',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'chat_completion';

    switch (operation) {
      case 'chat_completion': {
        const model = (config.model as string) || 'openai/gpt-4o-mini';
        const systemPrompt = interpolateTemplate((config.systemPrompt as string) || '', input);
        const userPrompt = interpolateTemplate((config.userPrompt as string) || '', input);
        const temperature = (config.temperature as number) ?? 0.7;
        const maxTokens = (config.maxTokens as number) ?? 1024;

        const client = getOpenRouterClient();
        const response = await client.chat.completions.create({
          model,
          messages: [
            ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
            { role: 'user' as const, content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
        });
        const content = response.choices[0]?.message?.content ?? '';
        const usage = response.usage;
        return {
          output: {
            response: content,
            model: response.model,
            usage: { promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0 },
          },
          metadata: { model, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: usage?.completion_tokens ?? 0 },
        };
      }

      case 'list_models': {
        const keys = loadKeys();
        if (!keys.openrouterApiKey) throw new Error('OpenRouter API key not configured');
        const res = await fetch(`${OPENROUTER_BASE}/models`, {
          headers: { Authorization: `Bearer ${keys.openrouterApiKey}` },
        });
        if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
        const data = await res.json();
        return { output: { models: data.data ?? [], count: (data.data ?? []).length } };
      }

      case 'get_usage': {
        const keys = loadKeys();
        if (!keys.openrouterApiKey) throw new Error('OpenRouter API key not configured');
        const res = await fetch(`${OPENROUTER_BASE}/auth/key`, {
          headers: { Authorization: `Bearer ${keys.openrouterApiKey}` },
        });
        if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
        const data = await res.json();
        return { output: { usage: data.data ?? data } };
      }

      default:
        throw new Error(`Unknown OpenRouter operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation in prompts' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const op = (config.operation as string) || 'chat_completion';
    if (op === 'chat_completion') {
      return {
        type: 'object',
        properties: {
          response: { type: 'string' },
          model: { type: 'string' },
          usage: { type: 'object', properties: { promptTokens: { type: 'number' }, completionTokens: { type: 'number' } } },
        },
      };
    }
    if (op === 'list_models') {
      return { type: 'object', properties: { models: { type: 'array' }, count: { type: 'number' } } };
    }
    return { type: 'object', properties: { usage: { type: 'object' } } };
  },
};

export const openrouterDef: NodeDefinition = {
  type: 'openrouter',
  label: 'OpenRouter',
  category: 'integration',
  description: 'OpenRouter integration: chat completion with model picker, list models, or get usage stats.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'chat_completion | list_models | get_usage' },
      model: { type: 'string', description: 'Model ID for chat_completion (e.g. openai/gpt-4o-mini)' },
      systemPrompt: { type: 'string', description: 'System prompt. Supports {{input.field}} templates.' },
      userPrompt: { type: 'string', description: 'User prompt. Supports {{input.field}} templates.' },
      temperature: { type: 'number', description: 'Temperature 0–2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens (default 1024)' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'chat_completion', model: 'openai/gpt-4o-mini', systemPrompt: '', userPrompt: '', temperature: 0.7, maxTokens: 1024 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
};
```

- [ ] **Step 3.3: Create Svelte component**

Create `src/lib/components/workflows/nodes/OpenRouterNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();
  const operation = data.config?.operation || 'chat_completion';
  const model = data.config?.model || '';

  const OPERATION_LABELS: Record<string, string> = {
    chat_completion: 'Chat',
    list_models: 'List Models',
    get_usage: 'Usage Stats',
  };
</script>

<BaseNode
  label={data.label}
  nodeType="openrouter"
  status={data.status}
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
  icon="🔀"
>
  {#snippet extra()}
    <div class="px-3 pb-2 flex flex-col gap-1">
      <span class="text-[10px] px-1.5 py-0.5 rounded self-start" style="background: #7c3aed22; color: #7c3aed; font-family: var(--font-mono);">
        {OPERATION_LABELS[operation] ?? operation}
      </span>
      {#if model && operation === 'chat_completion'}
        <span class="text-[10px] truncate max-w-[140px]" style="color: var(--text-ghost); font-family: var(--font-mono);">{model}</span>
      {/if}
    </div>
  {/snippet}
</BaseNode>
```

- [ ] **Step 3.4: Register in index.ts and registry-client.ts**

Same pattern as Tasks 1 and 2.

- [ ] **Step 3.5: Run tests**

```bash
npm test -- tests/lib/workflows/nodes/openrouter.test.ts
```

---

## Task 4: Update Orchestrator Planner Prompt

**Files:**
- Modify: `src/lib/workflows/orchestrator/prompts.ts`

The `buildPlannerPrompt` function must include a configuration reference for all 14 node types (11 existing core/control + 3 new integrations) so the planner can use them.

- [ ] **Step 4.1: Extend the Node Configuration Reference section**

In `buildPlannerPrompt`, extend the `## Node Configuration Reference` section to add:

```
- **delay**: `{ "duration": 1000 }` — Waits the given number of milliseconds before passing through.
- **data-store**: `{ "operation": "get"|"set", "key": "...", "valuePath": "..." }` — Read/write workflow-scoped persistent key-value store.
- **email**: `{ "to": "...", "subject": "...", "body": "..." }` — Send email via SMTP. Supports {{input.field}} templates.
- **error-handler**: `{ "maxRetries": 2, "retryDelayMs": 1000 }` — Wraps a subgraph; routes failures to `error` output handle.
- **strava**: `{ "operation": "list_activities"|"get_activity"|"get_athlete_stats", "page": 1, "perPage": 30, "activityId": "..." }` — Fetches Strava data using connected OAuth token.
- **whoop**: `{ "operation": "get_cycles"|"get_recovery"|"get_sleep"|"get_workouts", "limit": 10, "start": "ISO8601", "end": "ISO8601" }` — Fetches Whoop health data.
- **openrouter**: `{ "operation": "chat_completion"|"list_models"|"get_usage", "model": "openai/gpt-4o-mini", "systemPrompt": "...", "userPrompt": "...", "temperature": 0.7 }` — OpenRouter integration node with model picker. Different from llm-call (this is the integration node).
```

Also update the `buildModifyPrompt` function's node type list to include all 14 types.

---

## Task 5: Dynamic Integration Generation API Endpoint

**Files:**
- Create: `src/routes/api/workflows/integrations/generate/+server.ts`

This endpoint lets the orchestrator register a new integration from an API description. It validates the description, makes a test call, stores in `integrations` table, and returns the new node type.

- [ ] **Step 5.1: Create the endpoint**

Create `src/routes/api/workflows/integrations/generate/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { integrations } from '$lib/db/schema';

interface OperationSpec {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  params?: Record<string, { type: string; description: string; required?: boolean }>;
}

interface GenerateRequest {
  name: string;
  description: string;
  baseUrl: string;
  authType: 'none' | 'apiKey' | 'bearer';
  authConfig?: { headerName?: string; token?: string };
  operations: OperationSpec[];
  testOperation?: string;  // name of operation to test
}

export const POST: RequestHandler = async ({ request }) => {
  const body: GenerateRequest = await request.json();

  if (!body.name || !body.baseUrl || !body.operations?.length) {
    return json({ error: 'name, baseUrl, and operations are required' }, { status: 400 });
  }

  // Validate base URL
  try {
    new URL(body.baseUrl);
  } catch {
    return json({ error: 'Invalid baseUrl' }, { status: 400 });
  }

  // Test call: use first operation or the specified testOperation
  const testOp = body.testOperation
    ? body.operations.find((o) => o.name === body.testOperation)
    : body.operations[0];

  if (testOp) {
    try {
      const testUrl = `${body.baseUrl.replace(/\/$/, '')}${testOp.path}`;
      const headers: Record<string, string> = {};

      if (body.authType === 'bearer' && body.authConfig?.token) {
        headers['Authorization'] = `Bearer ${body.authConfig.token}`;
      } else if (body.authType === 'apiKey' && body.authConfig?.token) {
        headers[body.authConfig.headerName ?? 'X-API-Key'] = body.authConfig.token;
      }

      const testRes = await fetch(testUrl, { method: testOp.method, headers });
      if (!testRes.ok && testRes.status >= 500) {
        return json({ error: `Test call to ${testUrl} failed with status ${testRes.status}` }, { status: 422 });
      }
      // 4xx is acceptable — auth may not be set up yet but server responded
    } catch (err) {
      return json({ error: `Test call failed: ${err instanceof Error ? err.message : String(err)}` }, { status: 422 });
    }
  }

  // Store in integrations table
  const [record] = await db
    .insert(integrations)
    .values({
      name: body.name,
      description: body.description || '',
      baseUrl: body.baseUrl,
      authType: body.authType,
      authConfig: body.authConfig ?? {},
      operations: body.operations,
    })
    .returning();

  // The node type uses the integration ID so it's unique and retrievable
  const nodeType = `integration:${record.id}`;

  return json({
    integration: record,
    nodeType,
    message: `Integration "${body.name}" registered. Use node type "${nodeType}" in workflows.`,
  });
};
```

**Note:** Dynamic integration nodes use `http-request` executor under the hood at runtime. The engine resolves `integration:*` node types by looking up the integration record and dispatching to `httpRequestExecutor` with pre-configured `baseUrl` and auth. Implement the engine-side resolution in a follow-up if needed — the endpoint alone unblocks orchestrator usage.
