# Autonomous AI Build System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JKAI interactive chat with an autonomous build system that iteratively builds projects in a Docker sandbox, driven by an LLM loop with configurable budgets.

**Architecture:** Server-side orchestrator singleton in SvelteKit runs a state machine (plan → execute → evaluate → budget check → repeat). LLM calls go through Z.AI (OpenAI-compatible). Code executes in the existing `jkai-sandbox` Docker container. Built projects are reverse-proxied via container bridge IP. All state persisted in Postgres via Drizzle.

**Tech Stack:** SvelteKit 5, Drizzle ORM, PostgreSQL, Docker, OpenAI SDK (Z.AI), SSE

**Spec:** `docs/superpowers/specs/2026-03-23-autonomous-ai-build-design.md`

---

## File Structure

```
src/lib/jkai/
  types.ts          — Type definitions (Build, Iteration, BudgetConfig, ServeConfig, etc.)
  budget.ts         — Budget checking logic (rolling 60-min window)
  prompt.ts         — System prompt construction for the autonomous builder
  sandbox.ts        — (modify) Add project-scoped exec, container IP, configurable timeouts
  orchestrator.ts   — Build loop state machine singleton
  serve.ts          — serve.json validation, server lifecycle, reverse proxy helpers

src/lib/db/
  schema.ts         — (modify) Remove old jkai tables, add new ones

src/routes/jkai/
  +layout.svelte    — (modify) Keep auth wrapper, adjust layout for new UI
  +layout.server.ts — (keep) Auth guard unchanged
  +page.svelte      — (replace) Dashboard with build cards
  +page.server.ts   — (create) Load builds list
  new/
    +page.svelte    — Create build form
  [id]/
    +page.svelte    — Build detail (activity, iterations, preview, controls)
    +page.server.ts — Load build + iterations

src/routes/api/jkai/
  builds/
    +server.ts                    — GET (list) / POST (create)
    [id]/
      +server.ts                  — GET (detail)
      pause/+server.ts            — POST
      resume/+server.ts           — POST
      stop/+server.ts             — POST
      budget/+server.ts           — PATCH
      stream/+server.ts           — GET (SSE)
  proxy/[id]/[...path]/
    +server.ts                    — ALL (reverse proxy)
```

**Files to delete:**
- `src/lib/jkai/client.ts`
- `src/lib/jkai/component-detector.ts`
- `src/routes/jkai/admin/+page.svelte`
- `src/routes/api/jkai/chat/+server.ts`
- `src/routes/api/jkai/conversations/+server.ts`
- `src/routes/api/jkai/sandbox/+server.ts`

---

## Task 1: Database Schema

**Files:**
- Modify: `src/lib/db/schema.ts:419-541` (remove old jkai tables, add new)

- [ ] **Step 1: Remove old JKAI schema definitions**

In `src/lib/db/schema.ts`, delete the following table definitions and their type exports:
- `jkaiConversations` (line 422-428)
- `jkaiMessages` (line 431-443)
- `jkaiActions` (line 445-458)
- `jkaiComponentUsage` (line 529-539) and its type export

- [ ] **Step 2: Add new JKAI schema definitions**

Add to `src/lib/db/schema.ts` after the agent settings section (no new imports needed — `doublePrecision`, `text`, `serial`, `jsonb`, `timestamp`, `integer` are already imported):

```typescript
// ==========================================
// JKAI — Autonomous Build System
// ==========================================

export const jkaiBuilds = pgTable('jkai_builds', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  title: text('title'),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('pending'), // pending | running | paused | completed | failed
  budgetConfig: jsonb('budget_config').notNull().default(sql`'{}'::jsonb`),
  tokensUsed: integer('tokens_used').notNull().default(0),
  iterationsCompleted: integer('iterations_completed').notNull().default(0),
  activeMinutesUsed: doublePrecision('active_minutes_used').notNull().default(0),
  serveConfig: jsonb('serve_config'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JkaiBuild = typeof jkaiBuilds.$inferSelect;
export type NewJkaiBuild = typeof jkaiBuilds.$inferInsert;

export const jkaiIterations = pgTable('jkai_iterations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
  number: integer('number').notNull(),
  status: text('status').notNull().default('running'), // running | completed | failed
  goals: text('goals'),
  plan: text('plan'),
  actions: jsonb('actions').notNull().default(sql`'[]'::jsonb`),
  messages: jsonb('messages').notNull().default(sql`'[]'::jsonb`),
  evaluation: text('evaluation'),
  nextSteps: text('next_steps'),
  tokensUsed: integer('tokens_used').notNull().default(0),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JkaiIteration = typeof jkaiIterations.$inferSelect;
export type NewJkaiIteration = typeof jkaiIterations.$inferInsert;

export const jkaiLogs = pgTable('jkai_logs', {
  id: serial('id').primaryKey(),
  buildId: text('build_id').notNull().references(() => jkaiBuilds.id, { onDelete: 'cascade' }),
  iterationId: text('iteration_id').references(() => jkaiIterations.id, { onDelete: 'set null' }),
  type: text('type').notNull(), // thinking | text | code | output | error | system
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type JkaiLog = typeof jkaiLogs.$inferSelect;
```

- [ ] **Step 3: Push schema changes**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit push`
Expected: Tables dropped and created successfully.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/db/schema.ts
git commit -m "feat(jkai): replace old chat schema with autonomous build tables"
```

---

## Task 2: Types

**Files:**
- Delete: `src/lib/jkai/types.ts` (old)
- Create: `src/lib/jkai/types.ts` (new)

- [ ] **Step 1: Delete old types file**

```bash
rm src/lib/jkai/types.ts
```

- [ ] **Step 2: Create new types file**

Create `src/lib/jkai/types.ts`:

```typescript
export interface BudgetConfig {
  activeMinutesPerHour?: number;
  maxTokensPerHour?: number;
  maxIterations?: number;
  maxTotalMinutes?: number;
}

export interface ServeConfig {
  port: number;
  startCommand: string;
  healthCheck: string;
  description: string;
}

export interface ActionRecord {
  lang: string;
  code: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BudgetCheckResult {
  canProceed: boolean;
  sleepMs?: number;
  reason?: string;
  shouldComplete?: boolean;
}

export type BuildStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type IterationStatus = 'running' | 'completed' | 'failed';
export type LogType = 'thinking' | 'text' | 'code' | 'output' | 'error' | 'system';
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/jkai/types.ts
git commit -m "feat(jkai): add autonomous build type definitions"
```

---

## Task 3: Budget Checking

**Files:**
- Create: `src/lib/jkai/budget.ts`

- [ ] **Step 1: Create budget module**

Create `src/lib/jkai/budget.ts`:

