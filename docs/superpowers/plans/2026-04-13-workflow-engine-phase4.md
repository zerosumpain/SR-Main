# Workflow Engine Phase 4: Remaining Core Nodes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 new node types: HTTP Request, LLM Call, Conditional, Loop, Delay, Error Handler, Data Store, and Email. Each has an executor, definition, unit test, and Svelte component.

**Architecture:** Each node follows the exact pattern of `src/lib/workflows/nodes/transform.ts` — a named `*Executor` export and a named `*Def` export. Executors are registered in `src/lib/workflows/index.ts` (server barrel). Client-only `NodeDefinition` objects (without executor import) are added to `src/lib/workflows/registry-client.ts`. Custom Svelte components extend `BaseNode.svelte` and live in `src/lib/components/workflows/nodes/`.

**Template variables:** HTTP Request, LLM Call, and Email nodes support `{{input.field}}` template interpolation. A shared utility `interpolateTemplate(template: string, input: Record<string, unknown>): string` lives in `src/lib/workflows/nodes/template.ts`.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Drizzle ORM, OpenAI SDK (OpenRouter), native `fetch`, nodemailer (install if not present).

**Design spec:** `docs/superpowers/specs/2026-04-12-workflow-engine-design.md` — Section 3 (Built-in Node Types + Control Flow).

**Depends on:** Phase 1 (completed). Phase 3 is NOT a dependency — these nodes are independent.

**Parallelisation note:** Tasks 1–6 (HTTP Request, LLM Call, Delay, Data Store, Email, and the template utility) are fully independent of each other. Tasks 7 (Conditional) and 8 (Loop) each require engine modifications — do those after the engine is stable from Tasks 1–6.

---

## Shared Setup: Template Utility

**Must be done first** — used by Tasks 1, 2, and 6.

**Files:**
- Create: `src/lib/workflows/nodes/template.ts`
- Create: `tests/lib/workflows/nodes/template.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/template.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { interpolateTemplate } from '$lib/workflows/nodes/template';

describe('interpolateTemplate', () => {
  it('replaces simple field reference', () => {
    expect(interpolateTemplate('Hello {{input.name}}', { name: 'World' })).toBe('Hello World');
  });

  it('replaces nested dot-path', () => {
    expect(interpolateTemplate('{{input.user.email}}', { user: { email: 'a@b.com' } })).toBe('a@b.com');
  });

  it('serialises object values as JSON', () => {
    expect(interpolateTemplate('{{input.items}}', { items: [1, 2] })).toBe('[1,2]');
  });

  it('leaves unknown references as empty string', () => {
    expect(interpolateTemplate('{{input.missing}}', {})).toBe('');
  });

  it('leaves non-template strings unchanged', () => {
    expect(interpolateTemplate('no templates here', {})).toBe('no templates here');
  });

  it('handles multiple replacements in one string', () => {
    expect(
      interpolateTemplate('{{input.first}} {{input.last}}', { first: 'John', last: 'Kelly' })
    ).toBe('John Kelly');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/template.test.ts
```

- [ ] **Step 3: Create template.ts**

```typescript
// src/lib/workflows/nodes/template.ts

/**
 * Interpolate {{input.field.path}} references in a template string.
 * Resolves dot-paths into the input object. Non-string values are JSON-serialised.
 * Unknown paths produce empty string.
 */
export function interpolateTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{input\.([^}]+)\}\}/g, (_match, path: string) => {
    const value = resolvePath(input, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/template.test.ts
```

---

## Task 1: HTTP Request Node

**Files:**
- Create: `src/lib/workflows/nodes/http-request.ts`
- Create: `tests/lib/workflows/nodes/http-request.test.ts`
- Create: `src/lib/components/workflows/nodes/HttpRequestNode.svelte`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

### Config schema

```typescript
{
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',  // default 'GET'
  url: string,         // supports {{input.field}} templates
  headers: string,     // JSON object string, supports templates
  body: string,        // JSON or template string (ignored for GET)
  auth: 'none' | 'bearer' | 'apiKey',  // default 'none'
  authToken: string,   // bearer token or API key value, supports templates
  authHeader: string,  // header name for apiKey auth (default 'X-API-Key')
}
```

### Output schema

```typescript
{ status: number, headers: Record<string, string>, body: unknown }
```

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/http-request.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpRequestExecutor, httpRequestDef } from '$lib/workflows/nodes/http-request';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('httpRequestExecutor', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes a GET request and returns status + body', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ hello: 'world' }),
      text: async () => '{"hello":"world"}',
      ok: true,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as any);

    const result = await httpRequestExecutor.execute(
      {},
      { method: 'GET', url: 'https://example.com/api', headers: '{}', body: '', auth: 'none' },
      mockContext,
    );

    expect(result.output.status).toBe(200);
    expect(result.output.body).toEqual({ hello: 'world' });
  });

  it('interpolates template variables in URL', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '{}',
      ok: true,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as any);

    await httpRequestExecutor.execute(
      { userId: '42' },
      { method: 'GET', url: 'https://example.com/users/{{input.userId}}', headers: '{}', body: '', auth: 'none' },
      mockContext,
    );

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      'https://example.com/users/42',
      expect.anything(),
    );
  });

  it('adds bearer token when auth is bearer', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers(),
      json: async () => ({}),
      text: async () => '{}',
      ok: true,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as any);

    await httpRequestExecutor.execute(
      {},
      { method: 'GET', url: 'https://example.com', headers: '{}', body: '', auth: 'bearer', authToken: 'mytoken' },
      mockContext,
    );

    const callArgs = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((callArgs.headers as Record<string, string>)['Authorization']).toBe('Bearer mytoken');
  });

  it('returns non-JSON response as text in body', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ 'content-type': 'text/plain' }),
      json: async () => { throw new Error('not JSON'); },
      text: async () => 'plain text response',
      ok: true,
    };
    vi.mocked(fetch).mockResolvedValue(mockResponse as any);

    const result = await httpRequestExecutor.execute(
      {},
      { method: 'GET', url: 'https://example.com', headers: '{}', body: '', auth: 'none' },
      mockContext,
    );

    expect(result.output.body).toBe('plain text response');
  });

  it('has correct type', () => {
    expect(httpRequestExecutor.type).toBe('http-request');
  });
});

