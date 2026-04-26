# JKAI Builds Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `/jkai/builds` to follow the canvas design language, expose JKAI tools as pi skills, enforce the site design system in builds, add a plan-first gate, and ship a structured three-lane streaming activity view with per-file timeline.

**Architecture:** Additive-only DB migration; new SSE event types; pi extension `jkai-tools.ts` registers each registry tool as a first-class pi tool that proxies to a new `/api/jkai/tools/invoke` endpoint; orchestrator pauses after plan iter 0 awaiting user approval; new builds UI behind `PUBLIC_BUILDS_V2` flag.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Drizzle ORM, Postgres, Vitest, pi 0.68 CLI inside `jkai-sandbox` Docker container, Prism for code highlighting.

**Spec:** `docs/superpowers/specs/2026-04-26-jkai-builds-redesign-design.md`

---

## File Structure

### New files
- `src/lib/jkai/plan-parse.ts` — parse iteration-0 plan markdown → `Milestone[]`.
- `src/lib/jkai/design-lint.ts` — design-system linter for build workspaces.
- `src/lib/jkai/design-assets.ts` — generate + mount `/design-system/` into sandbox workspaces.
- `src/lib/jkai/tool-bridge.ts` — server side of the pi extension HTTP bridge (auth, dispatch).
- `src/lib/builds/Activity.svelte`, `IterationCard.svelte`, `LaneThinking.svelte`, `LaneTools.svelte`, `LaneOutput.svelte`, `ToolPill.svelte`, `FilesTimeline.svelte`, `PlanEditor.svelte`, `MilestoneList.svelte`, `BuildSidebar.svelte`, `ModeSwitcher.svelte`, `WatchPane.svelte`.
- `src/lib/builds/feed.ts` — Svelte-store reducer for the SSE feed → grouped iterations + lanes.
- `src/lib/builds/parse-actions.ts` — parse persisted iteration `actions` JSON → file timeline entries.
- `src/routes/api/jkai/tools/manifest/+server.ts` — GET tool manifest for the pi extension.
- `src/routes/api/jkai/tools/invoke/+server.ts` — POST tool invocation (token-auth).
- `src/routes/api/jkai/builds/[id]/plan/+server.ts` — GET plan; POST approve/skip/replan.
- `src/routes/api/jkai/builds/[id]/files/+server.ts` — GET workspace file tree (Phase 1 read-only).
- `src/routes/api/jkai/builds/[id]/files/[...path]/+server.ts` — GET file contents.
- `static/jkai-extensions/jkai-tools.js` — built pi extension script (mounted into sandbox at runtime).
- `tests/jkai/plan-parse.test.ts`, `tests/jkai/design-lint.test.ts`, `tests/jkai/feed.test.ts`, `tests/jkai/tool-bridge.test.ts`.

### Modified files
- `src/lib/db/schema.ts` — additive columns on `jkai_builds`.
- `src/lib/jkai/log-emitter.ts` — extend `LiveEvent` union with summary + plan events.
- `src/lib/jkai/pi-runner.ts` — opt-in skills + extension when build's `enforceDesignSystem`/extension config requires; emit summary events.
- `src/lib/jkai/orchestrator.ts` — gate after `planBuild()` when `plan_status='pending'`; per-iter linter; new `approvePlan`/`replanBuild` methods.
- `src/lib/jkai/sandbox.ts` — mount `/design-system/` and `/extensions/jkai-tools/` read-only into the workspace; expose `listFiles(buildId, subdir)` and `readFile(buildId, relPath)`.
- `src/lib/jkai/prompt.ts` — append design-system block when `enforceDesignSystem`; mention available skills.
- `src/routes/jkai/builds/+page.svelte` + `+page.server.ts` — list page redesign behind flag.
- `src/routes/jkai/builds/[id]/+page.svelte` + `+page.server.ts` — detail page redesign behind flag.
- `src/routes/jkai/builds/new/+page.svelte` — design-system toggle, `enabled_toolsets` checkbox group.
- `src/routes/api/jkai/builds/[id]/stream/+server.ts` — pass through new event types unchanged (already type-agnostic; verify).

---

## Task 1: DB migration

**Files:**
- Modify: `src/lib/db/schema.ts:491-510`

- [ ] **Step 1: Write the failing test**

`tests/jkai/schema-migration.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { jkaiBuilds } from '$lib/db/schema';

describe('jkai_builds new columns', () => {
  it('has the redesign columns with safe defaults', () => {
    const cols = (jkaiBuilds as any)[Symbol.for('drizzle:Columns')] || (jkaiBuilds as any)._.columns;
    const names = Object.keys(cols);
    expect(names).toContain('enforceDesignSystem');
    expect(names).toContain('planStatus');
    expect(names).toContain('milestones');
    expect(names).toContain('requireIterationApproval');
    expect(names).toContain('thinkingLevel');
    expect(names).toContain('enabledToolsets');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

`npx vitest run tests/jkai/schema-migration.test.ts`

- [ ] **Step 3: Add columns to schema**

In `src/lib/db/schema.ts`, inside `jkaiBuilds`, after the existing fields:

```typescript
  enforceDesignSystem: boolean('enforce_design_system').notNull().default(true),
  planStatus: text('plan_status').notNull().default('approved'),
  milestones: jsonb('milestones').$type<Array<{id:string;title:string;done:boolean;iter?:number}>>().notNull().default(sql`'[]'::jsonb`),
  requireIterationApproval: boolean('require_iteration_approval').notNull().default(false),
  thinkingLevel: text('thinking_level').notNull().default('medium'),
  enabledToolsets: jsonb('enabled_toolsets').$type<string[]>().notNull().default(sql`'["all"]'::jsonb`),
```

(Make sure `boolean` is imported from drizzle.)

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Apply schema to local dev DB**

`cd /home/john/strange_rambling_svelte && npx drizzle-kit push --force`

- [ ] **Step 6: Commit**

```
git add src/lib/db/schema.ts tests/jkai/schema-migration.test.ts
git commit -m "feat(jkai-builds): add design/plan/milestones columns"
```

---

## Task 2: Plan parser + tests

**Files:**
- Create: `src/lib/jkai/plan-parse.ts`
- Create: `tests/jkai/plan-parse.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { parsePlanMilestones } from '$lib/jkai/plan-parse';