```typescript
import { db } from '$lib/db';
import { jkaiIterations, jkaiBuilds } from '$lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import type { BudgetConfig, BudgetCheckResult } from './types';
import type { JkaiBuild } from '$lib/db/schema';

export async function checkBudget(build: JkaiBuild): Promise<BudgetCheckResult> {
  const config = build.budgetConfig as BudgetConfig;

  // Check hard limits first
  if (config.maxIterations && build.iterationsCompleted >= config.maxIterations) {
    return { canProceed: false, shouldComplete: true, reason: `Reached max iterations (${config.maxIterations})` };
  }

  if (config.maxTotalMinutes && build.activeMinutesUsed >= config.maxTotalMinutes) {
    return { canProceed: false, shouldComplete: true, reason: `Reached total time cap (${config.maxTotalMinutes}m)` };
  }

  // Check rolling-window limits
  const windowStart = new Date(Date.now() - 60 * 60 * 1000); // 60 minutes ago

  const recentIterations = await db
    .select()
    .from(jkaiIterations)
    .where(
      and(
        eq(jkaiIterations.buildId, build.id),
        eq(jkaiIterations.status, 'completed'),
        gte(jkaiIterations.createdAt, windowStart),
      ),
    );

  // Active minutes in window
  if (config.activeMinutesPerHour) {
    const minutesInWindow = recentIterations.reduce(
      (sum, it) => sum + (it.durationMs || 0) / 60000,
      0,
    );
    if (minutesInWindow >= config.activeMinutesPerHour) {
      const oldestInWindow = recentIterations
        .map((it) => it.createdAt.getTime())
        .sort((a, b) => a - b)[0];
      const sleepMs = oldestInWindow
        ? oldestInWindow + 60 * 60 * 1000 - Date.now()
        : 60 * 1000;
      return {
        canProceed: false,
        sleepMs: Math.max(sleepMs, 1000),
        reason: `Active minutes limit reached (${minutesInWindow.toFixed(1)}/${config.activeMinutesPerHour}m). Cooling down.`,
      };
    }
  }

  // Tokens in window
  if (config.maxTokensPerHour) {
    const tokensInWindow = recentIterations.reduce(
      (sum, it) => sum + (it.tokensUsed || 0),
      0,
    );
    if (tokensInWindow >= config.maxTokensPerHour) {
      const oldestInWindow = recentIterations
        .map((it) => it.createdAt.getTime())
        .sort((a, b) => a - b)[0];
      const sleepMs = oldestInWindow
        ? oldestInWindow + 60 * 60 * 1000 - Date.now()
        : 60 * 1000;
      return {
        canProceed: false,
        sleepMs: Math.max(sleepMs, 1000),
        reason: `Token limit reached (${tokensInWindow}/${config.maxTokensPerHour}). Cooling down.`,
      };
    }
  }

  return { canProceed: true };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/budget.ts
git commit -m "feat(jkai): add budget enforcement with rolling 60-min window"
```

---

## Task 4: System Prompt

**Files:**
- Create: `src/lib/jkai/prompt.ts`

- [ ] **Step 1: Create prompt module**

Create `src/lib/jkai/prompt.ts`:

```typescript
import type { JkaiIteration } from '$lib/db/schema';

const SYSTEM_PROMPT = `You are an autonomous software builder. You work inside a Linux Docker sandbox with Python 3.12, Node 22, bash, and internet access.

YOUR WORKFLOW:
You work in iterations. Each iteration follows this pattern:
1. STATE YOUR GOALS — What you will accomplish in this iteration (2-3 sentences)
2. PLAN — Brief plan of steps (plain sentences, not lists)
3. EXECUTE — Write code blocks to run. ONE code block per response. After the closing fence, STOP. You will receive real output.
4. EVALUATE — After all execution steps, write your honest evaluation. Start with "## Evaluation" on its own line.
5. NEXT STEPS — After evaluation, propose what to do next. Start with "## Next Steps" on its own line.

CODE EXECUTION RULES:
- Write EXACTLY ONE fenced code block per response (bash, python, sh, javascript, typescript, or node)
- After the closing fence, STOP IMMEDIATELY. Do not predict output.
- Each block should do ONE thing. Keep it atomic.
- You will see the real output and respond in your next turn.
- NEVER invent or guess command output.

SERVING YOUR PROJECT:
When your project can be accessed via a web server, create a file called serve.json in your project root:
{
  "port": <number 1024-65535>,
  "startCommand": "<command to start the server>",
  "healthCheck": "/<path>",
  "description": "<what this project is>"
}

The system will automatically start your server and make it accessible.

EVALUATION GUIDELINES:
- Be honest about what works and what doesn't
- Note any errors, warnings, or unexpected behavior
- Rate your progress: what percentage of the goal is complete?

NEXT STEPS GUIDELINES:
- Rank proposed steps by priority
- Explain why each step matters
- Be specific about what you'll change

CONSTRAINTS:
- All project files go in your workspace directory (provided below)
- You have full root access to the sandbox
- You can install packages, create files, run servers
- Be efficient — each iteration has a budget`;

export function buildSystemPrompt(buildId: string): string {
  return `${SYSTEM_PROMPT}\n\nYour workspace directory: /home/jkai/workspace/${buildId}`;
}

export function buildIterationContext(
  userPrompt: string,
  previousIteration: JkaiIteration | null,
  fileList: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  // User's original goal
  let contextMessage = `## Project Goal\n${userPrompt}`;

  // Previous iteration context
  if (previousIteration) {
    contextMessage += `\n\n## Previous Iteration (#${previousIteration.number})\n`;
    if (previousIteration.evaluation) {
      contextMessage += `### Evaluation\n${previousIteration.evaluation}\n`;
    }
    if (previousIteration.nextSteps) {
      contextMessage += `### Proposed Next Steps\n${previousIteration.nextSteps}\n`;
    }
  }

  // Current workspace state
  if (fileList.trim()) {
    contextMessage += `\n\n## Current Workspace Files\n\`\`\`\n${fileList}\n\`\`\``;
  } else {
    contextMessage += `\n\n## Current Workspace\nEmpty — this is a fresh project.`;
  }

  contextMessage += `\n\nBegin your next iteration. Start by stating your goals.`;

  messages.push({ role: 'user', content: contextMessage });
  return messages;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/prompt.ts