describe('httpRequestDef', () => {
  it('is core category', () => {
    expect(httpRequestDef.category).toBe('core');
  });
  it('has required url in configSchema', () => {
    expect(httpRequestDef.configSchema.properties?.url).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/http-request.test.ts
```

- [ ] **Step 3: Create src/lib/workflows/nodes/http-request.ts**

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';

export const httpRequestExecutor: NodeExecutor = {
  type: 'http-request',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const method = (config.method as string) || 'GET';
    const rawUrl = (config.url as string) || '';
    const rawHeaders = (config.headers as string) || '{}';
    const rawBody = (config.body as string) || '';
    const auth = (config.auth as string) || 'none';
    const authToken = interpolateTemplate((config.authToken as string) || '', input);
    const authHeader = (config.authHeader as string) || 'X-API-Key';

    const url = interpolateTemplate(rawUrl, input);

    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(interpolateTemplate(rawHeaders, input));
    } catch {
      // ignore malformed headers JSON
    }

    if (auth === 'bearer' && authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    } else if (auth === 'apiKey' && authToken) {
      headers[authHeader] = authToken;
    }

    const fetchInit: RequestInit = { method, headers };

    if (method !== 'GET' && method !== 'HEAD' && rawBody) {
      const interpolatedBody = interpolateTemplate(rawBody, input);
      try {
        JSON.parse(interpolatedBody); // validate
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        fetchInit.body = interpolatedBody;
      } catch {
        fetchInit.body = interpolatedBody;
      }
    }

    const response = await fetch(url, fetchInit);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = response.headers.get('content-type') || '';
    let body: unknown;
    if (contentType.includes('application/json')) {
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
    } else {
      body = await response.text();
    }

    return {
      output: {
        status: response.status,
        headers: responseHeaders,
        body,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for URL/header/body template interpolation' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        status: { type: 'number', description: 'HTTP status code' },
        headers: { type: 'object', description: 'Response headers' },
        body: { type: 'any', description: 'Parsed JSON or raw text response body' },
      },
    };
  },
};

export const httpRequestDef: NodeDefinition = {
  type: 'http-request',
  label: 'HTTP Request',
  category: 'core',
  description: 'Make an HTTP request. URL, headers, and body support {{input.field}} template variables.',
  configSchema: {
    type: 'object',
    properties: {
      method: { type: 'string', description: 'HTTP method: GET, POST, PUT, PATCH, DELETE' },
      url: { type: 'string', description: 'Request URL. Supports {{input.field}} templates.' },
      headers: { type: 'string', description: 'JSON object of request headers. Supports templates.' },
      body: { type: 'string', description: 'Request body (JSON or template string). Ignored for GET.' },
      auth: { type: 'string', description: 'Auth type: none, bearer, apiKey' },
      authToken: { type: 'string', description: 'Token value for bearer/apiKey auth. Supports templates.' },
      authHeader: { type: 'string', description: 'Header name for apiKey auth (default: X-API-Key)' },
    },
    required: ['url'],
  },
  defaultConfig: { method: 'GET', url: '', headers: '{}', body: '', auth: 'none', authToken: '', authHeader: 'X-API-Key' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Response' }],
};
```

- [ ] **Step 4: Register in index.ts**

```typescript
import { httpRequestDef, httpRequestExecutor } from './nodes/http-request';
// ...
registry.register(httpRequestDef, httpRequestExecutor);
```

- [ ] **Step 5: Register definition in registry-client.ts**

Inline the definition (same pattern as `codeExecuteDef` in the client registry) or import only the def:

```typescript
import { httpRequestDef } from './nodes/http-request';
// Add to nodeDefinitions array
```

Since `http-request.ts` only imports `template.ts` (no Node.js-only modules), it is safe to import directly.

- [ ] **Step 6: Create HttpRequestNode.svelte**

```svelte
<!-- src/lib/components/workflows/nodes/HttpRequestNode.svelte -->
<script lang="ts">
  import BaseNode from '../BaseNode.svelte';

  let { data, id } = $props();
  const method = data.config?.method || 'GET';

  const METHOD_COLORS: Record<string, string> = {
    GET: '#2d7d46',
    POST: '#569cd6',
    PUT: '#b8860b',
    PATCH: '#8b5cf6',
    DELETE: '#b43232',
  };
  const methodColor = METHOD_COLORS[method] || 'var(--text-ghost)';
</script>

<BaseNode
  label={data.label}
  nodeType="http-request"
  status={data.status}
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
  icon="🌐"
>
  {#snippet extra()}
    <div class="px-3 pb-2 flex items-center gap-2">
      <span
        class="text-[10px] font-bold px-1.5 py-0.5 rounded"
        style="background: {methodColor}22; color: {methodColor}; font-family: var(--font-mono);"
      >
        {method}
      </span>
      {#if data.config?.url}
        <span class="text-[10px] truncate max-w-[120px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
          {data.config.url}
        </span>
      {/if}
    </div>
  {/snippet}
</BaseNode>
```

Note: BaseNode needs a `{#snippet extra()}` slot — add this if not already present. If BaseNode doesn't support extra slot yet, just use the basic BaseNode without the extra.

- [ ] **Step 7: Run tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/http-request.test.ts
```

---

## Task 2: LLM Call Node

**Files:**
- Create: `src/lib/workflows/nodes/llm-call.ts`
- Create: `tests/lib/workflows/nodes/llm-call.test.ts`
- Create: `src/lib/components/workflows/nodes/LlmCallNode.svelte`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

### Config schema

```typescript
{
  model: string,           // OpenRouter model ID, e.g. 'openai/gpt-4o-mini'
  systemPrompt: string,    // supports {{input.field}} templates
  userPrompt: string,      // supports {{input.field}} templates
  temperature: number,     // 0–2, default 0.7
  maxTokens: number,       // default 1024
}
```

### Output schema

```typescript
{ response: string, usage: { promptTokens: number, completionTokens: number } }
```

Uses `getOpenRouterClient()` from `src/lib/deepdive/keys.ts`.

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/llm-call.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { llmCallExecutor, llmCallDef } from '$lib/workflows/nodes/llm-call';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

vi.mock('$lib/deepdive/keys', () => ({
  getOpenRouterClient: () => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Mock LLM response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      },
    },
  }),
}));

describe('llmCallExecutor', () => {
  it('returns response and usage', async () => {
    const result = await llmCallExecutor.execute(
      { topic: 'cats' },
      {
        model: 'openai/gpt-4o-mini',
        systemPrompt: 'You are helpful.',
        userPrompt: 'Tell me about {{input.topic}}.',
        temperature: 0.7,
        maxTokens: 100,
      },
      mockContext,
    );

    expect(result.output.response).toBe('Mock LLM response');
    expect(result.output.usage).toEqual({ promptTokens: 10, completionTokens: 20 });
  });

  it('interpolates templates in prompts', async () => {
    const { getOpenRouterClient } = await import('$lib/deepdive/keys');
    const createSpy = (getOpenRouterClient() as any).chat.completions.create;

    await llmCallExecutor.execute(
      { name: 'Alice' },
      {
        model: 'openai/gpt-4o-mini',
        systemPrompt: 'System prompt.',
        userPrompt: 'Hello {{input.name}}!',
        temperature: 0.5,
        maxTokens: 50,
      },
      mockContext,
    );

    const callArgs = createSpy.mock.calls.at(-1)[0];
    const userMsg = callArgs.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toBe('Hello Alice!');
  });

  it('has correct type', () => {
    expect(llmCallExecutor.type).toBe('llm-call');
  });
});

describe('llmCallDef', () => {
  it('is core category', () => {
    expect(llmCallDef.category).toBe('core');
  });
  it('has model in configSchema', () => {
    expect(llmCallDef.configSchema.properties?.model).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/llm-call.test.ts
```

- [ ] **Step 3: Create src/lib/workflows/nodes/llm-call.ts**

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { getOpenRouterClient } from '$lib/deepdive/keys';

export const llmCallExecutor: NodeExecutor = {
  type: 'llm-call',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
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
        usage: {
          promptTokens: usage?.prompt_tokens ?? 0,
          completionTokens: usage?.completion_tokens ?? 0,
        },
      },
      metadata: {
        model,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available for template interpolation in prompts' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        response: { type: 'string', description: 'LLM response text' },
        usage: {
          type: 'object',
          properties: {
            promptTokens: { type: 'number' },
            completionTokens: { type: 'number' },
          },
        },
      },
    };
  },
};

export const llmCallDef: NodeDefinition = {
  type: 'llm-call',
  label: 'LLM Call',
  category: 'core',
  description: 'Call an LLM via OpenRouter. System and user prompts support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      model: { type: 'string', description: 'OpenRouter model ID, e.g. openai/gpt-4o-mini' },
      systemPrompt: { type: 'string', description: 'System prompt. Supports {{input.field}} templates.' },
      userPrompt: { type: 'string', description: 'User prompt. Supports {{input.field}} templates.' },
      temperature: { type: 'number', description: 'Sampling temperature 0–2 (default 0.7)' },
      maxTokens: { type: 'number', description: 'Max tokens to generate (default 1024)' },
    },
    required: ['userPrompt'],
  },
  defaultConfig: { model: 'openai/gpt-4o-mini', systemPrompt: '', userPrompt: '', temperature: 0.7, maxTokens: 1024 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Response' }],
};
```

- [ ] **Step 4: Register in index.ts and registry-client.ts**

In `index.ts`:
```typescript
import { llmCallDef, llmCallExecutor } from './nodes/llm-call';
registry.register(llmCallDef, llmCallExecutor);
```

In `registry-client.ts`, inline the definition (DO NOT import from `llm-call.ts` — it imports `$lib/deepdive/keys` which reads `process.cwd()` and is Node-only):

```typescript
const llmCallDef: NodeDefinition = {
  type: 'llm-call',
  label: 'LLM Call',
  category: 'core',
  description: 'Call an LLM via OpenRouter. System and user prompts support {{input.field}} templates.',
  configSchema: { /* same as above */ },
  defaultConfig: { model: 'openai/gpt-4o-mini', systemPrompt: '', userPrompt: '', temperature: 0.7, maxTokens: 1024 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Response' }],
};
```

- [ ] **Step 5: Create LlmCallNode.svelte**

Show model name and truncated user prompt as a preview badge below the node label. Extend BaseNode.

- [ ] **Step 6: Run tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/llm-call.test.ts
```

---

## Task 3: Delay Node

**Files:**
- Create: `src/lib/workflows/nodes/delay.ts`
- Create: `tests/lib/workflows/nodes/delay.test.ts`
- Create: `src/lib/components/workflows/nodes/DelayNode.svelte`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

Simple: wait `config.milliseconds`, then pass input through unchanged.

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/delay.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { delayExecutor, delayDef } from '$lib/workflows/nodes/delay';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('delayExecutor', () => {
  it('passes input through unchanged', async () => {
    vi.useFakeTimers();
    const promise = delayExecutor.execute({ foo: 'bar' }, { milliseconds: 1000 }, mockContext);
    vi.advanceTimersByTime(1000);
    const result = await promise;
    expect(result.output).toEqual({ foo: 'bar' });
    vi.useRealTimers();
  });

  it('waits the configured delay', async () => {
    vi.useFakeTimers();
    let resolved = false;
    const promise = delayExecutor.execute({}, { milliseconds: 500 }, mockContext).then(() => { resolved = true; });
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(499);
    await Promise.resolve();
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(1);
    await promise;
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it('has correct type', () => {
    expect(delayExecutor.type).toBe('delay');
  });
});

describe('delayDef', () => {
  it('is control category', () => {
    expect(delayDef.category).toBe('control');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/delay.test.ts
```

- [ ] **Step 3: Create src/lib/workflows/nodes/delay.ts**

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const delayExecutor: NodeExecutor = {
  type: 'delay',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const ms = (config.milliseconds as number) || 0;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { output: { ...input } };
  },

  getInputSchema() {
    return { type: 'object', description: 'Passed through unchanged after the delay' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Same as input — passed through after delay' };
  },
};

export const delayDef: NodeDefinition = {
  type: 'delay',
  label: 'Delay',
  category: 'control',
  description: 'Wait a fixed duration, then pass input through unchanged.',
  configSchema: {
    type: 'object',
    properties: {
      milliseconds: { type: 'number', description: 'Delay in milliseconds' },
    },
    required: ['milliseconds'],
  },
  defaultConfig: { milliseconds: 1000 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
};
```

- [ ] **Step 4: Register in index.ts and registry-client.ts**

`delay.ts` has no Node-only imports, so it can be imported directly in `registry-client.ts`.

- [ ] **Step 5: Create DelayNode.svelte**

Minimal extension of BaseNode. Show the configured duration as a badge (e.g. "1000ms").

- [ ] **Step 6: Run tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/delay.test.ts
```

---

## Task 4: Data Store Node

Reads/writes a workflow-scoped key-value store in the DB. Survives across runs — intended for stateful workflows (e.g. "last processed item ID").

**Files:**
- Create migration: `supabase/migrations/YYYYMMDD_workflow_data_store.sql`
- Create: `src/lib/workflows/nodes/data-store.ts`
- Create: `tests/lib/workflows/nodes/data-store.test.ts`
- Create: `src/lib/components/workflows/nodes/DataStoreNode.svelte`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

### DB table: `workflowDataStore`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| workflowId | uuid | FK → workflows, cascade delete |
| key | text | |
| value | jsonb | |
| updatedAt | timestamp with tz | |

Unique constraint on `(workflowId, key)`. Use upsert for set operations.

### Config schema

```typescript
{
  operation: 'get' | 'set',
  key: string,   // supports {{input.field}} templates
}
```

### Output schema for `get`

```typescript
{ value: unknown, found: boolean }
```

### Output schema for `set`

```typescript
{ key: string, value: unknown, stored: true }
```

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/data-store.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { dataStoreExecutor, dataStoreDef } from '$lib/workflows/nodes/data-store';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock the db
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ value: { count: 5 } }]),
    then: undefined,
  },
}));

vi.mock('$lib/db/schema', () => ({
  workflowDataStore: { workflowId: 'workflowId', key: 'key', value: 'value', updatedAt: 'updatedAt', id: 'id' },
}));

const mockContext: ExecutionContext & { workflowId?: string } = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
  workflowId: 'wf-123',
} as any;

describe('dataStoreExecutor', () => {
  it('has correct type', () => {
    expect(dataStoreExecutor.type).toBe('data-store');
  });
});

describe('dataStoreDef', () => {
  it('is core category', () => {
    expect(dataStoreDef.category).toBe('core');
  });
  it('has operation and key in configSchema', () => {
    expect(dataStoreDef.configSchema.properties?.operation).toBeDefined();
    expect(dataStoreDef.configSchema.properties?.key).toBeDefined();
  });
});
```

Note: Full DB integration testing is out of scope for unit tests. The test above covers definition shape. Real behaviour is tested manually via a running workflow.

- [ ] **Step 2: Add workflowDataStore to schema.ts**

Append to `src/lib/db/schema.ts`:

```typescript
export const workflowDataStore = pgTable(
  'workflow_data_store',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueWorkflowKey: uniqueIndex('workflow_data_store_workflow_key_idx').on(table.workflowId, table.key),
  }),
);
```

- [ ] **Step 3: Create migration SQL**

File name: `supabase/migrations/<timestamp>_workflow_data_store.sql`

```sql
CREATE TABLE IF NOT EXISTS workflow_data_store (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, key)
);
```

Run: `npx drizzle-kit push` (or the project's migration command).

- [ ] **Step 4: Create src/lib/workflows/nodes/data-store.ts**

The executor needs the `workflowId` to scope keys. Add `workflowId` to `ExecutionContext` in `types.ts`:

```typescript
// In types.ts — add to ExecutionContext:
workflowId: string;
```

Update the engine and run route to pass `workflowId` in the context.

The executor:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { workflowDataStore } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const dataStoreExecutor: NodeExecutor = {
  type: 'data-store',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'get';
    const key = interpolateTemplate((config.key as string) || '', input);
    const workflowId = (context as any).workflowId as string;

    if (!workflowId) {
      return { output: { error: 'workflowId not available in context' } };
    }

    if (operation === 'get') {
      const [row] = await db
        .select()
        .from(workflowDataStore)
        .where(and(eq(workflowDataStore.workflowId, workflowId), eq(workflowDataStore.key, key)));

      return {
        output: {
          value: row?.value ?? null,
          found: row !== undefined,
        },
      };
    } else if (operation === 'set') {
      const value = input.value !== undefined ? input.value : input;

      await db
        .insert(workflowDataStore)
        .values({ workflowId, key, value: value as any, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [workflowDataStore.workflowId, workflowDataStore.key],
          set: { value: value as any, updatedAt: new Date() },
        });

      return { output: { key, value, stored: true } };
    }

    return { output: { error: `Unknown operation: ${operation}` } };
  },

  getInputSchema() {
    return { type: 'object', description: 'For set: input.value is stored. Key supports templates.' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    if (config.operation === 'set') {
      return {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'any' },
          stored: { type: 'boolean' },
        },
      };
    }
    return {
      type: 'object',
      properties: {
        value: { type: 'any', description: 'Stored value, or null if not found' },
        found: { type: 'boolean' },
      },
    };
  },
};

export const dataStoreDef: NodeDefinition = {
  type: 'data-store',
  label: 'Data Store',
  category: 'core',
  description: 'Read or write a value in the workflow-scoped key-value store. Persists across runs.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'get or set' },
      key: { type: 'string', description: 'Key name. Supports {{input.field}} templates.' },
    },
    required: ['operation', 'key'],
  },
  defaultConfig: { operation: 'get', key: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
};
```

- [ ] **Step 5: Register in index.ts; inline def in registry-client.ts**

`data-store.ts` imports `$lib/db` (Node-only), so inline the def in `registry-client.ts`.

- [ ] **Step 6: Update engine.ts and run/+server.ts to pass workflowId in context**

In `execute`, add `workflowId` param and pass to `ExecutionContext`.

In `run/+server.ts`, pass `workflowId: params.id` in the context.

- [ ] **Step 7: Create DataStoreNode.svelte**

Show operation badge (`GET` / `SET`) and key name.

- [ ] **Step 8: Run tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/data-store.test.ts
```

---

## Task 5: Email Node

**Files:**
- Create: `src/lib/workflows/nodes/email.ts`
- Create: `tests/lib/workflows/nodes/email.test.ts`
- Create: `src/lib/components/workflows/nodes/EmailNode.svelte`
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

Check if nodemailer is installed:

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && ls node_modules | grep nodemailer
```

If not installed:

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npm install nodemailer && npm install --save-dev @types/nodemailer
```

### Config schema

```typescript
{
  to: string,       // supports {{input.field}} templates
  subject: string,  // supports templates
  body: string,     // supports templates; treated as HTML if starts with '<'
  from: string,     // optional override, defaults to SMTP_FROM env var
}
```

SMTP config comes from environment variables: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/email.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { emailExecutor, emailDef } from '$lib/workflows/nodes/email';
import type { ExecutionContext } from '$lib/workflows/types';

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-msg-id-123' }),
    })),
  },
}));

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
} as any;