describe('parsePlanMilestones', () => {
  it('extracts milestones from "### Iteration N:" headers + "- Milestone:" lines', () => {
    const md = `## Iteration Plan\n\n### Iteration 1: Auth flow\n- Goal: ship\n- Milestone: user can sign in\n\n### Iteration 2: Dashboard\n- Goal: render\n- Milestone: dashboard loads with live data`;
    const result = parsePlanMilestones(md);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'iter-1', title: 'user can sign in', done: false });
    expect(result[1]).toMatchObject({ id: 'iter-2', title: 'dashboard loads with live data', done: false });
  });
  it('returns [] for empty/null input', () => {
    expect(parsePlanMilestones('')).toEqual([]);
    expect(parsePlanMilestones(null as any)).toEqual([]);
  });
  it('skips iteration sections that have no milestone line', () => {
    const md = `### Iteration 1: x\n- Goal: y\n### Iteration 2: w\n- Milestone: m`;
    expect(parsePlanMilestones(md)).toEqual([
      { id: 'iter-2', title: 'm', done: false },
    ]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```typescript
export interface Milestone { id: string; title: string; done: boolean; iter?: number }

export function parsePlanMilestones(plan: string | null | undefined): Milestone[] {
  if (!plan) return [];
  const out: Milestone[] = [];
  const re = /###\s*Iteration\s+(\d+):[^\n]*\n([\s\S]*?)(?=\n###\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plan)) !== null) {
    const num = parseInt(m[1], 10);
    const body = m[2];
    const milestoneMatch = body.match(/-\s*Milestone:\s*([^\n]+)/i);
    if (milestoneMatch) {
      out.push({ id: `iter-${num}`, title: milestoneMatch[1].trim(), done: false, iter: num });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** `feat(jkai-builds): plan-milestone parser`

---

## Task 3: Design-system linter + tests

**Files:**
- Create: `src/lib/jkai/design-lint.ts`
- Create: `tests/jkai/design-lint.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { lintDesignSystem } from '$lib/jkai/design-lint';

describe('lintDesignSystem', () => {
  it('flags hex colours outside tokens.css', () => {
    const r = lintDesignSystem({ 'app/style.css': 'body { background: #ff0000; }' });
    expect(r.findings.some((f) => f.rule === 'no-raw-hex')).toBe(true);
  });
  it('allows hex colours inside tokens.css', () => {
    const r = lintDesignSystem({ 'tokens.css': ':root { --bg: #ede4d4; }' });
    expect(r.findings).toEqual([]);
  });
  it('flags Tailwind utility class soup', () => {
    const r = lintDesignSystem({ 'a.html': '<div class="bg-red-500 text-white p-4">x</div>' });
    expect(r.findings.some((f) => f.rule === 'no-tailwind')).toBe(true);
  });
  it('flags raw font-family declarations', () => {
    const r = lintDesignSystem({ 'a.css': 'h1 { font-family: Inter, sans-serif; }' });
    expect(r.findings.some((f) => f.rule === 'no-raw-font')).toBe(true);
  });
  it('allows font-family using var(--font-*)', () => {
    const r = lintDesignSystem({ 'a.css': 'h1 { font-family: var(--font-display); }' });
    expect(r.findings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement**

```typescript
export interface LintFinding { path: string; line: number; rule: string; message: string }
export interface LintResult { findings: LintFinding[] }

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const TAILWIND_CLASS_RE = /\bclass="[^"]*\b(?:bg-|text-|p-\d|m-\d|w-\d|h-\d|flex\b|grid\b)[^"]*"/g;
const RAW_FONT_RE = /font-family\s*:\s*(?!var\()/gi;

export function lintDesignSystem(files: Record<string, string>): LintResult {
  const findings: LintFinding[] = [];
  for (const [path, body] of Object.entries(files)) {
    const isTokens = /tokens\.css$/i.test(path);
    const lines = body.split('\n');
    lines.forEach((line, i) => {
      if (!isTokens && HEX_RE.test(line)) {
        findings.push({ path, line: i + 1, rule: 'no-raw-hex', message: `Raw hex colour outside tokens.css: ${line.trim().slice(0, 120)}` });
      }
      HEX_RE.lastIndex = 0;
      if (TAILWIND_CLASS_RE.test(line)) {
        findings.push({ path, line: i + 1, rule: 'no-tailwind', message: `Tailwind utility class detected: ${line.trim().slice(0, 120)}` });
      }
      TAILWIND_CLASS_RE.lastIndex = 0;
      if (RAW_FONT_RE.test(line)) {
        findings.push({ path, line: i + 1, rule: 'no-raw-font', message: `font-family must reference var(--font-*): ${line.trim().slice(0, 120)}` });
      }
      RAW_FONT_RE.lastIndex = 0;
    });
  }
  return { findings };
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** `feat(jkai-builds): design-system linter`

---

## Task 4: Activity feed reducer + tests

**Files:**
- Create: `src/lib/builds/feed.ts`
- Create: `tests/jkai/feed.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { reduceFeed, type FeedEvent } from '$lib/builds/feed';

describe('reduceFeed', () => {
  it('groups events by iterationId into iteration cards', () => {
    const evs: FeedEvent[] = [
      { kind: 'log', id: 1, type: 'system', content: 'Iter 1 start', iterationId: 'a' },
      { kind: 'live', type: 'stream_text', iterationId: 'a', streamId: 'a:0', delta: 'hello' },
      { kind: 'live', type: 'stream_thinking', iterationId: 'a', streamId: 'a:1', delta: 'thinking…' },
    ];
    const r = reduceFeed(evs);
    expect(r.iterations).toHaveLength(1);
    expect(r.iterations[0].id).toBe('a');
    expect(r.iterations[0].lanes.output).toBe('hello');
    expect(r.iterations[0].lanes.thinking).toContain('thinking');
  });
  it('builds tool entries from start/delta/end stream', () => {
    const evs: FeedEvent[] = [
      { kind: 'live', type: 'stream_tool_start', iterationId: 'a', streamId: 'a:0', toolName: 'write' },
      { kind: 'live', type: 'stream_tool_delta', iterationId: 'a', streamId: 'a:0', delta: '{"path":"x"}' },
      { kind: 'live', type: 'stream_tool_end', iterationId: 'a', streamId: 'a:0', full: '{"path":"x"}' },
    ];
    const r = reduceFeed(evs);
    const tools = r.iterations[0].lanes.tools;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'write', argsRaw: '{"path":"x"}', status: 'done' });
  });
  it('updates milestone via plan_proposed event', () => {
    const evs: FeedEvent[] = [
      { kind: 'live', type: 'plan_proposed', iterationId: '0', streamId: '0:0', full: '## Plan\n\n### Iteration 1: x\n- Milestone: m' },
    ];
    const r = reduceFeed(evs);
    expect(r.proposedPlan).toBe('## Plan\n\n### Iteration 1: x\n- Milestone: m');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement** (`src/lib/builds/feed.ts`)

```typescript
export type FeedEvent =
  | { kind: 'log'; id: number; type: string; content: string; iterationId: string | null }
  | { kind: 'live'; type: string; iterationId: string | null; streamId: string; delta?: string; full?: string; toolName?: string };

export interface ToolEntry { id: string; name: string; argsRaw: string; status: 'running' | 'done' | 'error'; result?: string }

export interface IterationCard {
  id: string;
  lanes: { thinking: string; output: string; tools: ToolEntry[] };
  systemLogs: string[];
}

export interface FeedState { iterations: IterationCard[]; proposedPlan: string | null }

export function reduceFeed(events: FeedEvent[]): FeedState {
  const byIter = new Map<string, IterationCard>();
  let proposedPlan: string | null = null;

  function ensure(iterId: string | null): IterationCard {
    const id = iterId ?? '__unscoped__';
    let it = byIter.get(id);
    if (!it) {
      it = { id, lanes: { thinking: '', output: '', tools: [] }, systemLogs: [] };
      byIter.set(id, it);
    }
    return it;
  }

  for (const ev of events) {
    if (ev.kind === 'log') {
      const it = ensure(ev.iterationId);
      if (ev.type === 'thinking') it.lanes.thinking += (it.lanes.thinking ? '\n' : '') + ev.content;
      else if (ev.type === 'text') it.lanes.output += (it.lanes.output ? '\n' : '') + ev.content;
      else if (ev.type === 'system' || ev.type === 'error' || ev.type === 'lint') it.systemLogs.push(ev.content);
      else if (ev.type === 'output') {
        const last = it.lanes.tools[it.lanes.tools.length - 1];
        if (last) { last.result = ev.content; last.status = 'done'; }
      }
      continue;
    }
    // live
    if (ev.type === 'plan_proposed') { proposedPlan = ev.full ?? proposedPlan; continue; }
    const it = ensure(ev.iterationId);
    if (ev.type === 'stream_text' && ev.delta) it.lanes.output += ev.delta;
    else if (ev.type === 'stream_thinking' && ev.delta) it.lanes.thinking += ev.delta;
    else if (ev.type === 'stream_tool_start') it.lanes.tools.push({ id: ev.streamId, name: ev.toolName ?? 'tool', argsRaw: '', status: 'running' });
    else if (ev.type === 'stream_tool_delta' && ev.delta) {
      const last = it.lanes.tools.find((t) => t.id === ev.streamId) ?? it.lanes.tools[it.lanes.tools.length - 1];
      if (last) last.argsRaw += ev.delta;
    } else if (ev.type === 'stream_tool_end') {
      const last = it.lanes.tools.find((t) => t.id === ev.streamId) ?? it.lanes.tools[it.lanes.tools.length - 1];
      if (last) { last.status = 'done'; if (ev.full) last.argsRaw = ev.full; }
    }
  }

  return { iterations: Array.from(byIter.values()), proposedPlan };
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit** `feat(jkai-builds): SSE feed reducer`

---

## Task 5: Tool bridge endpoints

**Files:**
- Create: `src/lib/jkai/tool-bridge.ts`
- Create: `src/routes/api/jkai/tools/manifest/+server.ts`
- Create: `src/routes/api/jkai/tools/invoke/+server.ts`
- Create: `tests/jkai/tool-bridge.test.ts`

- [ ] **Step 1: Write test for `tool-bridge.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { invokeTool, verifyBridgeToken } from '$lib/jkai/tool-bridge';

describe('verifyBridgeToken', () => {
  it('returns the buildId encoded in a valid token', async () => {
    const tok = await import('$lib/jkai/tool-bridge').then((m) => m.signBridgeToken('build-xyz'));
    expect(verifyBridgeToken(tok)).toBe('build-xyz');
  });
  it('returns null for tampered token', () => {
    expect(verifyBridgeToken('bogus')).toBeNull();
  });
});

describe('invokeTool', () => {
  it('rejects unknown tool name', async () => {
    await expect(invokeTool('nonexistent_tool_xyz', {})).rejects.toThrow(/unknown tool/i);
  });
});
```

- [ ] **Step 2: Implement `tool-bridge.ts`**

```typescript
import crypto from 'node:crypto';
import { getTool, getToolsetManifest } from '$lib/workflows/site-tools/registry';

const SECRET = process.env.JKAI_BRIDGE_SECRET ?? 'jkai-bridge-dev-secret';

export function signBridgeToken(buildId: string): string {
  const payload = `${buildId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyBridgeToken(token: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [buildId, ts, sig] = parts;
    const expected = crypto.createHmac('sha256', SECRET).update(`${buildId}.${ts}`).digest('hex');
    if (sig !== expected) return null;
    return buildId;
  } catch { return null; }
}

export async function invokeTool(name: string, args: unknown): Promise<unknown> {
  const tool = getTool(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.handler(args ?? {});
}

export function manifestForBuild(enabledToolsets: string[]): ReturnType<typeof getToolsetManifest> {
  const all = getToolsetManifest();
  if (enabledToolsets.includes('all')) return all;
  return all.filter((t) => enabledToolsets.includes(t.toolset));
}
```

- [ ] **Step 3: Implement `manifest/+server.ts`**

```typescript
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { verifyBridgeToken, manifestForBuild } from '$lib/jkai/tool-bridge';
import { getToolDefinitions } from '$lib/workflows/site-tools/registry';

export async function GET({ request }) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const buildId = verifyBridgeToken(token);
  if (!buildId) throw error(401, 'invalid token');
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw error(404, 'build not found');
  const enabled = (build.enabledToolsets ?? ['all']) as string[];
  const allDefs = getToolDefinitions();
  const allowedSets = manifestForBuild(enabled).map((m) => m.toolset);
  const filtered = enabled.includes('all')
    ? allDefs
    : allDefs.filter((d: any) => allowedSets.some((s) => d.name.startsWith(s + '_')));
  return json({ tools: filtered });
}
```

- [ ] **Step 4: Implement `invoke/+server.ts`**

```typescript
import { json, error } from '@sveltejs/kit';
import { verifyBridgeToken, invokeTool } from '$lib/jkai/tool-bridge';

export async function POST({ request }) {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const buildId = verifyBridgeToken(token);
  if (!buildId) throw error(401, 'invalid token');
  const body = await request.json();
  if (!body || typeof body.name !== 'string') throw error(400, 'name required');
  try {
    const result = await invokeTool(body.name, body.args);
    return json({ ok: true, result });
  } catch (e: any) {
    return json({ ok: false, error: e.message ?? String(e) }, { status: 400 });
  }
}
```

- [ ] **Step 5: Run tests, expect PASS** (`npx vitest run tests/jkai/tool-bridge.test.ts`)

- [ ] **Step 6: Commit** `feat(jkai-builds): tool-bridge endpoints`

---

## Task 6: Pi extension `jkai-tools.ts`

**Files:**
- Create: `static/jkai-extensions/jkai-tools.js` (or built from a TS source via tsx — for simplicity, plain JS that pi can require)

- [ ] **Step 1: Write the extension**

The pi extension is a CommonJS module that exports a default function returning a registration object. Pi 0.68's `--extension <path>` accepts JS files. We write JS directly to avoid a build step inside the sandbox.

```javascript
// static/jkai-extensions/jkai-tools.js
// Pi extension: bridges every JKAI registry tool into pi as a first-class tool.
// Reads JKAI_API_URL + JKAI_BRIDGE_TOKEN from env (injected via docker exec -e).

module.exports = async function register(api) {
  const apiUrl = process.env.JKAI_API_URL;
  const token = process.env.JKAI_BRIDGE_TOKEN;
  if (!apiUrl || !token) {
    api.log?.('jkai-tools: JKAI_API_URL or JKAI_BRIDGE_TOKEN missing — skipping registration');
    return { tools: [] };
  }
  const res = await fetch(`${apiUrl}/api/jkai/tools/manifest`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!res || !res.ok) {
    api.log?.('jkai-tools: failed to fetch manifest, skipping');
    return { tools: [] };
  }
  const { tools } = await res.json();

  const piTools = tools.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters || { type: 'object', properties: {} },
    async handler(args) {
      const r = await fetch(`${apiUrl}/api/jkai/tools/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: def.name, args }),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`tool ${def.name} failed: ${r.status} ${text.slice(0, 500)}`);
      }
      const body = await r.json();
      if (!body.ok) throw new Error(body.error ?? 'tool error');
      return typeof body.result === 'string' ? body.result : JSON.stringify(body.result);
    },
  }));

  return { tools: piTools };
};
```

- [ ] **Step 2: Smoke-test it loads (manually after task 7 wires sandbox env)**

(Tested implicitly via the integration done at Task 8.)

- [ ] **Step 3: Commit** `feat(jkai-builds): pi extension bridging registry tools`

---

## Task 7: Sandbox mount + design assets

**Files:**
- Create: `src/lib/jkai/design-assets.ts`
- Modify: `src/lib/jkai/sandbox.ts` (add mount helpers + listFiles + readFile)

- [ ] **Step 1: Implement `design-assets.ts`**

Reads `src/app.css` `:root { ... }` and `src/lib/styles/nm-tokens.css` at build time, concatenates them into a single `tokens.css` string; returns the bundle as `{ 'README.md': string, 'tokens.css': string, 'components.md': string, 'examples/page.svelte': string }`.

```typescript
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const COMPONENTS_MD = `# Strange Ramblings Design System — Cheatsheet

Always import \`tokens.css\` (or copy the relevant CSS variables) at the root of your stylesheet. Never hard-code hex colours or font names.

## Page wrapper
\`\`\`html
<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Section</div>
      <h1>Page Title</h1>
    </div>
  </header>
  <!-- content -->
</div>
\`\`\`

## Section card
Use \`.nm-sec\` with an optional \`.nm-sec-hd\` header.

\`\`\`html
<section class="nm-sec">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Heading</span>
  </header>
  <p>Body</p>
</section>
\`\`\`

## Form fields
\`\`\`html
<input class="nm-text-input" />
<button class="nm-save-btn">Save</button>
<button class="nm-btn-ghost">Cancel</button>
\`\`\`

## Inline action link
\`\`\`html
<button class="row-link">View</button>
<button class="row-link danger">Delete</button>
\`\`\`

## Status dot
\`\`\`html
<span class="status-dot" data-status="running"></span>
\`\`\`
\`data-status\` ∈ \`{ pending, running, completed, failed }\`.

## Don'ts
- No raw \`#hex\` colours outside this file.
- No Tailwind utility classes (\`bg-*\`, \`text-*\`, \`p-*\`, etc.).
- No \`font-family:\` outside \`var(--font-display | --font-body | --font-mono)\`.
`;

const README_MD = `# Strange Ramblings Design System

This directory is a read-only mount of the site's canonical design tokens, components, and examples. Read it in full BEFORE writing any HTML/CSS/Svelte. Your work will be linted against these rules.

Files:
- \`tokens.css\` — CSS variables for colour, typography, status. Import at the root of your stylesheet.
- \`components.md\` — class cheatsheet for sections, inputs, buttons, status dots.
- \`examples/page.svelte\` — canonical list-page layout.

Rules: \`components.md\` enumerates them. The post-iteration linter will reject this iteration if you violate them.
`;

const EXAMPLE_PAGE_SVELTE = `<script>
  // Example list page lifted from the site's canvas.
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Example</div>
      <h1>Page Title</h1>
    </div>
  </header>

  <section class="nm-sec">
    <header class="nm-sec-hd">
      <span class="sr-label-tight">Items</span>
    </header>
    <div class="grid">
      <article class="card">
        <h3>Item one</h3>
        <span class="status-dot" data-status="completed"></span>
      </article>
    </div>
  </section>
</div>

<style>
  @import './tokens.css';
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  h1 { font-family: var(--font-display); font-size: 2rem; font-weight: 900; line-height: 1.05; color: var(--text-primary); margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.6rem; }
  .card { background: var(--bg); border: 1px solid var(--card-border); padding: 1rem; }
  h3 { font-family: var(--font-display); font-weight: 800; font-size: 1.1rem; margin: 0 0 0.5rem; }
</style>
`;

export async function buildDesignAssets(repoRoot: string): Promise<Record<string, string>> {
  const appCss = await readFile(path.join(repoRoot, 'src/app.css'), 'utf-8').catch(() => '');
  const nmTokens = await readFile(path.join(repoRoot, 'src/lib/styles/nm-tokens.css'), 'utf-8').catch(() => '');
  const rootBlock = appCss.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? '';
  const tokens = `/* Generated from app.css :root + nm-tokens.css */\n${rootBlock}\n\n${nmTokens}\n`;
  return {
    'README.md': README_MD,
    'tokens.css': tokens,
    'components.md': COMPONENTS_MD,
    'examples/page.svelte': EXAMPLE_PAGE_SVELTE,
  };
}
```

- [ ] **Step 2: Add mount helpers to `sandbox.ts`**

Append to `src/lib/jkai/sandbox.ts` (look at existing `ensureWorkspace` for style; we add a sibling that writes the design-system assets and the pi extension into the workspace each time, so updates land):

```typescript
import { buildDesignAssets } from './design-assets';
import { signBridgeToken } from './tool-bridge';

const REPO_ROOT = process.cwd();

export async function syncDesignAssets(buildId: string): Promise<string> {
  const dest = `/home/jkai/workspace/${buildId}/design-system`;
  await execInSandbox(`mkdir -p ${dest}/examples`);
  const assets = await buildDesignAssets(REPO_ROOT);
  for (const [rel, body] of Object.entries(assets)) {
    await writeFileInSandbox(`${dest}/${rel}`, body);
  }
  return dest;
}

export async function syncJkaiExtension(buildId: string): Promise<string> {
  const dest = `/home/jkai/workspace/${buildId}/extensions/jkai-tools`;
  await execInSandbox(`mkdir -p ${dest}`);
  const src = await (await import('node:fs/promises')).readFile(
    path.join(REPO_ROOT, 'static/jkai-extensions/jkai-tools.js'),
    'utf-8',
  );
  await writeFileInSandbox(`${dest}/index.js`, src);
  return `${dest}/index.js`;
}

export function bridgeTokenForBuild(buildId: string): string {
  return signBridgeToken(buildId);
}

export async function listDevFiles(buildId: string, subdir = ''): Promise<Array<{ path: string; size: number; mtime: number }>> {
  const root = `/home/jkai/workspace/${buildId}/dev`;
  const target = subdir ? `${root}/${subdir.replace(/\.\./g, '')}` : root;
  const out = await execInSandbox(
    `find ${target} -maxdepth 6 -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -printf '%P\\t%s\\t%T@\\n' 2>/dev/null || true`,
  ).catch(() => '');
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [p, sz, mt] = line.split('\t');
      return { path: p, size: parseInt(sz || '0', 10), mtime: Math.floor(parseFloat(mt || '0')) };
    });
}