git commit -m "feat(jkai): add autonomous builder system prompt"
```

---

## Task 5: Sandbox Enhancements

**Files:**
- Modify: `src/lib/jkai/sandbox.ts`
- Delete: `src/lib/jkai/client.ts`
- Delete: `src/lib/jkai/component-detector.ts`

- [ ] **Step 1: Delete old files**

```bash
rm src/lib/jkai/client.ts src/lib/jkai/component-detector.ts
rm src/routes/api/jkai/chat/+server.ts src/routes/api/jkai/conversations/+server.ts src/routes/api/jkai/sandbox/+server.ts
```

- [ ] **Step 2: Rewrite sandbox.ts**

Replace `src/lib/jkai/sandbox.ts` with enhanced version. Read the existing file first, then replace entirely:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const CONTAINER_NAME = 'jkai-sandbox';
const IMAGE_NAME = 'jkai-sandbox:latest';

export interface SandboxStatus {
  running: boolean;
  containerId?: string;
  image?: string;
  uptime?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// --- Container Management ---

export async function getSandboxStatus(): Promise<SandboxStatus> {
  try {
    const { stdout } = await execAsync(
      `docker inspect --format '{{.State.Running}}|{{.Id}}|{{.Config.Image}}|{{.State.StartedAt}}' ${CONTAINER_NAME} 2>/dev/null`,
    );
    const [running, id, image, startedAt] = stdout.trim().split('|');
    if (running === 'true') {
      const started = new Date(startedAt);
      const uptime = formatUptime(Date.now() - started.getTime());
      return { running: true, containerId: id.slice(0, 12), image, uptime };
    }
    return { running: false, containerId: id.slice(0, 12), image };
  } catch {
    return { running: false };
  }
}

export async function ensureSandboxRunning(): Promise<void> {
  const status = await getSandboxStatus();
  if (status.running) return;

  // Check if image exists, build if not
  try {
    await execAsync(`docker image inspect ${IMAGE_NAME} 2>/dev/null`);
  } catch {
    await buildSandboxImage();
  }

  // Remove existing container if stopped
  await execAsync(`docker rm -f ${CONTAINER_NAME} 2>/dev/null`).catch(() => {});

  await execAsync(
    `docker run -d --name ${CONTAINER_NAME} --restart unless-stopped ` +
    `--memory 2g --cpus 2 ` +
    `--network bridge -v jkai-workspace:/home/jkai/workspace ${IMAGE_NAME}`,
  );
}

export async function buildSandboxImage(): Promise<void> {
  const { join } = await import('path');
  const dockerfilePath = join(process.cwd(), 'docker', 'jkai-sandbox');
  await execAsync(`docker build -t ${IMAGE_NAME} ${dockerfilePath}`, { timeout: 300000 });
}

// --- Container IP ---

let cachedContainerIp: string | null = null;

export async function getContainerIp(): Promise<string> {
  if (cachedContainerIp) return cachedContainerIp;
  const { stdout } = await execAsync(
    `docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${CONTAINER_NAME}`,
  );
  cachedContainerIp = stdout.trim();
  return cachedContainerIp;
}

export function clearContainerIpCache(): void {
  cachedContainerIp = null;
}

// --- Code Execution ---

export async function execInSandbox(
  command: string,
  timeout = 120000,
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(
      `docker exec ${CONTAINER_NAME} bash -c ${JSON.stringify(command)}`,
      { timeout, maxBuffer: 5 * 1024 * 1024 },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
    };
  }
}

export async function execBuildCommand(
  command: string,
  workdir: string,
): Promise<ExecResult> {
  return execInSandbox(`cd ${workdir} && ${command}`, 300000); // 5 min timeout
}

// --- Workspace Management ---

export async function ensureWorkspace(buildId: string): Promise<string> {
  const dir = `/home/jkai/workspace/${buildId}`;
  await execInSandbox(`mkdir -p ${dir}`);
  return dir;
}

export async function listWorkspaceFiles(buildId: string): Promise<string> {
  const dir = `/home/jkai/workspace/${buildId}`;
  const result = await execInSandbox(
    `find ${dir} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100 | sed 's|${dir}/||'`,
    10000,
  );
  return result.exitCode === 0 ? result.stdout.trim() : '';
}

// --- Serve Management ---

export async function readServeJson(buildId: string): Promise<any | null> {
  const dir = `/home/jkai/workspace/${buildId}`;
  const result = await execInSandbox(`cat ${dir}/serve.json 2>/dev/null`, 5000);
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

export async function killProjectServer(): Promise<void> {
  await execInSandbox(
    'if [ -f /tmp/jkai-serve.pid ]; then kill $(cat /tmp/jkai-serve.pid) 2>/dev/null; rm -f /tmp/jkai-serve.pid; fi',
    5000,
  ).catch(() => {});
  // Also kill common dev server processes
  await execInSandbox('pkill -f "node.*server" 2>/dev/null; pkill -f "python.*serve" 2>/dev/null', 5000).catch(() => {});
}

export async function startProjectServer(
  buildId: string,
  startCommand: string,
  port: number,
  healthCheck: string,
): Promise<boolean> {
  await killProjectServer();

  const dir = `/home/jkai/workspace/${buildId}`;
  await execInSandbox(
    `cd ${dir} && nohup bash -c '${startCommand.replace(/'/g, "'\\''")}' > /tmp/jkai-serve.log 2>&1 & echo $! > /tmp/jkai-serve.pid`,
    10000,
  );

  // Poll health check
  const maxAttempts = 15; // 30 seconds
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const check = await execInSandbox(
      `curl -sf http://localhost:${port}${healthCheck} > /dev/null 2>&1 && echo OK`,
      5000,
    );
    if (check.stdout.trim() === 'OK') return true;
  }
  return false;
}

// --- Utilities ---

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
```

- [ ] **Step 3: Commit**

```bash
git add -A src/lib/jkai/
git commit -m "feat(jkai): rewrite sandbox with project-scoped exec, serve management, container IP"
```

---

## Task 6: Serve Module (Validation + Proxy Helpers)

**Files:**
- Create: `src/lib/jkai/serve.ts`

- [ ] **Step 1: Create serve module**

Create `src/lib/jkai/serve.ts`:

```typescript
import type { ServeConfig } from './types';
import { getContainerIp, clearContainerIpCache } from './sandbox';

export function validateServeConfig(raw: any): ServeConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const { port, startCommand, healthCheck, description } = raw;

  if (typeof port !== 'number' || port < 1024 || port > 65535) return null;
  if (typeof startCommand !== 'string' || !startCommand.trim()) return null;
  if (typeof healthCheck !== 'string' || !healthCheck.startsWith('/')) return null;

  return {
    port,
    startCommand: startCommand.trim(),
    healthCheck,
    description: typeof description === 'string' ? description : '',
  };
}