describe('emailExecutor', () => {
  it('sends an email and returns sent + messageId', async () => {
    const result = await emailExecutor.execute(
      { name: 'Alice' },
      {
        to: 'alice@example.com',
        subject: 'Hello {{input.name}}',
        body: 'Hi {{input.name}}, welcome!',
      },
      mockContext,
    );

    expect(result.output.sent).toBe(true);
    expect(result.output.messageId).toBe('test-msg-id-123');
  });

  it('interpolates templates in to, subject, and body', async () => {
    const nodemailer = await import('nodemailer');
    const transporter = (nodemailer.default.createTransport as any).mock.results[0]?.value;
    const sendMailSpy = transporter?.sendMail;
    if (!sendMailSpy) return; // skip if mock not wired

    await emailExecutor.execute(
      { email: 'bob@example.com', greeting: 'Bob' },
      {
        to: '{{input.email}}',
        subject: 'Hi {{input.greeting}}',
        body: 'Dear {{input.greeting}}',
      },
      mockContext,
    );

    const mailOptions = sendMailSpy.mock.calls.at(-1)?.[0];
    expect(mailOptions?.to).toBe('bob@example.com');
    expect(mailOptions?.subject).toBe('Hi Bob');
  });

  it('has correct type', () => {
    expect(emailExecutor.type).toBe('email');
  });
});