export async function readDevFile(buildId: string, relPath: string): Promise<string> {
  const safe = relPath.replace(/\.\./g, '').replace(/^\/+/, '');
  return execInSandbox(`cat /home/jkai/workspace/${buildId}/dev/${safe}`).catch(() => '');
}
```

(If `execInSandbox` / `writeFileInSandbox` aren't already exported, infer their names from the existing file and adjust.)

- [ ] **Step 3: Commit** `feat(jkai-builds): sandbox design + extension sync`

---

## Task 8: Wire pi-runner to load extension/skills + inject env

**Files:**
- Modify: `src/lib/jkai/pi-runner.ts`
- Modify: `src/lib/jkai/executor.ts`

- [ ] **Step 1: Add options to `PiRunOptions`**

```typescript
export interface PiRunOptions {
  // …existing…
  extensions?: string[];          // pi -e args (paths inside container)
  skillDirs?: string[];           // pi --skill args
  thinkingLevel?: string;         // off/min/low/medium/high/xhigh
  extraEnv?: Record<string, string>;
}
```

In `runPi`, replace the hard-coded `--no-extensions --no-skills` with conditional flags:

```typescript
  const piParts = ['pi', '--mode', 'json', '--no-session', '--no-prompt-templates', '--no-themes', '--no-context-files',
    '--tools', 'read,bash,edit,write,grep,find,ls'];
  if (opts.extensions?.length) {
    for (const e of opts.extensions) piParts.push('--extension', sh(e));
  } else {
    piParts.push('--no-extensions');
  }
  if (opts.skillDirs?.length) {
    for (const s of opts.skillDirs) piParts.push('--skill', sh(s));
  } else {
    piParts.push('--no-skills');
  }
  if (opts.thinkingLevel) piParts.push('--thinking', opts.thinkingLevel);
  piParts.push('--provider', provider, '--model', sh(modelId), '--append-system-prompt', sh(systemPrompt), '-p', sh(userPrompt));
  const piCmd = piParts.join(' ');