export async function proxyToSandbox(
  port: number,
  path: string,
  request: Request,
): Promise<Response> {
  let ip: string;
  try {
    ip = await getContainerIp();
  } catch {
    return new Response('Sandbox not running', { status: 502 });
  }

  const url = `http://${ip}:${port}${path}`;

  try {
    const headers = new Headers(request.headers);
    headers.delete('host');

    const resp = await fetch(url, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      // @ts-ignore - duplex needed for streaming body
      duplex: request.body ? 'half' : undefined,
    });

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
  } catch (err) {
    // If fetch fails, maybe container IP changed
    clearContainerIpCache();
    return new Response(`Proxy error: ${err}`, { status: 502 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/serve.ts
git commit -m "feat(jkai): add serve config validation and reverse proxy helper"
```

---

## Task 7: Orchestrator

**Files:**
- Create: `src/lib/jkai/orchestrator.ts`

This is the core module. It manages the build loop state machine.

- [ ] **Step 1: Create orchestrator module**

Create `src/lib/jkai/orchestrator.ts`:

```typescript
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { checkBudget } from './budget';
import { buildSystemPrompt, buildIterationContext } from './prompt';
import {
  ensureSandboxRunning,
  ensureWorkspace,
  execInSandbox,
  listWorkspaceFiles,
  readServeJson,
  startProjectServer,
} from './sandbox';
import { validateServeConfig } from './serve';
import type { ActionRecord } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';
import { EventEmitter } from 'events';
import OpenAI from 'openai';
import { loadKeys } from '$lib/deepdive/keys';

// --- Event Emitter for SSE ---

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onBuildLog(
  buildId: string,
  handler: (log: { id: number; type: string; content: string; iterationId: string | null }) => void,
): () => void {
  const key = `log:${buildId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

async function emitLog(
  buildId: string,
  type: string,
  content: string,
  iterationId: string | null = null,
): Promise<void> {
  const [log] = await db
    .insert(jkaiLogs)
    .values({ buildId, iterationId, type, content })
    .returning();
  emitter.emit(`log:${buildId}`, {
    id: log.id,
    type: log.type,
    content: log.content,
    iterationId: log.iterationId,
  });
}

// --- LLM Client ---

function getLLMClient(): { client: OpenAI; model: string } {
  const keys = loadKeys();
  if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');
  const client = new OpenAI({
    apiKey: keys.zaiApiKey,
    baseURL: keys.zaiBaseUrl || 'https://api.z.ai/api/coding/paas/v4/',
  });
  const model = keys.zaiModel || 'glm-4-plus';
  return { client, model };
}

// --- Code Block Extraction ---

const FENCE_REGEX = /```(bash|python|sh|javascript|typescript|node)\n([\s\S]*?)```/;

function extractCodeBlock(text: string): { lang: string; code: string } | null {
  const match = text.match(FENCE_REGEX);
  if (!match) return null;
  return { lang: match[1], code: match[2].trimEnd() };
}

function hasEvaluation(text: string): boolean {
  return text.includes('## Evaluation');
}

function extractSection(text: string, header: string): string | null {
  const regex = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

// --- Orchestrator Singleton ---

class Orchestrator {
  private activeBuildId: string | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  async startBuild(buildId: string): Promise<void> {
    if (this.activeBuildId) {
      throw new Error(`Build ${this.activeBuildId} is already active`);
    }

    this.activeBuildId = buildId;
    this.stopped = false;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build started');

    // Ensure sandbox is running
    await ensureSandboxRunning();
    await ensureWorkspace(buildId);

    this.scheduleNext(buildId);
  }

  async pauseBuild(buildId: string): Promise<void> {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.activeBuildId = null;

    await db
      .update(jkaiBuilds)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build paused');
  }

  async resumeBuild(buildId: string): Promise<void> {
    if (this.activeBuildId) {
      throw new Error(`Build ${this.activeBuildId} is already active`);
    }

    this.activeBuildId = buildId;
    this.stopped = false;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build resumed');
    this.scheduleNext(buildId);
  }

  async stopBuild(buildId: string): Promise<void> {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.activeBuildId = null;

    await db
      .update(jkaiBuilds)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build stopped by user');
  }

  getActiveBuildId(): string | null {
    return this.activeBuildId;
  }

  async recoverOnStartup(): Promise<void> {
    const [runningBuild] = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.status, 'running'))
      .limit(1);

    if (!runningBuild) return;

    // Mark any running iterations as failed
    await db
      .update(jkaiIterations)
      .set({ status: 'failed' })
      .where(
        and(
          eq(jkaiIterations.buildId, runningBuild.id),
          eq(jkaiIterations.status, 'running'),
        ),
      );

    await emitLog(runningBuild.id, 'system', 'Recovered after restart — resuming build');
    this.activeBuildId = runningBuild.id;
    this.stopped = false;
    this.scheduleNext(runningBuild.id);
  }

  // --- Private: Loop ---

  private scheduleNext(buildId: string, delayMs = 0): void {
    this.loopTimer = setTimeout(() => this.runIteration(buildId), delayMs);
  }

  private async runIteration(buildId: string): Promise<void> {
    if (this.stopped || this.activeBuildId !== buildId) return;

    try {
      // Fetch latest build state
      const [build] = await db
        .select()
        .from(jkaiBuilds)
        .where(eq(jkaiBuilds.id, buildId));

      if (!build || build.status !== 'running') return;

      // Budget check
      const budget = await checkBudget(build);
      if (!budget.canProceed) {
        if (budget.shouldComplete) {
          await db
            .update(jkaiBuilds)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, buildId));
          await emitLog(buildId, 'system', `Build completed: ${budget.reason}`);
          this.activeBuildId = null;
          return;
        }
        // Cooldown
        await emitLog(buildId, 'system', `Cooling down: ${budget.reason}`);
        this.scheduleNext(buildId, budget.sleepMs || 60000);
        return;
      }

      // Get previous iteration
      const [prevIteration] = await db
        .select()
        .from(jkaiIterations)
        .where(
          and(
            eq(jkaiIterations.buildId, buildId),
            eq(jkaiIterations.status, 'completed'),
          ),
        )
        .orderBy(desc(jkaiIterations.number))
        .limit(1);

      const iterationNumber = (prevIteration?.number || 0) + 1;

      // Create iteration record
      const [iteration] = await db
        .insert(jkaiIterations)
        .values({
          buildId,
          number: iterationNumber,
          status: 'running',
        })
        .returning();

      await emitLog(buildId, 'system', `Starting iteration #${iterationNumber}`, iteration.id);

      const startTime = Date.now();

      // Run the multi-turn LLM loop for this iteration
      const result = await this.executeIteration(build, iteration, prevIteration);

      const durationMs = Date.now() - startTime;

      // Update iteration
      await db
        .update(jkaiIterations)
        .set({
          status: 'completed',
          goals: result.goals,
          plan: result.plan,
          actions: result.actions,
          messages: result.messages,
          evaluation: result.evaluation,
          nextSteps: result.nextSteps,
          tokensUsed: result.tokensUsed,
          durationMs,
        })
        .where(eq(jkaiIterations.id, iteration.id));

      // Update build counters
      await db
        .update(jkaiBuilds)
        .set({
          iterationsCompleted: build.iterationsCompleted + 1,
          tokensUsed: build.tokensUsed + result.tokensUsed,
          activeMinutesUsed: build.activeMinutesUsed + durationMs / 60000,
          updatedAt: new Date(),
        })
        .where(eq(jkaiBuilds.id, buildId));

      // Check for serve.json
      await this.checkServeConfig(buildId);

      await emitLog(buildId, 'system', `Iteration #${iterationNumber} completed (${(durationMs / 1000).toFixed(0)}s)`, iteration.id);

      // Schedule next
      this.scheduleNext(buildId, 1000);
    } catch (err: any) {
      await emitLog(buildId, 'error', `Iteration error: ${err.message}`);
      // Don't stop on error — try again after a delay
      this.scheduleNext(buildId, 30000);
    }
  }

  private async executeIteration(
    build: JkaiBuild,
    iteration: JkaiIteration,
    prevIteration: JkaiIteration | null,
  ): Promise<{
    goals: string | null;
    plan: string | null;
    actions: ActionRecord[];
    messages: Array<{ role: string; content: string }>;
    evaluation: string | null;
    nextSteps: string | null;
    tokensUsed: number;
  }> {
    const { client, model } = getLLMClient();
    const systemPrompt = buildSystemPrompt(build.id);
    const fileList = await listWorkspaceFiles(build.id);
    const contextMessages = buildIterationContext(build.prompt, prevIteration, fileList);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...contextMessages,
    ];

    const actions: ActionRecord[] = [];
    let goals: string | null = null;
    let plan: string | null = null;
    let evaluation: string | null = null;
    let nextSteps: string | null = null;
    let totalTokens = 0;
    const maxTurns = 20; // Safety limit

    for (let turn = 0; turn < maxTurns; turn++) {
      if (this.stopped) break;

      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      });

      const assistantContent = response.choices[0]?.message?.content || '';
      totalTokens += response.usage?.total_tokens || 0;

      messages.push({ role: 'assistant', content: assistantContent });

      // Persist messages incrementally
      await db
        .update(jkaiIterations)
        .set({ messages: messages.filter((m) => m.role !== 'system') })
        .where(eq(jkaiIterations.id, iteration.id));

      // Extract goals and plan from first response
      if (turn === 0) {
        goals = assistantContent.split('\n').slice(0, 5).join('\n');
        // The first response typically contains both goals and plan before any code
        const codeStart = assistantContent.indexOf('```');
        plan = codeStart > 0 ? assistantContent.slice(0, codeStart).trim() : assistantContent;
      }

      // Check for evaluation (signals iteration complete)
      if (hasEvaluation(assistantContent)) {
        evaluation = extractSection(assistantContent, 'Evaluation');
        nextSteps = extractSection(assistantContent, 'Next Steps');

        // Emit the evaluation text
        const textBeforeEval = assistantContent.split('## Evaluation')[0].trim();
        if (textBeforeEval) {
          await emitLog(build.id, 'text', textBeforeEval, iteration.id);
        }
        await emitLog(build.id, 'text', `## Evaluation\n${evaluation || ''}`, iteration.id);
        if (nextSteps) {
          await emitLog(build.id, 'text', `## Next Steps\n${nextSteps}`, iteration.id);
        }
        break;
      }

      // Check for code block
      const codeBlock = extractCodeBlock(assistantContent);
      if (codeBlock) {
        // Emit text before code block
        const textBefore = assistantContent.split('```')[0].trim();
        if (textBefore) {
          await emitLog(build.id, 'text', textBefore, iteration.id);
        }

        await emitLog(build.id, 'code', `\`\`\`${codeBlock.lang}\n${codeBlock.code}\n\`\`\``, iteration.id);

        // Execute — wrap code appropriately for its language
        const workdir = `/home/jkai/workspace/${build.id}`;
        let execCmd: string;
        if (['python'].includes(codeBlock.lang)) {
          execCmd = `cd ${workdir} && python3 -c ${JSON.stringify(codeBlock.code)}`;
        } else if (['javascript', 'typescript', 'node'].includes(codeBlock.lang)) {
          execCmd = `cd ${workdir} && node -e ${JSON.stringify(codeBlock.code)}`;
        } else {
          execCmd = `cd ${workdir} && ${codeBlock.code}`;
        }
        const execResult = await execInSandbox(
          execCmd,
          codeBlock.code.includes('install') ? 300000 : 120000,
        );

        const action: ActionRecord = {
          lang: codeBlock.lang,
          code: codeBlock.code,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          exitCode: execResult.exitCode,
        };
        actions.push(action);

        // Emit output
        const outputStr = [
          execResult.stdout ? `stdout:\n${execResult.stdout}` : '',
          execResult.stderr ? `stderr:\n${execResult.stderr}` : '',
          `exit code: ${execResult.exitCode}`,
        ]
          .filter(Boolean)
          .join('\n');
        await emitLog(build.id, 'output', outputStr, iteration.id);

        // Feed output back to LLM
        messages.push({
          role: 'user',
          content: `Command output (exit code ${execResult.exitCode}):\n${execResult.stdout}\n${execResult.stderr ? `stderr: ${execResult.stderr}` : ''}`,
        });
      } else {
        // Plain text response (no code) — emit and continue
        await emitLog(build.id, 'text', assistantContent, iteration.id);

        // Prompt LLM to continue
        messages.push({
          role: 'user',
          content: 'Continue with your next step.',
        });
      }
    }

    return { goals, plan, actions, messages: messages.filter((m) => m.role !== 'system'), evaluation, nextSteps, tokensUsed: totalTokens };
  }

  private async checkServeConfig(buildId: string): Promise<void> {
    const raw = await readServeJson(buildId);
    if (!raw) return;

    const config = validateServeConfig(raw);
    if (!config) {
      await emitLog(buildId, 'system', 'Found serve.json but it failed validation');
      return;
    }

    // Get current build to check if config changed
    const [build] = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.id, buildId));

    const currentConfig = build?.serveConfig as any;
    if (
      currentConfig?.port === config.port &&
      currentConfig?.startCommand === config.startCommand
    ) {
      return; // No change
    }

    await emitLog(buildId, 'system', `Starting project server on port ${config.port}: ${config.startCommand}`);

    const healthy = await startProjectServer(
      buildId,
      config.startCommand,
      config.port,
      config.healthCheck,
    );

    if (healthy) {
      await db
        .update(jkaiBuilds)
        .set({ serveConfig: config, updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
      await emitLog(buildId, 'system', `Project server healthy at port ${config.port}`);
    } else {
      await emitLog(buildId, 'error', `Project server failed health check on port ${config.port}`);
    }
  }
}