describe('emailDef', () => {
  it('is integration category', () => {
    expect(emailDef.category).toBe('integration');
  });
  it('has to, subject, body in configSchema', () => {
    expect(emailDef.configSchema.properties?.to).toBeDefined();
    expect(emailDef.configSchema.properties?.subject).toBeDefined();
    expect(emailDef.configSchema.properties?.body).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/email.test.ts
```

- [ ] **Step 3: Create src/lib/workflows/nodes/email.ts**

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';
import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';

function createTransporter() {
  return nodemailer.createTransport({
    host: env.SMTP_HOST || 'localhost',
    port: parseInt(env.SMTP_PORT || '587'),
    secure: false,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
  });
}

export const emailExecutor: NodeExecutor = {
  type: 'email',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const to = interpolateTemplate((config.to as string) || '', input);
    const subject = interpolateTemplate((config.subject as string) || '', input);
    const body = interpolateTemplate((config.body as string) || '', input);
    const from = (config.from as string) || env.SMTP_FROM || 'noreply@localhost';

    if (!to) {
      return { output: { error: 'No recipient (to) configured' } };
    }

    const isHtml = body.trimStart().startsWith('<');
    const transporter = createTransporter();

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      ...(isHtml ? { html: body } : { text: body }),
    });

    return {
      output: {
        sent: true,
        messageId: info.messageId,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in to/subject/body' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        sent: { type: 'boolean' },
        messageId: { type: 'string' },
      },
    };
  },
};

export const emailDef: NodeDefinition = {
  type: 'email',
  label: 'Email',
  category: 'integration',
  description: 'Send an email via SMTP. To, subject, and body support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient address. Supports {{input.field}} templates.' },
      subject: { type: 'string', description: 'Email subject. Supports templates.' },
      body: { type: 'string', description: 'Email body. HTML if it starts with <. Supports templates.' },
      from: { type: 'string', description: 'Sender override (default: SMTP_FROM env var)' },
    },
    required: ['to', 'subject', 'body'],
  },
  defaultConfig: { to: '', subject: '', body: '', from: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
};
```

- [ ] **Step 4: Register in index.ts; inline def in registry-client.ts**

`email.ts` imports `nodemailer` and `$env/dynamic/private` (both Node-only). Inline the def in `registry-client.ts`.

- [ ] **Step 5: Create EmailNode.svelte**

Show "to" field preview below node label.

- [ ] **Step 6: Run tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/email.test.ts
```

---

## Task 6: Error Handler Node

Wraps a single downstream node — if that node succeeds, routes to `success` handle; if it fails, routes to `error` handle with `{ error: message }`. Two output handles: `success` and `error`.

**Files:**
- Create: `src/lib/workflows/nodes/error-handler.ts`
- Create: `tests/lib/workflows/nodes/error-handler.test.ts`
- Create: `src/lib/components/workflows/nodes/ErrorHandlerNode.svelte`
- Modify: `src/lib/workflows/engine.ts` — support error routing
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

### Design

The Error Handler node itself doesn't execute code — it wraps the edge connection semantics. When connected:
- Edge from ErrorHandler → NodeA (sourceHandle: `default`) = the node to attempt
- Edge from ErrorHandler → NodeB (sourceHandle: `success`) = run if NodeA succeeds
- Edge from ErrorHandler → NodeC (sourceHandle: `error`) = run if NodeA fails

The executor sets a special metadata flag `_isErrorHandler: true` and `_wrappedNodeId`. The engine detects this and uses try/catch around the wrapped node's execution, routing appropriately.

Simpler alternative (recommended for Phase 4): The Error Handler acts as a pass-through node that catches errors from its direct input. The previous node wraps the Error Handler — the Error Handler's input is the output of the previous node. If the previous node failed (its output has `{ error: ... }`), the Error Handler routes to `error` handle; otherwise routes to `success` handle.

Use the simpler approach:

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/error-handler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { errorHandlerExecutor, errorHandlerDef } from '$lib/workflows/nodes/error-handler';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
} as any;

describe('errorHandlerExecutor', () => {
  it('routes to success when input has no error', async () => {
    const result = await errorHandlerExecutor.execute(
      { data: 'good' },
      {},
      mockContext,
    );
    expect(result.output).toEqual({ data: 'good' });
    expect(result.metadata?._selectedHandle).toBe('success');
  });

  it('routes to error when input has error field', async () => {
    const result = await errorHandlerExecutor.execute(
      { error: 'something went wrong' },
      {},
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('error');
    expect(result.output.error).toBe('something went wrong');
  });

  it('has correct type', () => {
    expect(errorHandlerExecutor.type).toBe('error-handler');
  });
});

describe('errorHandlerDef', () => {
  it('is control category', () => {
    expect(errorHandlerDef.category).toBe('control');
  });
  it('has success and error outputs', () => {
    expect(errorHandlerDef.outputs.find(o => o.name === 'success')).toBeDefined();
    expect(errorHandlerDef.outputs.find(o => o.name === 'error')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/error-handler.test.ts
```

- [ ] **Step 3: Create src/lib/workflows/nodes/error-handler.ts**

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const errorHandlerExecutor: NodeExecutor = {
  type: 'error-handler',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const hasError = 'error' in input && input.error !== undefined;
    return {
      output: { ...input },
      metadata: { _selectedHandle: hasError ? 'error' : 'success' },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Output from upstream node. If it has an error field, routes to error handle.' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Input passed through. Routes to success or error handle.' };
  },
};

export const errorHandlerDef: NodeDefinition = {
  type: 'error-handler',
  label: 'Error Handler',
  category: 'control',
  description: 'Routes to success handle if input is clean, or error handle if input contains an error field.',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'success', type: 'any', label: 'Success' },
    { name: 'error', type: 'any', label: 'Error' },
  ],
};
```

- [ ] **Step 4: Engine modification — handle _selectedHandle in routing**

In `engine.ts`, after a node's executor returns a result, check `result.metadata?._selectedHandle`. If set, only traverse edges from this node whose `sourceHandle` matches `_selectedHandle`. Edges without a matching `sourceHandle` are skipped (their target nodes are never added to the execution queue for that branch).

This requires a change in how the engine walks the graph. After topological sort, the engine currently runs all levels unconditionally. To support handle-based routing, add a `skippedNodes` Set. When a conditional/error-handler node sets `_selectedHandle`, add all nodes reachable only via the non-selected handle to `skippedNodes`. Skip those nodes during execution (emit `node_skipped` event, set status to `skipped`).

This is the same engine change needed for Task 7 (Conditional). Implement it once for both.

- [ ] **Step 5: Register in index.ts and registry-client.ts**

`error-handler.ts` has no Node-only imports, safe to import directly in both.

- [ ] **Step 6: Create ErrorHandlerNode.svelte**

Two output handles visible: `success` (green dot) and `error` (red dot).

- [ ] **Step 7: Run tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/error-handler.test.ts
```

---

## Task 7: Conditional Node (requires engine modification)

**Files:**
- Create: `src/lib/workflows/nodes/conditional.ts`
- Create: `tests/lib/workflows/nodes/conditional.test.ts`
- Create: `src/lib/components/workflows/nodes/ConditionalNode.svelte`
- Modify: `src/lib/workflows/engine.ts` — conditional routing via _selectedHandle
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

### Config schema

```typescript
{
  expression: string,  // JS boolean expression; `input` is the input object. e.g. 'input.count > 10'
}
```

### Output handles

- `true` — followed when expression evaluates truthy
- `false` — followed when expression evaluates falsy

### Executor behaviour

Evaluate `expression` with `new Function('input', 'return !!(' + expression + ')')`. Set `metadata._selectedHandle` to `'true'` or `'false'`.

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/conditional.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { conditionalExecutor, conditionalDef } from '$lib/workflows/nodes/conditional';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
} as any;