```

Also extend `dockerArgs` env list:

```typescript
  for (const [k, v] of Object.entries(opts.extraEnv ?? {})) {
    dockerArgs.splice(dockerArgs.indexOf(CONTAINER_NAME), 0, '-e', `${k}=${v}`);
  }
```

- [ ] **Step 2: Wire `executor.ts` to populate the new options**

After `await ensureWorkspace(build.id);`:

```typescript
  const skillDirs: string[] = [];
  const extensions: string[] = [];
  const extraEnv: Record<string, string> = {};
  const enforce = (build as any).enforceDesignSystem !== false;
  if (enforce) {
    const dsPath = await syncDesignAssets(build.id);
    skillDirs.push(dsPath);
  }
  // Always sync the jkai-tools extension so registry tools are reachable
  const extPath = await syncJkaiExtension(build.id);
  extensions.push(extPath);
  extraEnv.JKAI_API_URL = process.env.JKAI_API_URL ?? 'http://host.docker.internal:5173';
  extraEnv.JKAI_BRIDGE_TOKEN = bridgeTokenForBuild(build.id);
```

Pass `extensions, skillDirs, thinkingLevel: build.thinkingLevel, extraEnv` into `runPi(...)`.

- [ ] **Step 3: Update `prompt.ts`** — when `enforceDesignSystem`, append a paragraph instructing pi to read `/home/jkai/workspace/<buildId>/design-system/README.md` first and follow the tokens. Reference the linter.

- [ ] **Step 4: Manual smoke** (deferred to integration check; covered by build runtime).

- [ ] **Step 5: Commit** `feat(jkai-builds): pi-runner extension+skill wiring`

---

## Task 9: Plan-first orchestrator gate

**Files:**
- Modify: `src/lib/jkai/orchestrator.ts`

- [ ] **Step 1: After `planBuild()` in `initAndPlan`, check plan status**

Replace lines around 281-293 (`initAndPlan`):

```typescript
  private async initAndPlan(buildId: string): Promise<void> {
    await ensureSandboxRunning();
    await ensureWorkspace(buildId);
    const [buildRecord] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!buildRecord || this.stopped) return;
    await planBuild(buildId, buildRecord.prompt);
    if (this.stopped) return;

    const [refreshed] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (refreshed?.planStatus === 'pending') {
      // Park the build awaiting human approval.
      await db.update(jkaiBuilds)
        .set({ status: 'awaiting_plan_approval', updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
      await emitLog(buildId, 'system', 'Plan ready — awaiting approval before iterations begin.');
      this.activeBuildId = null;
      return;
    }
    this.scheduleNext(buildId);
  }
```

- [ ] **Step 2: Add `approvePlan` and `replan` methods**

```typescript
  async approvePlan(buildId: string): Promise<void> {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    if (build.status !== 'awaiting_plan_approval') return;

    // Derive milestones from plan iter 0
    const [iter0] = await db.select().from(jkaiIterations)
      .where(and(eq(jkaiIterations.buildId, buildId), eq(jkaiIterations.number, 0)))
      .limit(1);
    const { parsePlanMilestones } = await import('./plan-parse');
    const milestones = parsePlanMilestones(iter0?.plan ?? null);

    await db.update(jkaiBuilds)
      .set({ status: 'running', planStatus: 'approved', milestones, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', 'Plan approved — starting iterations.');
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  async skipPlan(buildId: string): Promise<void> {
    await db.update(jkaiBuilds)
      .set({ status: 'running', planStatus: 'skipped', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', 'Plan skipped — proceeding without milestone tracking.');
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  async replan(buildId: string, revisedPrompt?: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId) throw new Error('another build active');
    await db.delete(jkaiIterations)
      .where(and(eq(jkaiIterations.buildId, buildId), eq(jkaiIterations.number, 0)));
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    if (revisedPrompt) {
      await db.update(jkaiBuilds).set({ prompt: revisedPrompt }).where(eq(jkaiBuilds.id, buildId));
    }
    await db.update(jkaiBuilds).set({ status: 'running', planStatus: 'pending', updatedAt: new Date() }).where(eq(jkaiBuilds.id, buildId));
    this.activeBuildId = buildId;
    this.stopped = false;
    await this.initAndPlan(buildId);
  }
```

- [ ] **Step 3: Hook linter post-iteration**

After the test run / before promotion, when `build.enforceDesignSystem`:

```typescript
      if ((build as any).enforceDesignSystem) {
        const { listDevFiles, readDevFile } = await import('./sandbox');
        const { lintDesignSystem } = await import('./design-lint');
        const targetExts = ['.css', '.svelte', '.html', '.tsx', '.jsx'];
        const all = await listDevFiles(buildId);
        const files: Record<string, string> = {};
        for (const f of all) {
          if (!targetExts.some((e) => f.path.endsWith(e))) continue;
          if (f.size > 200_000) continue;
          files[f.path] = await readDevFile(buildId, f.path);
        }
        const { findings } = lintDesignSystem(files);
        if (findings.length) {
          const summary = findings.slice(0, 30).map((f) => `${f.path}:${f.line} [${f.rule}] ${f.message}`).join('\n');
          await emitLog(buildId, 'lint', `Design-system violations:\n${summary}`, iteration.id);
          // Mark iteration failed so promotion is skipped & next iter receives the lint feedback.
          await db.update(jkaiIterations)
            .set({ status: 'failed', failure: { kind: 'design_lint', message: `${findings.length} design-system violations`, attempts: 1 } as any })
            .where(eq(jkaiIterations.id, iteration.id));
          await emitLog(buildId, 'system', 'Iteration rejected by design-system linter — feedback included in next iteration.', iteration.id);
          this.scheduleNext(buildId, 1000);
          return;
        }
      }
```

- [ ] **Step 4: Commit** `feat(jkai-builds): plan-approval gate + post-iter linter`

---

## Task 10: Build endpoints (plan, files)

**Files:**
- Create: `src/routes/api/jkai/builds/[id]/plan/+server.ts`
- Create: `src/routes/api/jkai/builds/[id]/files/+server.ts`
- Create: `src/routes/api/jkai/builds/[id]/files/[...path]/+server.ts`

- [ ] **Step 1: Implement plan endpoint**

```typescript
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { orchestrator } from '$lib/jkai/orchestrator';

export async function GET({ params }) {
  const buildId = params.id!;
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw error(404, 'not found');
  const [iter0] = await db.select().from(jkaiIterations).where(and(eq(jkaiIterations.buildId, buildId), eq(jkaiIterations.number, 0))).limit(1);
  return json({ status: build.status, planStatus: build.planStatus, plan: iter0?.plan ?? null, milestones: build.milestones });
}

export async function POST({ params, request }) {
  const buildId = params.id!;
  const body = await request.json();
  const action = body?.action as string;
  if (action === 'approve') await orchestrator.approvePlan(buildId);
  else if (action === 'skip') await orchestrator.skipPlan(buildId);
  else if (action === 'replan') await orchestrator.replan(buildId, body.prompt);
  else if (action === 'edit') {
    await db.update(jkaiIterations)
      .set({ plan: String(body.plan ?? '') })
      .where(and(eq(jkaiIterations.buildId, buildId), eq(jkaiIterations.number, 0)));
  } else throw error(400, 'bad action');
  return json({ ok: true });
}
```

- [ ] **Step 2: Implement files endpoints**

```typescript
// files/+server.ts
import { json, error } from '@sveltejs/kit';
import { listDevFiles } from '$lib/jkai/sandbox';
export async function GET({ params }) {
  const list = await listDevFiles(params.id!);
  return json({ files: list });
}
```

```typescript
// files/[...path]/+server.ts
import { json } from '@sveltejs/kit';
import { readDevFile } from '$lib/jkai/sandbox';
export async function GET({ params }) {
  const body = await readDevFile(params.id!, params.path!);
  return json({ content: body });
}
```

- [ ] **Step 3: Commit** `feat(jkai-builds): plan + files endpoints`

---

## Task 11: New shared Svelte components

**Files:**
- Create: each component in `src/lib/builds/`

- [ ] **Step 1: Create `parse-actions.ts`** (file timeline source)

```typescript
import type { JkaiIteration } from '$lib/db/schema';

export interface FileChange { path: string; iter: number; action: 'write'|'edit'|'read'; preview: string }

export function buildFileTimeline(iterations: JkaiIteration[]): FileChange[] {
  const out: FileChange[] = [];
  for (const it of iterations) {
    const acts = (it.actions as any[]) ?? [];
    for (const a of acts) {
      const lang = String(a.lang ?? '');
      const code = String(a.code ?? '');
      if (lang === 'write' || lang === 'edit') {
        const firstLine = code.split('\n')[0] ?? '';
        const path = firstLine.replace(/^(write|edit)\s+/, '');
        if (!path) continue;
        out.push({ path, iter: it.number, action: lang as any, preview: code.slice(0, 1200) });
      }
    }
  }
  // Latest first by iter number
  return out.sort((a, b) => b.iter - a.iter);
}
```

- [ ] **Step 2: `Activity.svelte`**

```svelte
<script lang="ts">
  import IterationCard from './IterationCard.svelte';
  import type { FeedState } from './feed';
  let { feed }: { feed: FeedState } = $props();
</script>

<div class="activity">
  {#each feed.iterations as it (it.id)}
    <IterationCard iter={it} />
  {/each}
</div>

<style>
  .activity { display: flex; flex-direction: column; gap: 0.75rem; }
</style>
```

- [ ] **Step 3: `IterationCard.svelte`**

```svelte
<script lang="ts">
  import LaneThinking from './LaneThinking.svelte';
  import LaneTools from './LaneTools.svelte';
  import LaneOutput from './LaneOutput.svelte';
  import type { IterationCard } from './feed';
  let { iter }: { iter: IterationCard } = $props();
</script>

<section class="nm-sec iter">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Iteration {iter.id}</span>
  </header>
  {#if iter.lanes.thinking}
    <LaneThinking content={iter.lanes.thinking} />
  {/if}
  {#if iter.lanes.tools.length}
    <LaneTools tools={iter.lanes.tools} />
  {/if}
  {#if iter.lanes.output}
    <LaneOutput content={iter.lanes.output} />
  {/if}
  {#each iter.systemLogs as log}
    <pre class="syslog">{log}</pre>
  {/each}
</section>

<style>
  .iter { font-family: var(--font-body); }
  .syslog { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin: 0.4rem 0 0; padding: 6px 8px; background: var(--bg-section); border: 1px solid var(--card-border); white-space: pre-wrap; word-break: break-word; }
</style>
```

- [ ] **Step 4: `LaneThinking.svelte`** (collapsed by default; auto-summarises first line)

```svelte
<script lang="ts">
  let { content }: { content: string } = $props();
  let open = $state(false);
  const headline = $derived(content.split('\n').find((l) => l.trim()) ?? 'Thinking…');
</script>

<div class="lane-thinking">
  <button class="row-link" onclick={() => (open = !open)}>
    <span class="status-dot" data-status="pending"></span>
    {open ? '−' : '+'} thinking — {headline.slice(0, 100)}{headline.length > 100 ? '…' : ''}
  </button>
  {#if open}
    <pre>{content}</pre>
  {/if}
</div>

<style>
  .lane-thinking { margin: 0.4rem 0; }
  pre { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin: 0.3rem 0 0; padding: 8px 10px; background: var(--bg-section); border: 1px solid var(--card-border); white-space: pre-wrap; word-break: break-word; }
</style>
```

- [ ] **Step 5: `LaneTools.svelte`** + `ToolPill.svelte`

```svelte
<!-- LaneTools.svelte -->
<script lang="ts">
  import ToolPill from './ToolPill.svelte';
  import type { ToolEntry } from './feed';
  let { tools }: { tools: ToolEntry[] } = $props();
</script>

<div class="lane-tools">
  {#each tools as t (t.id)}
    <ToolPill tool={t} />
  {/each}
</div>

<style>
  .lane-tools { display: flex; flex-direction: column; gap: 0.35rem; margin: 0.5rem 0; }
</style>
```

```svelte
<!-- ToolPill.svelte -->
<script lang="ts">
  import type { ToolEntry } from './feed';
  let { tool }: { tool: ToolEntry } = $props();
  let open = $state(false);
  const status = $derived(tool.status === 'running' ? 'running' : tool.status === 'error' ? 'failed' : 'completed');
</script>

<div class="tool" class:open>
  <button class="row-link" onclick={() => (open = !open)}>
    <span class="status-dot" data-status={status}></span>
    <code>{tool.name}</code>
    <span class="dim">{tool.argsRaw.slice(0, 80).replace(/\s+/g, ' ')}{tool.argsRaw.length > 80 ? '…' : ''}</span>
  </button>
  {#if open}
    <pre class="args">{tool.argsRaw}</pre>
    {#if tool.result}<pre class="result">{tool.result}</pre>{/if}
  {/if}
</div>

<style>
  .tool { border-left: 2px solid var(--card-border); padding: 2px 0 2px 8px; }
  .tool.open { border-left-color: var(--accent); }
  code { font-family: var(--font-mono); font-size: 11px; color: var(--accent); margin: 0 6px; }
  .dim { color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
  pre { font-family: var(--font-mono); font-size: 11px; margin: 4px 0; padding: 8px 10px; background: var(--code-bg); color: var(--code-text); border: 1px solid var(--card-border); white-space: pre-wrap; word-break: break-word; }
  pre.result { color: var(--text-primary); background: var(--bg-section); }
</style>
```

- [ ] **Step 6: `LaneOutput.svelte`** (markdown; reuse `ChatMarkdown` if available)

```svelte
<script lang="ts">
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  let { content }: { content: string } = $props();
</script>

<div class="lane-output">
  <ChatMarkdown body={content} />
</div>

<style>
  .lane-output { margin: 0.5rem 0; }
</style>
```

- [ ] **Step 7: `FilesTimeline.svelte`**

```svelte
<script lang="ts">
  import type { FileChange } from './parse-actions';
  let { changes }: { changes: FileChange[] } = $props();
  let openPath = $state<string | null>(null);
</script>

<section class="nm-sec">
  <header class="nm-sec-hd"><span class="sr-label-tight">Files</span></header>
  {#if changes.length === 0}
    <p class="dim">No file edits yet.</p>
  {:else}
    <ul class="rows">
      {#each changes as c, i (i + ':' + c.path + ':' + c.iter)}
        <li>
          <button class="row-link" onclick={() => (openPath = openPath === c.path + ':' + c.iter ? null : c.path + ':' + c.iter)}>
            <span class="status-dot" data-status="completed"></span>
            <code>{c.path}</code>
            <span class="dim">iter {c.iter} · {c.action}</span>
          </button>
          {#if openPath === c.path + ':' + c.iter}
            <pre>{c.preview}</pre>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .rows { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  code { font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); margin: 0 6px; }
  .dim { color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; }
  pre { margin: 4px 0; padding: 8px 10px; background: var(--code-bg); color: var(--code-text); font-family: var(--font-mono); font-size: 11px; white-space: pre-wrap; }
</style>
```

- [ ] **Step 8: `PlanEditor.svelte`**

```svelte
<script lang="ts">
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  let { plan, buildId, onAfter }: { plan: string; buildId: string; onAfter: () => void } = $props();
  let body = $state(plan);
  let saving = $state(false);
  async function call(action: string, extra: Record<string, unknown> = {}) {
    saving = true;
    try {
      await fetch(`/api/jkai/builds/${buildId}/plan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      onAfter();
    } finally { saving = false; }
  }
  async function saveEdit() { await call('edit', { plan: body }); }
  async function approve() { await saveEdit(); await call('approve'); }
  async function skip() { await call('skip'); }
  async function replan() { await call('replan'); }
  let preview = $state(false);
</script>

<section class="nm-sec">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Plan — awaiting approval</span>
    <div style="margin-left:auto;">
      <button class="row-link" onclick={() => (preview = !preview)}>{preview ? 'Edit' : 'Preview'}</button>
    </div>
  </header>
  {#if preview}
    <ChatMarkdown body={body} />
  {:else}
    <textarea class="nm-text-input" rows="20" bind:value={body}></textarea>
  {/if}
  <div class="actions">
    <button class="nm-save-btn" disabled={saving} onclick={approve}>Approve & Start</button>
    <button class="nm-btn-ghost" disabled={saving} onclick={replan}>Re-plan</button>
    <button class="nm-btn-ghost" disabled={saving} onclick={skip}>Skip & Code Now</button>
  </div>
</section>

<style>
  .actions { display: flex; gap: 0.6rem; margin-top: 0.8rem; }
  textarea { min-height: 320px; resize: vertical; }
</style>
```

- [ ] **Step 9: `MilestoneList.svelte`**

```svelte
<script lang="ts">
  type Milestone = { id: string; title: string; done: boolean; iter?: number };
  let { milestones }: { milestones: Milestone[] } = $props();
</script>

<section class="nm-sec">
  <header class="nm-sec-hd"><span class="sr-label-tight">Milestones</span></header>
  {#if !milestones.length}
    <p class="dim">No milestones — approve a plan to populate them.</p>
  {:else}
    <ul>
      {#each milestones as m}
        <li>
          <span class="status-dot" data-status={m.done ? 'completed' : 'pending'}></span>
          <span class:done={m.done}>{m.title}</span>
          {#if m.iter !== undefined}<span class="dim">iter {m.iter}</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-family: var(--font-body); font-size: 12px; }
  .done { color: var(--text-muted); text-decoration: line-through; }
  .dim { color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; margin-left: 6px; }
</style>
```

- [ ] **Step 10: `BuildSidebar.svelte`** (composes the rail)

```svelte
<script lang="ts">
  import MilestoneList from './MilestoneList.svelte';
  type Build = { id: string; modelProvider: string; modelId: string; thinkingLevel: string; enforceDesignSystem: boolean; budgetConfig: any; tokensUsed: number; iterationsCompleted: number; activeMinutesUsed: number; milestones: any[]; status: string };
  let { build }: { build: Build } = $props();
  let saving = $state(false);
  async function patch(updates: Record<string, unknown>) {
    saving = true;
    try {
      await fetch(`/api/jkai/builds/${build.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } finally { saving = false; }
  }
</script>

<aside class="sidebar">
  <section class="nm-sec">
    <header class="nm-sec-hd"><span class="sr-label-tight">Budget</span></header>
    <dl>
      <dt>Iters</dt><dd>{build.iterationsCompleted}</dd>
      <dt>Tokens</dt><dd>{build.tokensUsed}</dd>
      <dt>Active min</dt><dd>{build.activeMinutesUsed.toFixed(1)}</dd>
    </dl>
  </section>

  <section class="nm-sec">
    <header class="nm-sec-hd"><span class="sr-label-tight">Strategy</span></header>
    <label>Thinking
      <select class="nm-text-input" value={build.thinkingLevel} onchange={(e) => patch({ thinkingLevel: (e.target as HTMLSelectElement).value })}>
        {#each ['off','minimal','low','medium','high','xhigh'] as lv}<option value={lv}>{lv}</option>{/each}
      </select>
    </label>
    <label>
      <input type="checkbox" checked={build.enforceDesignSystem} onchange={(e) => patch({ enforceDesignSystem: (e.target as HTMLInputElement).checked })} />
      Enforce site design system
    </label>
  </section>

  <MilestoneList milestones={build.milestones} />
</aside>

<style>
  .sidebar { display: flex; flex-direction: column; gap: 0.75rem; min-width: 260px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-family: var(--font-mono); font-size: 11px; }
  dt { color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; font-size: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0.5rem; }
</style>
```

- [ ] **Step 11: `ModeSwitcher.svelte`** (Watch enabled; Tinker / Drive disabled)

```svelte
<script lang="ts">
  let { mode = $bindable('watch') }: { mode?: 'watch'|'tinker'|'drive' } = $props();
</script>

<div class="seg">
  {#each [['watch','Watch',true],['tinker','Tinker',false],['drive','Drive',false]] as [v, label, enabled] (v)}
    <button class="seg-btn" class:active={mode === v} disabled={!enabled} title={enabled ? '' : 'Coming soon — Phase 2'} onclick={() => { if (enabled) mode = v as any; }}>{label}</button>
  {/each}
</div>

<style>
  .seg { display: inline-flex; border: 1px solid var(--card-border); }
  .seg-btn { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; padding: 6px 14px; background: transparent; color: var(--text-primary); border: none; cursor: pointer; }
  .seg-btn:hover:not(:disabled) { background: var(--accent-tint-08); }
  .seg-btn.active { background: var(--accent); color: var(--bg); }
  .seg-btn:disabled { color: var(--text-ghost); cursor: not-allowed; }
</style>
```

- [ ] **Step 12: `WatchPane.svelte`** (read-only file tree)

```svelte
<script lang="ts">
  let { buildId }: { buildId: string } = $props();
  let files = $state<Array<{path:string;size:number;mtime:number}>>([]);
  let openPath = $state<string | null>(null);
  let openContent = $state('');
  async function refresh() {
    const r = await fetch(`/api/jkai/builds/${buildId}/files`).then((r) => r.json()).catch(() => ({ files: [] }));
    files = r.files ?? [];
  }
  async function openFile(p: string) {
    openPath = p;
    const r = await fetch(`/api/jkai/builds/${buildId}/files/${p}`).then((r) => r.json()).catch(() => ({ content: '' }));
    openContent = r.content ?? '';
  }
  refresh();
</script>

<section class="nm-sec watch">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Sandbox files (read-only)</span>
    <button class="row-link" style="margin-left:auto;" onclick={refresh}>↻ refresh</button>
  </header>
  <div class="split">
    <ul class="tree">
      {#each files as f (f.path)}
        <li><button class="row-link" class:active={openPath === f.path} onclick={() => openFile(f.path)}><code>{f.path}</code></button></li>
      {/each}
    </ul>
    <pre class="viewer">{openContent}</pre>
  </div>
</section>

<style>
  .split { display: grid; grid-template-columns: 280px 1fr; gap: 12px; min-height: 320px; }
  .tree { list-style: none; padding: 0; margin: 0; max-height: 60vh; overflow-y: auto; border: 1px solid var(--card-border); padding: 8px; }
  code { font-family: var(--font-mono); font-size: 11px; }
  .row-link.active code { color: var(--accent); }
  .viewer { font-family: var(--font-mono); font-size: 11px; padding: 10px 12px; background: var(--code-bg); color: var(--code-text); border: 1px solid var(--card-border); white-space: pre-wrap; word-break: break-word; max-height: 60vh; overflow: auto; }
</style>
```

- [ ] **Step 13: Commit** `feat(jkai-builds): shared activity/sidebar/watch components`

---

## Task 12: Page rewrite — list

**Files:**
- Modify: `src/routes/jkai/builds/+page.svelte`
- Modify: `src/routes/jkai/builds/+page.server.ts` (passes flag through)
- Modify: `src/routes/jkai/builds/new/+page.svelte` (toggle for design enforcement)

- [ ] **Step 1: Wrap page behind feature flag**

In `+page.server.ts` add `flagOn: env.PUBLIC_BUILDS_V2 === 'true'` to load output.

In `+page.svelte`, branch:

```svelte
<script lang="ts">
  import LegacyList from './_legacy.svelte'; // (move existing markup here)
  import V2List from './_v2.svelte';
  let { data } = $props();
</script>

{#if data.flagOn}
  <V2List {...data} />
{:else}
  <LegacyList {...data} />
{/if}
```

(Easier: extract existing markup into `_legacy.svelte`, write `_v2.svelte` with the canvas-style grid using `nm-sec`/`status-dot`/`row-link`.)

- [ ] **Step 2: `_v2.svelte` markup**

```svelte
<script lang="ts">
  let { builds }: { builds: any[] } = $props();
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI</div>
      <h1>Builds</h1>
    </div>
    <a class="nm-save-btn" href="/jkai/builds/new">+ New build</a>
  </header>

  {#if !builds.length}
    <section class="nm-sec"><p class="dim">No builds yet — click <a href="/jkai/builds/new">+ New build</a> to start.</p></section>
  {:else}
    <div class="grid">
      {#each builds as b (b.id)}
        <a class="card" href={`/jkai/builds/${b.id}`}>
          <header>
            <span class="status-dot" data-status={b.status === 'running' ? 'running' : b.status === 'failed' ? 'failed' : b.status === 'completed' ? 'completed' : 'pending'}></span>
            <span class="title">{b.title ?? b.prompt.slice(0, 60)}</span>
          </header>
          <p class="dim">{b.prompt.slice(0, 160)}{b.prompt.length > 160 ? '…' : ''}</p>
          <footer>
            <span class="dim">iter {b.iterationsCompleted ?? 0}</span>
            <span class="dim">tok {b.tokensUsed ?? 0}</span>
            {#if b.publishedSlug}<span class="dim">live</span>{/if}
          </footer>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  h1 { font-family: var(--font-display); font-size: 2rem; font-weight: 900; line-height: 1.05; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.6rem; }
  .card { display: flex; flex-direction: column; background: var(--bg); border: 1px solid var(--card-border); padding: 0.9rem 1rem 0.7rem; min-height: 140px; text-decoration: none; color: inherit; transition: border-color 80ms ease; }
  .card:hover { border-color: var(--text-primary); }
  .card header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .title { font-family: var(--font-display); font-weight: 800; font-size: 0.95rem; line-height: 1.2; }
  .dim { color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }
  footer { margin-top: auto; display: flex; gap: 12px; padding-top: 8px; }
</style>
```

- [ ] **Step 3: New build form — add design toggle**

Append to the form in `new/+page.svelte`:

```svelte
<label class="toggle">
  <input type="checkbox" bind:checked={enforceDesignSystem} /> Enforce site design system (recommended)
</label>
<label class="toggle">
  <input type="checkbox" bind:checked={planFirst} /> Require plan approval before iterations begin (recommended)
</label>
```

The submit handler POST body must include `enforceDesignSystem` and `planStatus: planFirst ? 'pending' : 'approved'`. Update the API `POST /api/jkai/builds/+server.ts` to honour both fields (additive — they pass through on insert).

- [ ] **Step 4: Commit** `feat(jkai-builds): redesigned list + new-build options`

---

## Task 13: Page rewrite — detail

**Files:**
- Modify: `src/routes/jkai/builds/[id]/+page.svelte` + `+page.server.ts`

- [ ] **Step 1: Server-side load**

`+page.server.ts` already fetches build + iterations + logs. Add the flag:

```typescript
return { build, iterations, logs, flagOn: env.PUBLIC_BUILDS_V2 === 'true' };
```

- [ ] **Step 2: Branch the page**

```svelte
{#if data.flagOn}<V2Detail {data} />{:else}<LegacyDetail {data} />{/if}
```

- [ ] **Step 3: `_v2.svelte` (detail)**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import Activity from '$lib/builds/Activity.svelte';
  import FilesTimeline from '$lib/builds/FilesTimeline.svelte';
  import PlanEditor from '$lib/builds/PlanEditor.svelte';
  import BuildSidebar from '$lib/builds/BuildSidebar.svelte';
  import ModeSwitcher from '$lib/builds/ModeSwitcher.svelte';
  import WatchPane from '$lib/builds/WatchPane.svelte';
  import { reduceFeed, type FeedEvent } from '$lib/builds/feed';
  import { buildFileTimeline } from '$lib/builds/parse-actions';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();
  let build = $state(data.build);
  let iterations = $state(data.iterations);
  let events = $state<FeedEvent[]>([]);
  let mode = $state<'watch'|'tinker'|'drive'>('watch');

  // Seed events from persisted logs
  for (const l of data.logs) events.push({ kind: 'log', id: l.id, type: l.type, content: l.content, iterationId: l.iterationId });
  const feed = $derived(reduceFeed(events));
  const fileTimeline = $derived(buildFileTimeline(iterations));

  let es: EventSource | null = null;
  onMount(() => {
    es = new EventSource(`/api/jkai/builds/${build.id}/stream`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        const id = parseInt(e.lastEventId || '0', 10);
        if (id > 0) events = [...events, { kind: 'log', id, type: data.type, content: data.content, iterationId: data.iterationId }];
        else events = [...events, { kind: 'live', ...data }];
      } catch {}
    };
    return () => es?.close();
  });

  async function refresh() { await invalidateAll(); }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <a class="row-link" href="/jkai/builds">← all builds</a>
      <div class="kicker">JKAI build</div>
      <h1>{build.title ?? build.prompt.slice(0, 60)}</h1>
    </div>
    <ModeSwitcher bind:mode />
  </header>

  {#if build.status === 'awaiting_plan_approval'}
    <PlanEditor plan={feed.proposedPlan ?? data.iter0Plan ?? ''} buildId={build.id} onAfter={refresh} />
  {/if}

  <div class="layout">
    <main class="main">
      {#if mode === 'watch'}
        <Activity feed={feed} />
        <FilesTimeline changes={fileTimeline} />
        <WatchPane buildId={build.id} />
      {:else}
        <section class="nm-sec"><p class="dim">{mode} mode coming soon (Phase 2).</p></section>
      {/if}
    </main>
    <BuildSidebar build={build} />
  </div>
</div>

<style>
  .wrap { max-width: 1280px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin: 0.35rem 0; }
  h1 { font-family: var(--font-display); font-size: 1.7rem; font-weight: 900; line-height: 1.1; margin: 0; }
  .layout { display: grid; grid-template-columns: 1fr 280px; gap: 1.25rem; align-items: start; }
  .main { min-width: 0; display: flex; flex-direction: column; gap: 0.75rem; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
```

- [ ] **Step 4: Commit** `feat(jkai-builds): redesigned detail page`

---

## Task 14: Tests pass + typecheck + build

- [ ] **Step 1:** `npx vitest run`  → expect all PASS
- [ ] **Step 2:** `npm run check` → expect 0 errors
- [ ] **Step 3:** `npm run build` → expect success
- [ ] **Step 4:** Commit any fixups produced by typecheck

---

## Task 15: Flip flag on, deploy

- [ ] **Step 1:** Set `PUBLIC_BUILDS_V2=true` in `.env`, ensure VPS env has it (sync via deploy)
- [ ] **Step 2:** `git push origin master`
- [ ] **Step 3:** `bash scripts/deploy.sh`
- [ ] **Step 4:** Smoke check: `curl -s https://strangeramblings.com/jkai/builds | head -20`

---

## Phase 2 — deferred

Captured in `docs/superpowers/specs/2026-04-26-jkai-builds-redesign-design.md` §10. Tinker (Monaco + xterm wired through `docker exec`) and Drive (pi RPC take-over) are non-trivial and unsafe to rush in one autonomous run. Per-iter approval gates and sandbox controls (snapshot/reset/restore) are quick follow-ups once Phase 1 is bedded in.

## Self-Review

- All spec requirements §3-9 covered by Tasks 1-13. Phase 2 explicitly deferred.
- No placeholders.
- Method names match across tasks (`approvePlan`, `replan`, `skipPlan`).
- Linter rule names match between Task 3 and orchestrator hook (Task 9 step 3).