export const orchestrator = new Orchestrator();
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/jkai/orchestrator.ts
git commit -m "feat(jkai): add orchestrator state machine with multi-turn LLM loop"
```

---

## Task 8: API Routes

**Files:**
- Create: `src/routes/api/jkai/builds/+server.ts`
- Create: `src/routes/api/jkai/builds/[id]/+server.ts`
- Create: `src/routes/api/jkai/builds/[id]/pause/+server.ts`
- Create: `src/routes/api/jkai/builds/[id]/resume/+server.ts`
- Create: `src/routes/api/jkai/builds/[id]/stop/+server.ts`
- Create: `src/routes/api/jkai/builds/[id]/budget/+server.ts`
- Create: `src/routes/api/jkai/builds/[id]/stream/+server.ts`
- Create: `src/routes/api/jkai/proxy/[id]/[...path]/+server.ts`

- [ ] **Step 1: Create auth helper**

Create `src/routes/api/jkai/auth.ts` (shared auth for all JKAI API routes — uses SvelteKit cookies for consistency with existing codebase):

```typescript
import { validateSession } from '$lib/auth';
import type { Cookies } from '@sveltejs/kit';

export function authorize(cookies: Cookies, url: URL): boolean {
  const session = cookies.get('admin_session');
  const token = url.searchParams.get('token');
  return validateSession(session) || validateSession(token ?? undefined);
}
```

**Note:** All API route handlers destructure `cookies` from the SvelteKit event and pass it to `authorize(cookies, url)`.

- [ ] **Step 2: Create builds list/create endpoint**

Create `src/routes/api/jkai/builds/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { orchestrator } from '$lib/jkai/orchestrator';
import { authorize } from '../auth';

export const GET: RequestHandler = async ({ cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  const builds = await db
    .select()
    .from(jkaiBuilds)
    .orderBy(desc(jkaiBuilds.createdAt));

  return json(builds);
};

export const POST: RequestHandler = async ({ cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { prompt, title, budgetConfig } = body;

  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }

  const [build] = await db
    .insert(jkaiBuilds)
    .values({
      title: title || null,
      prompt,
      budgetConfig: budgetConfig || {},
    })
    .returning();

  // Start the build
  await orchestrator.startBuild(build.id);

  return json(build, { status: 201 });
};
```

- [ ] **Step 3: Create build detail endpoint**

Create `src/routes/api/jkai/builds/[id]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { authorize } from '../../auth';

export const GET: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  const [build] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, params.id));

  if (!build) return json({ error: 'Not found' }, { status: 404 });

  const iterations = await db
    .select()
    .from(jkaiIterations)
    .where(eq(jkaiIterations.buildId, params.id))
    .orderBy(asc(jkaiIterations.number));

  return json({ ...build, iterations });
};
```

- [ ] **Step 4: Create pause/resume/stop endpoints**

Create `src/routes/api/jkai/builds/[id]/pause/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { orchestrator } from '$lib/jkai/orchestrator';
import { authorize } from '../../../auth';

export const POST: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await orchestrator.pauseBuild(params.id);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
```

Create `src/routes/api/jkai/builds/[id]/resume/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { orchestrator } from '$lib/jkai/orchestrator';
import { authorize } from '../../../auth';

export const POST: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await orchestrator.resumeBuild(params.id);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
```

Create `src/routes/api/jkai/builds/[id]/stop/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { orchestrator } from '$lib/jkai/orchestrator';
import { authorize } from '../../../auth';

export const POST: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await orchestrator.stopBuild(params.id);
    return json({ ok: true });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