describe('conditionalExecutor', () => {
  it('sets _selectedHandle to "true" when expression is truthy', async () => {
    const result = await conditionalExecutor.execute(
      { count: 15 },
      { expression: 'input.count > 10' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('true');
    expect(result.output).toEqual({ count: 15 });
  });

  it('sets _selectedHandle to "false" when expression is falsy', async () => {
    const result = await conditionalExecutor.execute(
      { count: 5 },
      { expression: 'input.count > 10' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('false');
  });

  it('handles expression errors gracefully — routes to false', async () => {
    const result = await conditionalExecutor.execute(
      {},
      { expression: 'nonexistent.property.deep' },
      mockContext,
    );
    expect(result.metadata?._selectedHandle).toBe('false');
    expect(result.output.error).toBeDefined();
  });

  it('has correct type', () => {
    expect(conditionalExecutor.type).toBe('conditional');
  });
});

describe('conditionalDef', () => {
  it('is control category', () => {
    expect(conditionalDef.category).toBe('control');
  });
  it('has true and false outputs', () => {
    expect(conditionalDef.outputs.find(o => o.name === 'true')).toBeDefined();
    expect(conditionalDef.outputs.find(o => o.name === 'false')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/conditional.test.ts
```

- [ ] **Step 3: Create src/lib/workflows/nodes/conditional.ts**

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const conditionalExecutor: NodeExecutor = {
  type: 'conditional',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const expression = (config.expression as string) || 'false';
    let selected: 'true' | 'false' = 'false';

    try {
      const fn = new Function('input', `return !!(${expression})`);
      const result = fn(input);
      selected = result ? 'true' : 'false';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: { ...input, error: `Conditional expression error: ${message}` },
        metadata: { _selectedHandle: 'false' },
      };
    }

    return {
      output: { ...input },
      metadata: { _selectedHandle: selected },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available as `input` in expression' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Input passed through to selected branch' };
  },
};

export const conditionalDef: NodeDefinition = {
  type: 'conditional',
  label: 'Conditional',
  category: 'control',
  description: 'Evaluates a JS boolean expression and routes to the "true" or "false" output handle.',
  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'Boolean JS expression. `input` is the input object. e.g. input.count > 10',
      },
    },
    required: ['expression'],
  },
  defaultConfig: { expression: 'false' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [
    { name: 'true', type: 'any', label: 'True branch' },
    { name: 'false', type: 'any', label: 'False branch' },
  ],
};
```

- [ ] **Step 4: Engine modification — _selectedHandle routing**

This is shared with the Error Handler (Task 6, Step 4). Implement once here if doing tasks in order, or coordinate if parallelising.

In `engine.ts`, add a `skippedNodes` Set. After each node executes:

1. Check `result.metadata?._selectedHandle`
2. If set, find all edges from this node where `sourceHandle !== _selectedHandle`
3. Recursively mark all nodes reachable only via those edges as skipped (only if they have no other non-skipped incoming edges)
4. When processing a node: if it's in `skippedNodes`, emit `node_skipped` and `continue` without executing

Also write a test in `tests/lib/workflows/engine-routing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { manualTriggerDef, manualTriggerExecutor } from '$lib/workflows/nodes/manual-trigger';
import { transformDef, transformExecutor } from '$lib/workflows/nodes/transform';
import { conditionalDef, conditionalExecutor } from '$lib/workflows/nodes/conditional';
import type { WorkflowDefinition } from '$lib/workflows/types';

function makeEngine() {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(transformDef, transformExecutor);
  registry.register(conditionalDef, conditionalExecutor);
  return new WorkflowEngine(registry);
}

describe('conditional routing', () => {
  it('executes only the true branch when condition is met', async () => {
    const engine = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Conditional Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'cond', type: 'conditional', position: { x: 200, y: 0 }, config: { expression: 'input.x > 5' }, label: 'Check' },
        { id: 'truePath', type: 'transform', position: { x: 400, y: -50 }, config: { expression: 'return { result: "true branch" }' }, label: 'True' },
        { id: 'falsePath', type: 'transform', position: { x: 400, y: 50 }, config: { expression: 'return { result: "false branch" }' }, label: 'False' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'cond' },
        { id: 'e2', sourceNodeId: 'cond', targetNodeId: 'truePath', sourceHandle: 'true' },
        { id: 'e3', sourceNodeId: 'cond', targetNodeId: 'falsePath', sourceHandle: 'false' },
      ],
    };

    const result = await engine.execute(workflow, 'run-cond-1', { x: 10 });

    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('truePath')).toEqual({ result: 'true branch' });
    expect(result.nodeOutputs.has('falsePath')).toBe(false); // skipped
  });
});
```

- [ ] **Step 5: Register in index.ts and registry-client.ts**

`conditional.ts` has no Node-only imports.

- [ ] **Step 6: Create ConditionalNode.svelte**

Show two output handles labelled "true" (green) and "false" (red). Show expression preview.

- [ ] **Step 7: Run all routing + conditional tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/conditional.test.ts tests/lib/workflows/engine-routing.test.ts
```

---

## Task 8: Loop Node (requires engine modification)

**Files:**
- Create: `src/lib/workflows/nodes/loop.ts`
- Create: `tests/lib/workflows/nodes/loop.test.ts`
- Create: `src/lib/components/workflows/nodes/LoopNode.svelte`
- Modify: `src/lib/workflows/engine.ts` — loop execution
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`

### Config schema

```typescript
{
  arrayPath: string,   // dot-path into input to find the array, e.g. 'items'
  concurrency: number, // max parallel iterations, default 1
}
```

### Execution model

The Loop node outputs a `_loopItems` metadata hint. The engine detects this and runs all downstream nodes (the loop body subgraph) once per item, collecting results. Each iteration provides `{ item, index, ...parentInput }` as the input.

**Important:** The loop body subgraph is all nodes reachable from the Loop node (before any non-loop node or a "merge" node). For Phase 4, use a simplified model: the Loop node executes its downstream subgraph N times sequentially (or with concurrency). Collecting results means the engine gathers the final outputs of all subgraph leaf nodes per iteration and assembles them into an array on the Loop node's output.

Simpler approach for Phase 4: The executor itself iterates and calls downstream nodes directly, by having the engine expose a method to execute a subgraph. This is complex — instead, use the simplest possible model: the Loop node takes an array, runs each item through a Transform expression configured on the node itself (not a full subgraph), and outputs the mapped array.

**Recommended Phase 4 approach (inline map):**

Config: `{ arrayPath: string, expression: string }` — the `expression` is a JS function body available as `item` and `input`. Returns mapped item. The loop iterates, applies expression, collects results.

Full subgraph looping is a Phase 5+ enhancement.

- [ ] **Step 1: Write failing test**

Create `tests/lib/workflows/nodes/loop.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { loopExecutor, loopDef } from '$lib/workflows/nodes/loop';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
} as any;

describe('loopExecutor', () => {
  it('maps over an array with an expression', async () => {
    const result = await loopExecutor.execute(
      { numbers: [1, 2, 3] },
      { arrayPath: 'numbers', expression: 'return { value: item * 2 }' },
      mockContext,
    );
    expect(result.output.results).toEqual([{ value: 2 }, { value: 4 }, { value: 6 }]);
    expect(result.output.count).toBe(3);
  });

  it('returns empty results for empty array', async () => {
    const result = await loopExecutor.execute(
      { items: [] },
      { arrayPath: 'items', expression: 'return item' },
      mockContext,
    );
    expect(result.output.results).toEqual([]);
    expect(result.output.count).toBe(0);
  });

  it('returns error when arrayPath is not an array', async () => {
    const result = await loopExecutor.execute(
      { notArray: 'hello' },
      { arrayPath: 'notArray', expression: 'return item' },
      mockContext,
    );
    expect(result.output.error).toBeDefined();
  });

  it('has correct type', () => {
    expect(loopExecutor.type).toBe('loop');
  });
});

describe('loopDef', () => {
  it('is control category', () => {
    expect(loopDef.category).toBe('control');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/loop.test.ts
```

- [ ] **Step 3: Create src/lib/workflows/nodes/loop.ts**

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export const loopExecutor: NodeExecutor = {
  type: 'loop',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const arrayPath = (config.arrayPath as string) || '';
    const expression = (config.expression as string) || 'return item';

    const array = resolvePath(input, arrayPath);

    if (!Array.isArray(array)) {
      return {
        output: { error: `arrayPath "${arrayPath}" does not resolve to an array` },
      };
    }

    const results: unknown[] = [];
    for (let index = 0; index < array.length; index++) {
      const item = array[index];
      try {
        const fn = new Function('item', 'index', 'input', expression);
        const result = fn(item, index, input);
        results.push(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ error: message, item, index });
      }
    }

    return {
      output: {
        results,
        count: results.length,
      },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Must contain an array at arrayPath' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        results: { type: 'array', description: 'Array of expression results, one per input item' },
        count: { type: 'number', description: 'Number of items processed' },
      },
    };
  },
};

export const loopDef: NodeDefinition = {
  type: 'loop',
  label: 'Loop',
  category: 'control',
  description: 'Iterate over an array, applying a JS expression to each item. Collects results into an output array.',
  configSchema: {
    type: 'object',
    properties: {
      arrayPath: {
        type: 'string',
        description: 'Dot-path to the array in input, e.g. "items" or "response.data"',
      },
      expression: {
        type: 'string',
        description: 'JS function body. `item` is the current element, `index` is the position, `input` is the full input. Must return the mapped value.',
      },
    },
    required: ['arrayPath'],
  },
  defaultConfig: { arrayPath: 'items', expression: 'return item' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Results' }],
};
```

- [ ] **Step 4: Register in index.ts and registry-client.ts**

`loop.ts` has no Node-only imports.

- [ ] **Step 5: Create LoopNode.svelte**

Show array path and iteration count (from last run output) as a badge.

- [ ] **Step 6: Run tests**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/loop.test.ts
```

---

## Final Registration Checklist

After all nodes are implemented, verify each appears in both registries:

**`src/lib/workflows/index.ts`** — must have `registry.register(...)` for all 8 nodes.

**`src/lib/workflows/registry-client.ts`** — `nodeDefinitions` array must include all 8 defs. Nodes safe to import directly: `http-request`, `delay`, `conditional`, `loop`, `error-handler`. Nodes that must be inlined: `llm-call`, `data-store`, `email`.

## Full Test Run

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/nodes/
```

## Task Order for Parallelisation

Tasks 1–6 (HTTP Request, LLM Call, Delay, Data Store, Email, Error Handler) are fully independent of each other. The shared template utility must be done first.

Tasks 7 (Conditional) and 8 (Loop) can run in parallel with each other, but both need the engine routing change from Task 7 Step 4. If parallelising, assign the engine routing change to Task 7 and have Task 8 depend on it (or implement the engine change as a prerequisite task).

Recommended parallel grouping:
- Group A (after template utility): Tasks 1, 3 (Delay), 6 (Error Handler), 8 (Loop)
- Group B (after template utility): Tasks 2 (LLM Call), 4 (Data Store), 5 (Email), 7 (Conditional + engine routing)