```

- [ ] **Step 5: Create budget update endpoint**

Create `src/routes/api/jkai/builds/[id]/budget/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { authorize } from '../../../auth';

export const PATCH: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();

  const [build] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, params.id));

  if (!build) return json({ error: 'Not found' }, { status: 404 });

  const currentConfig = (build.budgetConfig || {}) as Record<string, any>;
  const newConfig = { ...currentConfig, ...body };

  await db
    .update(jkaiBuilds)
    .set({ budgetConfig: newConfig, updatedAt: new Date() })
    .where(eq(jkaiBuilds.id, params.id));

  return json({ ok: true, budgetConfig: newConfig });
};
```

- [ ] **Step 6: Create SSE stream endpoint**

Create `src/routes/api/jkai/builds/[id]/stream/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiLogs } from '$lib/db/schema';
import { eq, gt, and, asc } from 'drizzle-orm';
import { onBuildLog } from '$lib/jkai/orchestrator';
import { authorize } from '../../../auth';

export const GET: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url))
    return new Response('Unauthorized', { status: 401 });

  const buildId = params.id;
  const lastEventId = request.headers.get('Last-Event-ID');

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(id: number, data: any) {
        try {
          controller.enqueue(
            encoder.encode(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Stream closed
        }
      }

      // Replay missed events
      if (lastEventId) {
        const missed = await db
          .select()
          .from(jkaiLogs)
          .where(
            and(
              eq(jkaiLogs.buildId, buildId),
              gt(jkaiLogs.id, parseInt(lastEventId, 10)),
            ),
          )
          .orderBy(asc(jkaiLogs.id));

        for (const log of missed) {
          send(log.id, { type: log.type, content: log.content, iterationId: log.iterationId });
        }
      }

      // Live events
      const unsub = onBuildLog(buildId, (log) => {
        send(log.id, { type: log.type, content: log.content, iterationId: log.iterationId });
      });

      // Keepalive
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
          unsub();
        }
      }, 15000);

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        unsub();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
```

- [ ] **Step 7: Create reverse proxy endpoint**

Create `src/routes/api/jkai/proxy/[id]/[...path]/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { proxyToSandbox } from '$lib/jkai/serve';
import { authorize } from '../../../../auth';

const handler: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url)) return new Response('Unauthorized', { status: 401 });

  const [build] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, params.id));

  if (!build?.serveConfig) {
    return new Response('Project not serving', { status: 404 });
  }

  const config = build.serveConfig as { port: number };
  const path = '/' + (params.path || '');

  return proxyToSandbox(config.port, path, request);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
```

- [ ] **Step 8: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/jkai/
git commit -m "feat(jkai): add API routes for builds CRUD, SSE stream, and reverse proxy"
```

---

## Task 9: UI — Dashboard Page

**Files:**
- Delete: `src/routes/jkai/+page.svelte` (old chat UI)
- Delete: `src/routes/jkai/admin/+page.svelte`
- Create: `src/routes/jkai/+page.svelte` (new dashboard)
- Create: `src/routes/jkai/+page.server.ts`

- [ ] **Step 1: Delete old files**

```bash
rm src/routes/jkai/admin/+page.svelte
rmdir src/routes/jkai/admin
```

- [ ] **Step 2: Create page server**

Create `src/routes/jkai/+page.server.ts`:

```typescript
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const builds = await db
    .select()
    .from(jkaiBuilds)
    .orderBy(desc(jkaiBuilds.createdAt));

  return { builds };
};
```

- [ ] **Step 3: Create dashboard page**

Replace `src/routes/jkai/+page.svelte`:

```svelte
<script lang="ts">
  import type { PageData } from './$types';

  let { data } = $props();

  const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    running: { bg: 'rgba(45, 125, 70, 0.12)', text: '#2d7d46' },
    paused: { bg: 'rgba(200, 150, 50, 0.12)', text: '#b8860b' },
    completed: { bg: 'rgba(100, 100, 100, 0.12)', text: '#666' },
    failed: { bg: 'rgba(180, 50, 50, 0.12)', text: '#b43232' },
    pending: { bg: 'rgba(100, 100, 200, 0.12)', text: '#6464c8' },
  };

  function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function budgetSummary(config: any): string {
    const parts: string[] = [];
    if (config?.activeMinutesPerHour) parts.push(`${config.activeMinutesPerHour}m/hr`);
    if (config?.maxIterations) parts.push(`${config.maxIterations} iters`);
    if (config?.maxTotalMinutes) parts.push(`${config.maxTotalMinutes}m total`);
    return parts.join(' · ') || 'No limits';
  }
</script>

<svelte:head>
  <title>Autonomous Builds — JKAI</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <div>
      <h1 class="display text-[32px] sm:text-[40px]" style="color: var(--text-primary);">
        BUILDS
      </h1>
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        Autonomous AI development projects
      </p>
    </div>
    <a
      href="/jkai/new"
      class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      style="background: var(--accent); color: white;"
    >
      New Build
    </a>
  </div>

  {#if data.builds.length === 0}
    <div
      class="text-center py-16 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p class="text-lg mb-2" style="color: var(--text-secondary);">No builds yet</p>
      <p class="text-sm" style="color: var(--text-ghost);">
        Create your first autonomous build to get started.
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each data.builds as build}
        {@const colors = STATUS_COLORS[build.status] || STATUS_COLORS.pending}
        <a
          href="/jkai/{build.id}"
          class="group block p-5 rounded-xl border transition-colors"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-start justify-between mb-3">
            <span
              class="text-[10px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
              style="font-family: var(--font-mono); background: {colors.bg}; color: {colors.text};"
            >
              {build.status}
              {#if build.status === 'running'}
                <span class="inline-block w-1.5 h-1.5 rounded-full ml-1 animate-pulse" style="background: {colors.text};"></span>
              {/if}
            </span>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {formatDate(build.createdAt)}
            </span>
          </div>

          <h2
            class="text-base font-medium mb-2 group-hover:text-[var(--accent)] transition-colors line-clamp-1"
            style="color: var(--text-primary);"
          >
            {build.title || build.prompt.slice(0, 60)}
          </h2>

          <p class="text-sm mb-3 line-clamp-2" style="color: var(--text-secondary);">
            {build.prompt}
          </p>

          <div class="flex items-center gap-4 text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
            <span>{build.iterationsCompleted} iterations</span>
            <span>{budgetSummary(build.budgetConfig)}</span>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Update layout**

Replace `src/routes/jkai/+layout.svelte`:

```svelte
<script lang="ts">
  let { children } = $props();
</script>

<div class="jkai-root">
  {@render children()}
</div>

<style>
  .jkai-root {
    min-height: 100vh;
    background: var(--bg, #ede4d4);
    color: var(--text-primary, #1a1008);
    font-family: var(--font-body);
  }
</style>
```

- [ ] **Step 5: Commit**

```bash
git add -A src/routes/jkai/
git commit -m "feat(jkai): add builds dashboard UI"
```

---

## Task 10: UI — New Build Page

**Files:**
- Create: `src/routes/jkai/new/+page.svelte`

- [ ] **Step 1: Create new build form**

Create `src/routes/jkai/new/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';

  let prompt = $state('');
  let activeMinutesPerHour = $state(15);
  let maxTokensPerHour = $state<number | null>(null);
  let maxIterations = $state<number | null>(null);
  let maxTotalMinutes = $state<number | null>(null);
  let submitting = $state(false);
  let error = $state('');

  async function submit() {
    if (!prompt.trim()) return;
    submitting = true;
    error = '';

    const budgetConfig: Record<string, number> = {};
    if (activeMinutesPerHour) budgetConfig.activeMinutesPerHour = activeMinutesPerHour;
    if (maxTokensPerHour) budgetConfig.maxTokensPerHour = maxTokensPerHour;
    if (maxIterations) budgetConfig.maxIterations = maxIterations;
    if (maxTotalMinutes) budgetConfig.maxTotalMinutes = maxTotalMinutes;

    try {
      const res = await fetch('/api/jkai/builds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), budgetConfig }),
      });

      if (!res.ok) {
        const data = await res.json();
        error = data.error || 'Failed to create build';
        return;
      }

      const build = await res.json();
      goto(`/jkai/${build.id}`);
    } catch (err: any) {
      error = err.message;
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>New Build — JKAI</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-2xl mx-auto">
  <a href="/jkai" class="text-sm mb-6 inline-block" style="color: var(--text-ghost);">
    &larr; Back to builds
  </a>

  <h1 class="display text-[28px] sm:text-[36px] mb-6" style="color: var(--text-primary);">
    NEW BUILD
  </h1>

  <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
    <!-- Prompt -->
    <div class="mb-6">
      <label for="prompt" class="block text-sm font-medium mb-2" style="color: var(--text-secondary);">
        Development Objective
      </label>
      <textarea
        id="prompt"
        bind:value={prompt}
        rows={5}
        placeholder="Describe what you want to build..."
        class="w-full rounded-lg border p-3 text-sm resize-y"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
      ></textarea>
    </div>

    <!-- Budget Controls -->
    <div class="mb-6 p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
      <h2 class="text-sm font-medium mb-4" style="color: var(--text-secondary);">Budget</h2>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">
            Active minutes per hour
          </label>
          <input
            type="range"
            min="1"
            max="60"
            bind:value={activeMinutesPerHour}
            class="w-full"
          />
          <span class="text-xs" style="color: var(--text-ghost); font-family: var(--font-mono);">{activeMinutesPerHour}m</span>
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">
            Max tokens per hour
          </label>
          <input
            type="number"
            bind:value={maxTokensPerHour}
            placeholder="Unlimited"
            class="w-full rounded border px-2 py-1 text-sm"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);"
          />
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">
            Max iterations
          </label>
          <input
            type="number"
            bind:value={maxIterations}
            placeholder="Unlimited"
            class="w-full rounded border px-2 py-1 text-sm"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);"
          />
        </div>

        <div>
          <label class="block text-xs mb-1" style="color: var(--text-ghost);">
            Total time cap (minutes)
          </label>
          <input
            type="number"
            bind:value={maxTotalMinutes}
            placeholder="Unlimited"
            class="w-full rounded border px-2 py-1 text-sm"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary);"
          />
        </div>
      </div>
    </div>

    {#if error}
      <p class="text-sm mb-4" style="color: #b43232;">{error}</p>
    {/if}

    <button
      type="submit"
      disabled={!prompt.trim() || submitting}
      class="px-6 py-2.5 rounded-lg text-sm font-medium transition-opacity disabled:opacity-50"
      style="background: var(--accent); color: white;"
    >
      {submitting ? 'Starting...' : 'Start Build'}
    </button>
  </form>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/jkai/new/
git commit -m "feat(jkai): add new build creation form"
```

---

## Task 11: UI — Build Detail Page

**Files:**
- Create: `src/routes/jkai/[id]/+page.server.ts`
- Create: `src/routes/jkai/[id]/+page.svelte`

- [ ] **Step 1: Create page server**

Create `src/routes/jkai/[id]/+page.server.ts`:

```typescript
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const [build] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, params.id));

  if (!build) throw error(404, 'Build not found');

  const iterations = await db
    .select()
    .from(jkaiIterations)
    .where(eq(jkaiIterations.buildId, params.id))
    .orderBy(asc(jkaiIterations.number));

  const logs = await db
    .select()
    .from(jkaiLogs)
    .where(eq(jkaiLogs.buildId, params.id))
    .orderBy(desc(jkaiLogs.id))
    .limit(200);

  return { build, iterations, logs: logs.reverse() };
};
```

- [ ] **Step 2: Create build detail page**

Create `src/routes/jkai/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';

  let { data } = $props();
  let activeTab = $state<'activity' | 'iterations' | 'preview' | 'controls'>('activity');
  let logs = $state(data.logs);
  let build = $state(data.build);
  let eventSource: EventSource | null = null;
  let logContainer: HTMLDivElement;

  onMount(() => {
    if (build.status === 'running') {
      connectSSE();
    }
  });

  onDestroy(() => {
    eventSource?.close();
  });

  function connectSSE() {
    const lastId = logs.length > 0 ? logs[logs.length - 1].id : 0;
    eventSource = new EventSource(`/api/jkai/builds/${build.id}/stream`);

    eventSource.onmessage = (e) => {
      const log = JSON.parse(e.data);
      logs = [...logs, { ...log, id: parseInt(e.lastEventId) }];
      // Auto-scroll
      requestAnimationFrame(() => {
        logContainer?.scrollTo({ top: logContainer.scrollHeight, behavior: 'smooth' });
      });
    };

    eventSource.onerror = () => {
      eventSource?.close();
      setTimeout(connectSSE, 3000);
    };
  }

  async function controlAction(action: 'pause' | 'resume' | 'stop') {
    const res = await fetch(`/api/jkai/builds/${build.id}/${action}`, { method: 'POST' });
    if (res.ok) {
      const statusMap = { pause: 'paused', resume: 'running', stop: 'completed' } as const;
      build = { ...build, status: statusMap[action] };

      if (action === 'resume') connectSSE();
      if (action === 'pause' || action === 'stop') eventSource?.close();
    }
  }

  function logTypeColor(type: string): string {
    const colors: Record<string, string> = {
      system: 'var(--text-ghost)',
      text: 'var(--text-primary)',
      code: '#6a9955',
      output: '#569cd6',
      error: '#f44747',
      thinking: 'var(--text-ghost)',
    };
    return colors[type] || 'var(--text-primary)';
  }

  function budgetPercent(used: number, config: any, key: string): number | null {
    const max = config?.[key];
    if (!max) return null;
    return Math.min(100, (used / max) * 100);
  }
</script>

<svelte:head>
  <title>{build.title || 'Build'} — JKAI</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <!-- Header -->
  <div class="mb-6">
    <a href="/jkai" class="text-sm mb-3 inline-block" style="color: var(--text-ghost);">&larr; Builds</a>
    <div class="flex items-start justify-between">
      <div>
        <h1 class="display text-[24px] sm:text-[32px]" style="color: var(--text-primary);">
          {build.title || build.prompt.slice(0, 60)}
        </h1>
        <p class="text-sm mt-1 max-w-xl" style="color: var(--text-secondary);">{build.prompt}</p>
      </div>
      <span
        class="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded shrink-0"
        style="font-family: var(--font-mono); background: rgba(100,100,100,0.1); color: var(--text-ghost);"
      >
        {build.status}
        {#if build.status === 'running'}
          <span class="inline-block w-1.5 h-1.5 rounded-full ml-1 animate-pulse" style="background: #2d7d46;"></span>
        {/if}
      </span>
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex gap-1 mb-4 border-b" style="border-color: var(--card-border);">
    {#each ['activity', 'iterations', 'preview', 'controls'] as tab}
      <button
        onclick={() => activeTab = tab as any}
        class="px-4 py-2 text-sm capitalize transition-colors"
        style="color: {activeTab === tab ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === tab ? 'var(--accent)' : 'transparent'};"
      >
        {tab}
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  {#if activeTab === 'activity'}
    <div
      bind:this={logContainer}
      class="rounded-lg border p-4 overflow-y-auto"
      style="background: var(--card-bg); border-color: var(--card-border); max-height: 70vh; font-family: var(--font-mono); font-size: 12px; line-height: 1.6;"
    >
      {#if logs.length === 0}
        <p style="color: var(--text-ghost);">No activity yet...</p>
      {:else}
        {#each logs as log}
          <div class="mb-1" style="color: {logTypeColor(log.type)};">
            {#if log.type === 'code'}
              <pre class="whitespace-pre-wrap bg-black/5 p-2 rounded my-1">{log.content}</pre>
            {:else if log.type === 'output'}
              <pre class="whitespace-pre-wrap bg-blue-500/5 p-2 rounded my-1">{log.content}</pre>
            {:else if log.type === 'error'}
              <pre class="whitespace-pre-wrap bg-red-500/5 p-2 rounded my-1">{log.content}</pre>
            {:else}
              <p class="whitespace-pre-wrap">{log.content}</p>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

  {:else if activeTab === 'iterations'}
    <div class="space-y-3">
      {#if data.iterations.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No iterations completed yet.</p>
      {/if}
      {#each data.iterations as iter}
        <details class="rounded-lg border p-4" style="background: var(--card-bg); border-color: var(--card-border);">
          <summary class="cursor-pointer flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--text-primary);">
              Iteration #{iter.number}
              <span class="text-[10px] uppercase ml-2 px-1.5 py-0.5 rounded"
                style="font-family: var(--font-mono); background: rgba(100,100,100,0.1); color: var(--text-ghost);">
                {iter.status}
              </span>
            </span>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {iter.durationMs ? `${(iter.durationMs / 1000).toFixed(0)}s` : '...'} · {iter.tokensUsed} tokens
            </span>
          </summary>

          <div class="mt-3 space-y-3 text-sm" style="color: var(--text-secondary);">
            {#if iter.goals}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Goals</h4>
                <p class="whitespace-pre-wrap">{iter.goals}</p>
              </div>
            {/if}
            {#if iter.evaluation}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Evaluation</h4>
                <p class="whitespace-pre-wrap">{iter.evaluation}</p>
              </div>
            {/if}
            {#if iter.nextSteps}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Next Steps</h4>
                <p class="whitespace-pre-wrap">{iter.nextSteps}</p>
              </div>
            {/if}
            {#if Array.isArray(iter.actions) && iter.actions.length > 0}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Actions ({iter.actions.length})</h4>
                {#each iter.actions as action}
                  <pre class="whitespace-pre-wrap bg-black/5 p-2 rounded my-1 text-xs" style="font-family: var(--font-mono);">{action.code}</pre>
                {/each}
              </div>
            {/if}
          </div>
        </details>
      {/each}
    </div>

  {:else if activeTab === 'preview'}
    {#if build.serveConfig}
      <iframe
        src="/api/jkai/proxy/{build.id}/"
        class="w-full rounded-lg border"
        style="height: 70vh; border-color: var(--card-border);"
        title="Project preview"
      ></iframe>
    {:else}
      <div class="text-center py-16 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <p class="text-sm" style="color: var(--text-ghost);">
          Project is not serving yet. The build will create a serve.json when it's ready.
        </p>
      </div>
    {/if}

  {:else if activeTab === 'controls'}
    <div class="space-y-6 max-w-md">
      <!-- Actions -->
      <div class="p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h3 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Actions</h3>
        <div class="flex gap-2">
          {#if build.status === 'running'}
            <button onclick={() => controlAction('pause')} class="px-3 py-1.5 rounded text-sm border" style="border-color: var(--card-border);">Pause</button>
            <button onclick={() => controlAction('stop')} class="px-3 py-1.5 rounded text-sm border" style="border-color: #b43232; color: #b43232;">Stop</button>
          {:else if build.status === 'paused'}
            <button onclick={() => controlAction('resume')} class="px-3 py-1.5 rounded text-sm" style="background: var(--accent); color: white;">Resume</button>
            <button onclick={() => controlAction('stop')} class="px-3 py-1.5 rounded text-sm border" style="border-color: #b43232; color: #b43232;">Stop</button>
          {:else}
            <p class="text-sm" style="color: var(--text-ghost);">Build is {build.status}.</p>
          {/if}
        </div>
      </div>

      <!-- Budget Summary -->
      <div class="p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h3 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Budget Usage</h3>
        <div class="space-y-2 text-sm" style="font-family: var(--font-mono);">
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Iterations</span>
            <span>{build.iterationsCompleted}{build.budgetConfig?.maxIterations ? ` / ${build.budgetConfig.maxIterations}` : ''}</span>
          </div>
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Active time</span>
            <span>{build.activeMinutesUsed.toFixed(1)}m{build.budgetConfig?.maxTotalMinutes ? ` / ${build.budgetConfig.maxTotalMinutes}m` : ''}</span>
          </div>
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Tokens</span>
            <span>{build.tokensUsed.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/jkai/[id]/
git commit -m "feat(jkai): add build detail page with activity, iterations, preview, controls"
```

---

## Task 12: Startup Recovery Hook

**Files:**
- Modify: `src/hooks.server.ts` (existing file — must merge, not replace)

- [ ] **Step 1: Update hooks.server.ts**

The existing file contains the health scheduler. Add the orchestrator recovery import and call. The final file should be:

```typescript
import { startScheduler } from '$lib/health/scheduler';
import { orchestrator } from '$lib/jkai/orchestrator';

// Start the health data sync scheduler
startScheduler();

// Recover any in-progress builds on server startup
orchestrator.recoverOnStartup().catch((err) => {
  console.error('[jkai] Failed to recover build on startup:', err);
});

export const handle = async ({ event, resolve }) => {
  return resolve(event);
};
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks.server.ts
git commit -m "feat(jkai): add startup recovery for interrupted builds"
```

---

## Task 13: Smoke Test

- [ ] **Step 1: Verify build compiles**

```bash
cd ~/strange_rambling_svelte && npm run build
```

Expected: No type errors, build succeeds.

- [ ] **Step 2: Fix any type/import errors**

Address any issues found during build.

- [ ] **Step 3: Push schema to database**

```bash
cd ~/strange_rambling_svelte && npx drizzle-kit push
```

- [ ] **Step 4: Start dev server and verify routes load**

```bash
cd ~/strange_rambling_svelte && npm run dev
```

Visit:
- `http://homeserv:5173/jkai` — should show empty dashboard
- `http://homeserv:5173/jkai/new` — should show create form

- [ ] **Step 5: Commit any fixes**

```bash
git add -A && git commit -m "fix(jkai): address build issues from smoke test"
```

---

## Task 14: End-to-End Test

- [ ] **Step 1: Create a test build via the UI**

Go to `/jkai/new`, enter a simple prompt like "Create a simple HTML page that says Hello World", set max iterations to 3, start the build.

- [ ] **Step 2: Verify the build runs**

Watch the activity tab — should see LLM planning, code execution, output.

- [ ] **Step 3: Fix any runtime issues**

Debug and fix any issues found during the live test.

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "feat(jkai): autonomous build system complete"
```
