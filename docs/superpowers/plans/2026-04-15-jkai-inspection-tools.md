# JKAI Inspection & Update Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give jkai the ability to inspect and surgically update everything it creates — workflows, builds, research, and blog posts — by splitting the monolithic tool registry into domain-scoped modules and adding 27 new tools.

**Architecture:** Refactor `src/lib/workflows/site-tools/registry.ts` into a slim coordinator that imports domain modules from `src/lib/workflows/site-tools/tools/`. Each domain module registers its tools at import time via the existing `register()` function. New tools follow the hybrid inspection pattern: summary-level inspect tools plus drill-down tools for detail.

**Tech Stack:** SvelteKit, Drizzle ORM (PostgreSQL), OpenAI-compatible LLM client (Z.AI), Tavily search API, Vitest

---

### Task 1: Refactor Registry into Slim Coordinator

**Files:**
- Modify: `src/lib/workflows/site-tools/registry.ts`

The registry currently contains ~440 lines: the `ToolDefinition` interface, `register()`, all 22 tool registrations, and the public API. Strip it down to just the framework + imports.

- [ ] **Step 1: Read the current registry and understand the structure**

The file has these sections:
1. `ToolDefinition` interface and `tools` array (lines 1-35)
2. Tool registrations grouped by category (lines 37-383)
3. Public API functions (lines 385-442)

- [ ] **Step 2: Rewrite registry.ts as slim coordinator**

```typescript
// src/lib/workflows/site-tools/registry.ts
import { db } from '$lib/db';

// ==========================================
// Tool Registry — Slim Coordinator
// ==========================================

type ToolResult = { success: boolean; data?: unknown; error?: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  category: string;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const tools: ToolDefinition[] = [];

export function register(tool: ToolDefinition) {
  tools.push(tool);
}

// --- Load all domain modules (each calls register() on import) ---
import './tools/health';
import './tools/blog';
import './tools/builds';
import './tools/research';
import './tools/whatsapp';
import './tools/workflows';

// --- Public API ---

export function getTools(): readonly ToolDefinition[] {
  return tools;
}

export function getToolDefinitions() {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { success: false, error: `Unknown tool: ${name}` };
  try {
    return await tool.handler(args);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export function isRegisteredTool(name: string): boolean {
  return tools.some((t) => t.name === name);
}

export function buildSystemPromptSection(): string {
  const categories = new Map<string, string[]>();
  for (const t of tools) {
    if (!categories.has(t.category)) categories.set(t.category, []);
    categories.get(t.category)!.push(t.name);
  }

  const lines = [
    '\n\n--- Site Capabilities ---',
    "You have access to the following tools on the user's personal platform (strangeramblings.com):\n",
  ];
  for (const [category, names] of categories) {
    lines.push(`**${category}** (${names.join(', ')})`);
  }

  lines.push('');
  lines.push("John's WhatsApp number: +447359228511");

  return lines.join('\n');
}
```

- [ ] **Step 3: Create the tools/ directory**

Run: `mkdir -p src/lib/workflows/site-tools/tools`

- [ ] **Step 4: Verify the build still passes**

Run: `cd ~/strange_rambling_svelte && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20`

This will fail because the domain modules don't exist yet. That's expected — we'll create them in the next tasks.

- [ ] **Step 5: Commit the registry refactor (skeleton)**

```bash
git add src/lib/workflows/site-tools/registry.ts
git commit -m "refactor: slim down tool registry to coordinator-only"
```

---

### Task 2: Health & WhatsApp Domain Modules (Move Existing Tools)

**Files:**
- Create: `src/lib/workflows/site-tools/tools/health.ts`
- Create: `src/lib/workflows/site-tools/tools/whatsapp.ts`

Move the existing health and WhatsApp tools verbatim from the old registry, just updating the import path for `register` and renaming tool names (drop `site_` prefix for health).

- [ ] **Step 1: Create health.ts**

```typescript
// src/lib/workflows/site-tools/tools/health.ts
import { register } from '../registry';

register({
  name: 'health_stats',
  description: 'Get weekly health metrics (activity count, distance, duration, elevation, recovery score, sleep average) and all-time personal records',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getStats } = await import('$lib/health/stats-service');
    return { success: true, data: await getStats() };
  },
});

register({
  name: 'health_readiness',
  description: 'Get composite readiness score with recovery, HRV trend, sleep quality, load balance factors, zone classification, and recommendation',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getReadiness } = await import('$lib/health/readiness-service');
    return { success: true, data: await getReadiness() };
  },
});

register({
  name: 'health_sleep',
  description: 'Get latest sleep analysis (duration, light/deep/REM percentages, performance score) and 14-day trend',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getSleepAnalysis } = await import('$lib/health/sleep-analysis-service');
    return { success: true, data: await getSleepAnalysis() };
  },
});

register({
  name: 'health_training_load',
  description: 'Get training load analysis: acute/chronic load ratio, zone (optimal/caution/danger), 30-day history',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getTrainingLoad } = await import('$lib/health/training-load-service');
    return { success: true, data: await getTrainingLoad() };
  },
});

register({
  name: 'health_timeline',
  description: 'Get paginated timeline of recent health events (activities, workouts, sleep, recovery)',
  parameters: {
    type: 'object',
    properties: {
      page: { type: 'number', description: 'Page number (default 1)' },
      limit: { type: 'number', description: 'Items per page (default 20)' },
    },
  },
  category: 'Health Data',
  handler: async (args) => {
    const { getTimeline } = await import('$lib/health/timeline-service');
    const page = (args.page as number) || 1;
    const limit = (args.limit as number) || 20;
    return { success: true, data: await getTimeline(page, limit) };
  },
});
```

- [ ] **Step 2: Create whatsapp.ts**

```typescript
// src/lib/workflows/site-tools/tools/whatsapp.ts
import { register } from '../registry';

register({
  name: 'whatsapp_send',
  description: 'Send a WhatsApp message to a phone number. Use this to proactively message the user or send alerts/notifications.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Phone number with country code (e.g. "+447359228511")' },
      message: { type: 'string', description: 'Message text to send' },
    },
    required: ['to', 'message'],
  },
  category: 'WhatsApp',
  handler: async (args) => {
    const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
    const wa = getWhatsAppService();
    const result = await wa.sendMessage(args.to as string, args.message as string);
    return { success: result.sent, data: result };
  },
});
```

- [ ] **Step 3: Verify these two modules compile**

Run: `cd ~/strange_rambling_svelte && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20`

Still expected to fail (blog/builds/research/workflows modules missing). But check no errors from health.ts or whatsapp.ts specifically.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/site-tools/tools/health.ts src/lib/workflows/site-tools/tools/whatsapp.ts
git commit -m "feat: move health and whatsapp tools to domain modules"
```

---

### Task 3: Blog Domain Module (Existing + Unpublish)

**Files:**
- Create: `src/lib/workflows/site-tools/tools/blog.ts`

Move existing blog tools with renamed names, add `blog_unpublish`.

- [ ] **Step 1: Create blog.ts**

```typescript
// src/lib/workflows/site-tools/tools/blog.ts
import { register } from '../registry';
import { db } from '$lib/db';
import { blogPosts } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

register({
  name: 'blog_list',
  description: 'List blog posts with title, slug, status (draft/published), excerpt, and timestamps',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'Filter by status: "draft" or "published". Omit for all.' },
    },
  },
  category: 'Blog',
  handler: async () => {
    const rows = await db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'blog_get',
  description: 'Get full blog post content, tags, and metadata by ID',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Blog post ID' } },
    required: ['id'],
  },
  category: 'Blog',
  handler: async (args) => {
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, args.id as string)).limit(1);
    return post ? { success: true, data: post } : { success: false, error: 'Post not found' };
  },
});

register({
  name: 'blog_create',
  description: 'Create a new blog post',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Post title' },
      content: { type: 'string', description: 'Post content (markdown or HTML)' },
      status: { type: 'string', description: '"draft" (default) or "published"' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tag names' },
    },
    required: ['title', 'content'],
  },
  category: 'Blog',
  handler: async (args) => {
    const [post] = await db.insert(blogPosts).values({
      title: args.title as string,
      content: args.content as string,
      status: (args.status as string) || 'draft',
    }).returning();
    return { success: true, data: post };
  },
});

register({
  name: 'blog_update',
  description: 'Update an existing blog post (title, content, status, tags)',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Blog post ID' },
      title: { type: 'string', description: 'New title' },
      content: { type: 'string', description: 'New content' },
      status: { type: 'string', description: '"draft" or "published"' },
      tags: { type: 'array', items: { type: 'string' }, description: 'New tag names (replaces existing)' },
    },
    required: ['id'],
  },
  category: 'Blog',
  handler: async (args) => {
    const updates: Record<string, unknown> = {};
    if (args.title) updates.title = args.title;
    if (args.content) updates.content = args.content;
    if (args.status) updates.status = args.status;
    const [post] = await db.update(blogPosts).set(updates).where(eq(blogPosts.id, args.id as string)).returning();
    return post ? { success: true, data: post } : { success: false, error: 'Post not found' };
  },
});

register({
  name: 'blog_unpublish',
  description: 'Unpublish a blog post — sets its status back to draft',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Blog post ID' } },
    required: ['id'],
  },
  category: 'Blog',
  handler: async (args) => {
    const [post] = await db
      .update(blogPosts)
      .set({ status: 'draft' })
      .where(eq(blogPosts.id, args.id as string))
      .returning();
    return post ? { success: true, data: post } : { success: false, error: 'Post not found' };
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/site-tools/tools/blog.ts
git commit -m "feat: move blog tools to domain module, add blog_unpublish"
```

---

### Task 4: Builds Domain Module (Existing + New Inspection + Update Tools)

**Files:**
- Create: `src/lib/workflows/site-tools/tools/builds.ts`

This is the largest domain module. Includes moved existing tools (renamed) plus 9 new tools for inspection and manipulation.

- [ ] **Step 1: Create builds.ts with existing tools (renamed)**

```typescript
// src/lib/workflows/site-tools/tools/builds.ts
import { register } from '../registry';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { desc, eq, and, asc } from 'drizzle-orm';

// ==========================================
// Existing Tools (renamed)
// ==========================================

register({
  name: 'build_create',
  description: 'Start a new JKAI autonomous build. Provide a prompt describing what to build.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What to build (e.g. "a countdown timer app")' },
      title: { type: 'string', description: 'Build title (auto-generated if omitted)' },
    },
    required: ['prompt'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const { orchestrator } = await import('$lib/jkai/orchestrator');
    const [build] = await db.insert(jkaiBuilds).values({
      title: (args.title as string) || null,
      prompt: args.prompt as string,
      budgetConfig: {},
    }).returning();
    await orchestrator.startBuild(build.id);
    return { success: true, data: build };
  },
});

register({
  name: 'build_list',
  description: 'List recent JKAI builds with status (pending/running/completed/failed)',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'JKAI Builder',
  handler: async () => {
    const rows = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'build_control',
  description: 'Control a JKAI build: pause, resume, stop, or publish it',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Build ID' },
      action: { type: 'string', description: 'Action: "pause", "resume", "stop", or "publish"' },
    },
    required: ['id', 'action'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const { orchestrator } = await import('$lib/jkai/orchestrator');
    const action = args.action as string;
    const id = args.id as string;
    if (action === 'pause') await orchestrator.pauseBuild(id);
    else if (action === 'resume') await orchestrator.resumeBuild(id);
    else if (action === 'stop') await orchestrator.stopBuild(id);
    else if (action === 'publish') {
      const { publishBuild } = await import('$lib/jkai/sandbox');
      const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, id)).limit(1);
      if (!build) return { success: false, error: 'Build not found' };
      const slug = build.publishedSlug || build.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) || id.slice(0, 8);
      await publishBuild(id, slug);
      await db.update(jkaiBuilds).set({ publishedSlug: slug, updatedAt: new Date() }).where(eq(jkaiBuilds.id, id));
      return { success: true, data: { slug, url: `https://strangeramblings.com/projects/jkai/${slug}/` } };
    } else {
      return { success: false, error: `Unknown action: ${action}` };
    }
    return { success: true, data: { action, id } };
  },
});

// ==========================================
// Inspection Tools
// ==========================================

register({
  name: 'build_inspect',
  description: 'Full build overview — status, prompt, config, all iterations (number, status, goals, evaluation summary, duration, tokens), serve config, published URL',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Build ID' } },
    required: ['id'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, args.id as string)).limit(1);
    if (!build) return { success: false, error: 'Build not found' };

    const iterations = await db
      .select({
        number: jkaiIterations.number,
        status: jkaiIterations.status,
        goals: jkaiIterations.goals,
        evaluation: jkaiIterations.evaluation,
        tokensUsed: jkaiIterations.tokensUsed,
        durationMs: jkaiIterations.durationMs,
        createdAt: jkaiIterations.createdAt,
      })
      .from(jkaiIterations)
      .where(eq(jkaiIterations.buildId, build.id))
      .orderBy(asc(jkaiIterations.number));

    return {
      success: true,
      data: {
        ...build,
        iterations,
        publishedUrl: build.publishedSlug
          ? `https://strangeramblings.com/projects/jkai/${build.publishedSlug}/`
          : null,
      },
    };
  },
});

register({
  name: 'build_get_iteration',
  description: 'Deep dive into a specific build iteration — full plan, actions (commands + output), messages (LLM conversation), evaluation, next steps, tokens, duration',
  parameters: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Build ID' },
      number: { type: 'number', description: 'Iteration number (0 = planning phase)' },
    },
    required: ['buildId', 'number'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const [iteration] = await db
      .select()
      .from(jkaiIterations)
      .where(
        and(
          eq(jkaiIterations.buildId, args.buildId as string),
          eq(jkaiIterations.number, args.number as number),
        ),
      )
      .limit(1);
    if (!iteration) return { success: false, error: `Iteration ${args.number} not found for build ${args.buildId}` };
    return { success: true, data: iteration };
  },
});

register({
  name: 'build_get_plan',
  description: 'Get the planning phase (iteration 0) — the proposer/critic/reviser debate, final plan, and goals',
  parameters: {
    type: 'object',
    properties: { buildId: { type: 'string', description: 'Build ID' } },
    required: ['buildId'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const [iteration] = await db
      .select()
      .from(jkaiIterations)
      .where(
        and(
          eq(jkaiIterations.buildId, args.buildId as string),
          eq(jkaiIterations.number, 0),
        ),
      )
      .limit(1);
    if (!iteration) return { success: false, error: 'Planning phase not found — build may not have started yet' };
    return {
      success: true,
      data: {
        goals: iteration.goals,
        plan: iteration.plan,
        messages: iteration.messages,
        status: iteration.status,
        tokensUsed: iteration.tokensUsed,
        durationMs: iteration.durationMs,
      },
    };
  },
});

register({
  name: 'build_get_logs',
  description: 'Get recent logs for a build (types: thinking, text, code, output, error, system). Most recent first.',
  parameters: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Build ID' },
      limit: { type: 'number', description: 'Max logs to return (default 50)' },
      type: { type: 'string', description: 'Filter by log type (e.g. "error", "code", "system"). Omit for all.' },
    },
    required: ['buildId'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const buildId = args.buildId as string;
    const limit = (args.limit as number) || 50;
    const type = args.type as string | undefined;

    let query = db
      .select()
      .from(jkaiLogs)
      .where(
        type
          ? and(eq(jkaiLogs.buildId, buildId), eq(jkaiLogs.type, type))
          : eq(jkaiLogs.buildId, buildId),
      )
      .orderBy(desc(jkaiLogs.createdAt))
      .limit(limit);

    const rows = await query;
    return { success: true, data: rows };
  },
});

register({
  name: 'build_list_files',
  description: 'List files in a build workspace (dev or live space)',
  parameters: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Build ID' },
      space: { type: 'string', description: '"dev" (default) or "live"' },
    },
    required: ['buildId'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const { execInSandboxChecked } = await import('$lib/jkai/sandbox');
    const buildId = args.buildId as string;
    const space = (args.space as string) || 'dev';
    const dir = `/home/jkai/workspace/${buildId}/${space}`;
    const result = await execInSandboxChecked(
      `find ${dir} -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100 | sed 's|${dir}/||'`,
    );
    if (result.exitCode !== 0) return { success: false, error: result.stderr || 'Failed to list files' };
    const files = result.stdout.trim().split('\n').filter(Boolean);
    return { success: true, data: { space, files, count: files.length } };
  },
});

register({
  name: 'build_read_file',
  description: 'Read a specific file from a build workspace',
  parameters: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Build ID' },
      path: { type: 'string', description: 'File path relative to workspace root (e.g. "index.html", "src/app.js")' },
      space: { type: 'string', description: '"dev" (default) or "live"' },
    },
    required: ['buildId', 'path'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const { execInSandboxChecked } = await import('$lib/jkai/sandbox');
    const buildId = args.buildId as string;
    const space = (args.space as string) || 'dev';
    const filePath = `/home/jkai/workspace/${buildId}/${space}/${args.path as string}`;
    const result = await execInSandboxChecked(`cat ${filePath}`);
    if (result.exitCode !== 0) return { success: false, error: result.stderr || 'File not found' };
    return { success: true, data: { path: args.path, content: result.stdout } };
  },
});

// ==========================================
// Update Tools
// ==========================================

register({
  name: 'build_tweak',
  description: 'Inject a specific improvement instruction into a build. The build resumes with this new objective appended. Use for targeted changes like "change the colour scheme" or "add error handling".',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Build ID' },
      instruction: { type: 'string', description: 'What to change or improve' },
    },
    required: ['id', 'instruction'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const { orchestrator } = await import('$lib/jkai/orchestrator');
    await orchestrator.continueBuild(args.id as string, args.instruction as string);
    return { success: true, data: { id: args.id, instruction: args.instruction } };
  },
});

register({
  name: 'build_write_file',
  description: 'Write or update a file in a build workspace directly',
  parameters: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Build ID' },
      path: { type: 'string', description: 'File path relative to workspace root' },
      content: { type: 'string', description: 'File content to write' },
      space: { type: 'string', description: '"dev" (default) or "live"' },
    },
    required: ['buildId', 'path', 'content'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const { writeFileInSandbox, ensureWorkspace } = await import('$lib/jkai/sandbox');
    const buildId = args.buildId as string;
    const space = (args.space as string) || 'dev';
    // Ensure the workspace exists
    if (space === 'dev') await ensureWorkspace(buildId);
    const filePath = `/home/jkai/workspace/${buildId}/${space}/${args.path as string}`;
    // Ensure parent directory exists
    const { execInSandboxChecked } = await import('$lib/jkai/sandbox');
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    await execInSandboxChecked(`mkdir -p ${dir}`);
    const result = await writeFileInSandbox(filePath, args.content as string);
    if (result.exitCode !== 0) return { success: false, error: result.stderr || 'Failed to write file' };
    return { success: true, data: { path: args.path, space } };
  },
});

register({
  name: 'build_delete',
  description: 'Delete a build and all its iterations, logs, and workspace files',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Build ID' } },
    required: ['id'],
  },
  category: 'JKAI Builder',
  handler: async (args) => {
    const id = args.id as string;
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, id)).limit(1);
    if (!build) return { success: false, error: 'Build not found' };

    // Unpublish if published
    if (build.publishedSlug) {
      const { unpublishBuild } = await import('$lib/jkai/sandbox');
      await unpublishBuild(build.publishedSlug);
    }

    // Clean up sandbox workspace
    const { execInSandbox } = await import('$lib/jkai/sandbox');
    await execInSandbox(`rm -rf /home/jkai/workspace/${id}`).catch(() => {});

    // Delete from DB (cascades to iterations and logs)
    await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, id));
    return { success: true, data: { deleted: true, title: build.title } };
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/site-tools/tools/builds.ts
git commit -m "feat: builds domain module with inspect, iteration, logs, file, tweak, and delete tools"
```

---

### Task 5: Workflows Domain Module (Existing + New Inspection + Update Tools)

**Files:**
- Create: `src/lib/workflows/site-tools/tools/workflows.ts`

The largest tool count (15). Includes existing create/list/delete, new inspection (inspect, get_run, get_generation_log), and full CRUD for nodes, edges, and schedules.

- [ ] **Step 1: Create workflows.ts**

```typescript
// src/lib/workflows/site-tools/tools/workflows.ts
import { register } from '../registry';
import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  workflowSchedules,
  nodeExecutions,
  orchestratorChats,
} from '$lib/db/schema';
import { desc, eq, asc, and, or } from 'drizzle-orm';

// ==========================================
// Existing Tools (moved)
// ==========================================

register({
  name: 'workflow_create',
  description: 'Create an automated workflow from a natural language description. Use this when the user needs something that runs automatically or on a schedule — things like "every morning send me a health summary", "check X every hour and notify me". The workflow engine supports: manual-trigger (with cron scheduling), WhatsApp messaging, Home Assistant queries/control, LLM calls, code execution, Strava, blog, email, loops, data stores, conditionals, and more. The trigger node is always manual-trigger (supports cron schedules). For event-driven HA automations, create a scheduled workflow that polls state. After creating, share the returned URL as a clickable markdown link: [Review workflow](url).',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Natural language description of what the workflow should do. Be specific about triggers, conditions, and actions.' },
    },
    required: ['description'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const { generateWorkflow } = await import('$lib/workflows/orchestrator');

    const description = args.description as string;
    const { workflow, followUp } = await generateWorkflow(description, null);

    if (followUp) {
      return { success: true, data: { needsMoreInfo: true, question: followUp } };
    }

    if (!workflow || workflow.nodes.length === 0) {
      return { success: false, error: 'Could not generate a valid workflow. Try being more specific about what triggers it and what it should do.' };
    }

    const [created] = await db.insert(workflows).values({
      name: workflow.name || 'Generated Workflow',
      description: workflow.description || null,
    }).returning();

    try {
      await db.insert(workflowNodes).values(
        workflow.nodes.map((n) => ({ id: n.id, workflowId: created.id, type: n.type, position: n.position, config: n.config, label: n.label })),
      );
      if (workflow.edges.length > 0) {
        await db.insert(workflowEdges).values(
          workflow.edges.map((e) => ({ id: e.id, workflowId: created.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null })),
        );
      }
    } catch (dbErr: unknown) {
      await db.delete(workflows).where(eq(workflows.id, created.id));
      const dbMsg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
      return { success: false, error: `Failed to save workflow: ${dbMsg}` };
    }

    return {
      success: true,
      data: {
        workflowId: created.id,
        name: workflow.name,
        description: workflow.description,
        explanation: workflow.explanation,
        nodeCount: workflow.nodes.length,
        url: `https://strangeramblings.com/workflows/${created.id}`,
      },
    };
  },
});

register({
  name: 'workflow_list',
  description: 'List existing workflows with their names, descriptions, and schedule status',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Workflows',
  handler: async () => {
    const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'workflow_delete',
  description: 'Delete a workflow by ID. Use when the user asks to remove or clean up a workflow.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Workflow ID to delete' } },
    required: ['id'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const [existing] = await db.select().from(workflows).where(eq(workflows.id, args.id as string)).limit(1);
    if (!existing) return { success: false, error: 'Workflow not found' };
    await db.delete(workflows).where(eq(workflows.id, args.id as string));
    return { success: true, data: { deleted: true, name: existing.name } };
  },
});

// ==========================================
// Inspection Tools
// ==========================================

register({
  name: 'workflow_inspect',
  description: 'Full structural view of a workflow — metadata, all nodes (type, label, config), all edges (connections), schedules, and last 5 execution runs',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Workflow ID' } },
    required: ['id'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const id = args.id as string;
    const [wf] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!wf) return { success: false, error: 'Workflow not found' };

    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, id));
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id));
    const schedules = await db.select().from(workflowSchedules).where(eq(workflowSchedules.workflowId, id));
    const recentRuns = await db
      .select({
        id: workflowRuns.id,
        status: workflowRuns.status,
        trigger: workflowRuns.trigger,
        startedAt: workflowRuns.startedAt,
        completedAt: workflowRuns.completedAt,
        error: workflowRuns.error,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, id))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(5);

    return {
      success: true,
      data: {
        ...wf,
        nodes,
        edges,
        schedules,
        recentRuns,
        url: `https://strangeramblings.com/workflows/${id}`,
      },
    };
  },
});

register({
  name: 'workflow_get_run',
  description: 'Drill into a specific workflow execution run — per-node inputs, outputs, errors, timing, and logs',
  parameters: {
    type: 'object',
    properties: { runId: { type: 'string', description: 'Run ID (from workflow_inspect recentRuns)' } },
    required: ['runId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const runId = args.runId as string;
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!run) return { success: false, error: 'Run not found' };

    const executions = await db
      .select()
      .from(nodeExecutions)
      .where(eq(nodeExecutions.runId, runId))
      .orderBy(asc(nodeExecutions.startedAt));

    // Enrich with node labels
    const nodeIds = executions.map((e) => e.nodeId);
    const nodeMap = new Map<string, string>();
    if (nodeIds.length > 0) {
      const nodeRows = await db
        .select({ id: workflowNodes.id, label: workflowNodes.label })
        .from(workflowNodes)
        .where(or(...nodeIds.map((nid) => eq(workflowNodes.id, nid))));
      for (const n of nodeRows) nodeMap.set(n.id, n.label);
    }

    return {
      success: true,
      data: {
        ...run,
        nodeExecutions: executions.map((e) => ({
          ...e,
          nodeLabel: nodeMap.get(e.nodeId) || e.nodeId,
        })),
      },
    };
  },
});

register({
  name: 'workflow_get_generation_log',
  description: 'Replay how the orchestrator built a workflow — the tool-calling sequence (search_nodes, use_node, connect_nodes, finalize) with reasoning',
  parameters: {
    type: 'object',
    properties: { workflowId: { type: 'string', description: 'Workflow ID' } },
    required: ['workflowId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const rows = await db
      .select()
      .from(orchestratorChats)
      .where(eq(orchestratorChats.workflowId, args.workflowId as string))
      .orderBy(asc(orchestratorChats.createdAt));

    if (rows.length === 0) return { success: false, error: 'No generation log found — this workflow may have been created manually or the log was not retained' };
    return { success: true, data: rows };
  },
});

// ==========================================
// Update Tools — Metadata
// ==========================================

register({
  name: 'workflow_update_metadata',
  description: 'Rename a workflow, update its description, or change its trigger config',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Workflow ID' },
      name: { type: 'string', description: 'New name' },
      description: { type: 'string', description: 'New description' },
      trigger: { type: 'object', description: 'New trigger config (e.g. {"type":"manual"})' },
    },
    required: ['id'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (args.name) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.trigger) updates.trigger = args.trigger;
    const [wf] = await db.update(workflows).set(updates).where(eq(workflows.id, args.id as string)).returning();
    return wf ? { success: true, data: wf } : { success: false, error: 'Workflow not found' };
  },
});

// ==========================================
// Update Tools — Nodes
// ==========================================

register({
  name: 'workflow_update_node',
  description: "Update a workflow node's config, label, or type",
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID' },
      config: { type: 'object', description: 'New config (merged with existing)' },
      label: { type: 'string', description: 'New label' },
      type: { type: 'string', description: 'New node type' },
    },
    required: ['nodeId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const nodeId = args.nodeId as string;
    const [existing] = await db.select().from(workflowNodes).where(eq(workflowNodes.id, nodeId)).limit(1);
    if (!existing) return { success: false, error: 'Node not found' };

    const updates: Record<string, unknown> = {};
    if (args.label) updates.label = args.label;
    if (args.type) updates.type = args.type;
    if (args.config) {
      // Merge config rather than replace — allows partial updates
      updates.config = { ...(existing.config as Record<string, unknown>), ...(args.config as Record<string, unknown>) };
    }

    const [node] = await db.update(workflowNodes).set(updates).where(eq(workflowNodes.id, nodeId)).returning();
    return { success: true, data: node };
  },
});

register({
  name: 'workflow_add_node',
  description: 'Add a new node to a workflow',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID' },
      type: { type: 'string', description: 'Node type (e.g. "whatsapp-message", "llm-call", "code-exec")' },
      label: { type: 'string', description: 'Display label for the node' },
      config: { type: 'object', description: 'Node configuration' },
      position: { type: 'object', description: '{ x, y } canvas position', properties: { x: { type: 'number' }, y: { type: 'number' } } },
    },
    required: ['workflowId', 'type', 'label'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const [node] = await db.insert(workflowNodes).values({
      workflowId: args.workflowId as string,
      type: args.type as string,
      label: args.label as string,
      config: (args.config as Record<string, unknown>) || {},
      position: (args.position as { x: number; y: number }) || { x: 0, y: 0 },
    }).returning();
    return { success: true, data: node };
  },
});

register({
  name: 'workflow_remove_node',
  description: 'Remove a node from a workflow (also removes all connected edges)',
  parameters: {
    type: 'object',
    properties: { nodeId: { type: 'string', description: 'Node ID to remove' } },
    required: ['nodeId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const nodeId = args.nodeId as string;
    const [existing] = await db.select().from(workflowNodes).where(eq(workflowNodes.id, nodeId)).limit(1);
    if (!existing) return { success: false, error: 'Node not found' };

    // Edges are cascade-deleted by FK, but let's count them for the response
    const connectedEdges = await db
      .select()
      .from(workflowEdges)
      .where(or(eq(workflowEdges.sourceNodeId, nodeId), eq(workflowEdges.targetNodeId, nodeId)));

    await db.delete(workflowNodes).where(eq(workflowNodes.id, nodeId));
    return { success: true, data: { deleted: true, label: existing.label, edgesRemoved: connectedEdges.length } };
  },
});

// ==========================================
// Update Tools — Edges
// ==========================================

register({
  name: 'workflow_add_edge',
  description: 'Connect two nodes in a workflow',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID' },
      sourceNodeId: { type: 'string', description: 'Source node ID' },
      targetNodeId: { type: 'string', description: 'Target node ID' },
      sourceHandle: { type: 'string', description: 'Source handle (e.g. "success", "error"). Omit for default.' },
      targetHandle: { type: 'string', description: 'Target handle. Omit for default.' },
    },
    required: ['workflowId', 'sourceNodeId', 'targetNodeId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const [edge] = await db.insert(workflowEdges).values({
      workflowId: args.workflowId as string,
      sourceNodeId: args.sourceNodeId as string,
      targetNodeId: args.targetNodeId as string,
      sourceHandle: (args.sourceHandle as string) || null,
      targetHandle: (args.targetHandle as string) || null,
    }).returning();
    return { success: true, data: edge };
  },
});

register({
  name: 'workflow_remove_edge',
  description: 'Remove a connection between workflow nodes',
  parameters: {
    type: 'object',
    properties: { edgeId: { type: 'string', description: 'Edge ID' } },
    required: ['edgeId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const [existing] = await db.select().from(workflowEdges).where(eq(workflowEdges.id, args.edgeId as string)).limit(1);
    if (!existing) return { success: false, error: 'Edge not found' };
    await db.delete(workflowEdges).where(eq(workflowEdges.id, args.edgeId as string));
    return { success: true, data: { deleted: true } };
  },
});

register({
  name: 'workflow_update_edge',
  description: 'Change an edge\'s routing — reconnect to different nodes or change handles',
  parameters: {
    type: 'object',
    properties: {
      edgeId: { type: 'string', description: 'Edge ID' },
      sourceNodeId: { type: 'string', description: 'New source node ID' },
      targetNodeId: { type: 'string', description: 'New target node ID' },
      sourceHandle: { type: 'string', description: 'New source handle' },
      targetHandle: { type: 'string', description: 'New target handle' },
    },
    required: ['edgeId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const edgeId = args.edgeId as string;
    const updates: Record<string, unknown> = {};
    if (args.sourceNodeId) updates.sourceNodeId = args.sourceNodeId;
    if (args.targetNodeId) updates.targetNodeId = args.targetNodeId;
    if (args.sourceHandle !== undefined) updates.sourceHandle = args.sourceHandle || null;
    if (args.targetHandle !== undefined) updates.targetHandle = args.targetHandle || null;
    const [edge] = await db.update(workflowEdges).set(updates).where(eq(workflowEdges.id, edgeId)).returning();
    return edge ? { success: true, data: edge } : { success: false, error: 'Edge not found' };
  },
});

// ==========================================
// Update Tools — Schedules
// ==========================================

register({
  name: 'workflow_add_schedule',
  description: 'Add a cron schedule to a workflow',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID' },
      type: { type: 'string', description: 'Schedule type (e.g. "cron")' },
      config: { type: 'object', description: 'Schedule config (e.g. { "cron": "0 8 * * *" } for daily at 8am)' },
    },
    required: ['workflowId', 'type', 'config'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const [schedule] = await db.insert(workflowSchedules).values({
      workflowId: args.workflowId as string,
      type: args.type as string,
      config: args.config as Record<string, unknown>,
    }).returning();
    return { success: true, data: schedule };
  },
});

register({
  name: 'workflow_update_schedule',
  description: 'Enable/disable a schedule or change its cron config',
  parameters: {
    type: 'object',
    properties: {
      scheduleId: { type: 'string', description: 'Schedule ID' },
      enabled: { type: 'boolean', description: 'Enable or disable' },
      config: { type: 'object', description: 'New schedule config' },
    },
    required: ['scheduleId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const updates: Record<string, unknown> = {};
    if (args.enabled !== undefined) updates.enabled = args.enabled;
    if (args.config) updates.config = args.config;
    const [schedule] = await db
      .update(workflowSchedules)
      .set(updates)
      .where(eq(workflowSchedules.id, args.scheduleId as string))
      .returning();
    return schedule ? { success: true, data: schedule } : { success: false, error: 'Schedule not found' };
  },
});

register({
  name: 'workflow_remove_schedule',
  description: 'Remove a schedule from a workflow',
  parameters: {
    type: 'object',
    properties: { scheduleId: { type: 'string', description: 'Schedule ID' } },
    required: ['scheduleId'],
  },
  category: 'Workflows',
  handler: async (args) => {
    const [existing] = await db.select().from(workflowSchedules).where(eq(workflowSchedules.id, args.scheduleId as string)).limit(1);
    if (!existing) return { success: false, error: 'Schedule not found' };
    await db.delete(workflowSchedules).where(eq(workflowSchedules.id, args.scheduleId as string));
    return { success: true, data: { deleted: true } };
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/site-tools/tools/workflows.ts
git commit -m "feat: workflows domain module with inspect, run detail, generation log, and full node/edge/schedule CRUD"
```

---

### Task 6: Research Domain Module (Existing + Query, Branch, Extract, Web Search)

**Files:**
- Create: `src/lib/workflows/site-tools/tools/research.ts`

The most complex new tools — `research_query` and `research_extract` both call the LLM, `research_branch` creates a child session, and `research_web_search` uses Tavily.

- [ ] **Step 1: Create research.ts**

```typescript
// src/lib/workflows/site-tools/tools/research.ts
import { register } from '../registry';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

// ==========================================
// Existing Tools (moved)
// ==========================================

register({
  name: 'research_start',
  description: 'Start a new Deep Dive research session on a topic',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Research topic' },
      goals: { type: 'array', items: { type: 'string' }, description: 'Specific research goals' },
    },
    required: ['topic'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const { startResearch } = await import('$lib/deepdive/worker');
    const [session] = await db.insert(researchSessions).values({
      topic: args.topic as string,
      goals: (args.goals as string[]) ?? [],
    }).returning();
    startResearch(session.id);
    return { success: true, data: session };
  },
});

register({
  name: 'research_status',
  description: 'Check the status and stats of a research session',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Research session ID' } },
    required: ['id'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    return session ? { success: true, data: session } : { success: false, error: 'Session not found' };
  },
});

register({
  name: 'research_list',
  description: 'List recent research sessions with topic, status, and stats',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Deep Dive Research',
  handler: async () => {
    const rows = await db.select().from(researchSessions).orderBy(desc(researchSessions.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'research_get_report',
  description: 'Get the narrative report/findings from a completed research session',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Research session ID' } },
    required: ['id'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    if (!session) return { success: false, error: 'Session not found' };
    return { success: true, data: { topic: session.topic, status: session.status, report: session.report } };
  },
});

register({
  name: 'research_control',
  description: 'Control a research session: stop it or skip the current phase',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Research session ID' },
      action: { type: 'string', description: '"stop" or "skip"' },
    },
    required: ['id', 'action'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const action = args.action as string;
    if (action === 'stop') {
      await db.update(researchSessions).set({ status: 'cancelled' }).where(eq(researchSessions.id, args.id as string));
    }
    return { success: true, data: { action, id: args.id } };
  },
});

// ==========================================
// Inspection Tools
// ==========================================

register({
  name: 'research_inspect',
  description: 'Full view of a research session — topic, goals, status, config, parent session (if branched), report summary, timestamps',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Research session ID' } },
    required: ['id'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    if (!session) return { success: false, error: 'Session not found' };

    // If it has a parent, fetch parent topic for context
    let parentTopic: string | null = null;
    if (session.parentSessionId) {
      const [parent] = await db
        .select({ topic: researchSessions.topic })
        .from(researchSessions)
        .where(eq(researchSessions.id, session.parentSessionId))
        .limit(1);
      parentTopic = parent?.topic ?? null;
    }

    // Summarise the report if it exists (first 500 chars)
    const report = session.report as Record<string, unknown> | null;
    let reportSummary: string | null = null;
    if (report) {
      const reportStr = typeof report === 'string' ? report : JSON.stringify(report);
      reportSummary = reportStr.length > 500 ? reportStr.slice(0, 500) + '...' : reportStr;
    }

    return {
      success: true,
      data: {
        ...session,
        parentTopic,
        reportSummary,
      },
    };
  },
});

// ==========================================
// Capability Tools
// ==========================================

register({
  name: 'research_query',
  description: 'Ask a question answered from a research session\'s findings. Returns the answer and confidence level. If the research lacks sufficient information, suggests follow-up options (branch research or web search).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Research session ID' },
      question: { type: 'string', description: 'Question to answer from the research' },
    },
    required: ['id', 'question'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    if (!session) return { success: false, error: 'Session not found' };
    if (!session.report) return { success: false, error: 'Session has no report yet — it may still be running' };

    const reportText = typeof session.report === 'string'
      ? session.report
      : JSON.stringify(session.report);

    const { getOpenAIClient, getModel } = await import('$lib/deepdive/keys');
    const client = getOpenAIClient();
    const model = getModel();

    const systemPrompt = `You are answering a question using ONLY the research findings provided below. Do not use any external knowledge.

Research Topic: ${session.topic}
Research Findings:
${reportText}

Instructions:
1. Answer the question using only information from the research above.
2. After your answer, on a new line write exactly one of:
   CONFIDENCE: high — if the research clearly answers this
   CONFIDENCE: low — if the research only partially covers this or you're extrapolating
   CONFIDENCE: none — if the research doesn't contain relevant information
3. If confidence is "low" or "none", on a new line suggest ONE follow-up action:
   SUGGEST: branch "<subtopic>" — to research a specific subtopic in depth
   SUGGEST: web_search "<query>" — for a quick factual lookup`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: args.question as string },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    const text = response.choices[0]?.message?.content?.trim() || '';

    // Parse confidence
    const confidenceMatch = text.match(/CONFIDENCE:\s*(high|low|none)/i);
    const confidence = confidenceMatch ? confidenceMatch[1].toLowerCase() : 'low';

    // Parse suggestion
    const suggestMatch = text.match(/SUGGEST:\s*(branch|web_search)\s+"([^"]+)"/i);
    const suggestions = suggestMatch
      ? [{ type: suggestMatch[1] as 'branch' | 'web_search', description: suggestMatch[2] }]
      : undefined;

    // Clean the answer (remove the metadata lines)
    const answer = text
      .replace(/\nCONFIDENCE:.*$/gm, '')
      .replace(/\nSUGGEST:.*$/gm, '')
      .trim();

    return {
      success: true,
      data: {
        answer,
        confident: confidence === 'high',
        confidence,
        suggestions,
      },
    };
  },
});

register({
  name: 'research_branch',
  description: 'Spawn a focused follow-up research session from an existing one. Inherits the parent\'s findings as seed context and digs deeper into a specific subtopic.',
  parameters: {
    type: 'object',
    properties: {
      parentId: { type: 'string', description: 'Parent research session ID' },
      subtopic: { type: 'string', description: 'Specific subtopic to research deeper' },
      goals: { type: 'array', items: { type: 'string' }, description: 'Specific goals for the branch' },
    },
    required: ['parentId', 'subtopic'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const parentId = args.parentId as string;
    const [parent] = await db.select().from(researchSessions).where(eq(researchSessions.id, parentId)).limit(1);
    if (!parent) return { success: false, error: 'Parent session not found' };

    // Build seed context from parent
    const parentReport = parent.report
      ? typeof parent.report === 'string' ? parent.report : JSON.stringify(parent.report)
      : null;

    const seedContext = {
      parentTopic: parent.topic,
      parentGoals: parent.goals,
      parentFindings: parentReport ? parentReport.slice(0, 3000) : null,
      instruction: `This is a follow-up research session branched from "${parent.topic}". Focus specifically on: ${args.subtopic}. Avoid re-covering ground already established in the parent findings.`,
    };

    const { startResearch } = await import('$lib/deepdive/worker');
    const [session] = await db.insert(researchSessions).values({
      topic: `${args.subtopic} (branched from: ${parent.topic})`,
      goals: (args.goals as string[]) ?? [`Deep dive into: ${args.subtopic}`],
      parentSessionId: parentId,
      seedContext,
    }).returning();

    startResearch(session.id);
    return { success: true, data: session };
  },
});

register({
  name: 'research_extract',
  description: 'Extract findings from a research session into another format: blog_draft, build_prompt, workflow_description, or summary. Optionally focus on a specific area.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Research session ID' },
      format: { type: 'string', description: 'Output format: "blog_draft", "build_prompt", "workflow_description", or "summary"' },
      focus: { type: 'string', description: 'Optional: focus extraction on a specific finding or section' },
    },
    required: ['id', 'format'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const [session] = await db.select().from(researchSessions).where(eq(researchSessions.id, args.id as string)).limit(1);
    if (!session) return { success: false, error: 'Session not found' };
    if (!session.report) return { success: false, error: 'Session has no report yet' };

    const reportText = typeof session.report === 'string'
      ? session.report
      : JSON.stringify(session.report);

    const format = args.format as string;
    const focus = args.focus as string | undefined;

    const formatInstructions: Record<string, string> = {
      blog_draft: 'Write a blog post draft based on these research findings. Use an engaging tone, include key insights, and structure with clear headings. Output in markdown.',
      build_prompt: 'Write a clear, detailed prompt for an autonomous AI builder based on these findings. The prompt should describe exactly what to build, what data sources to use, and what the output should look like.',
      workflow_description: 'Write a natural language description of an automation workflow that could be built based on these findings. Describe the trigger, conditions, and actions clearly.',
      summary: 'Write a concise executive summary of the key findings. Focus on actionable insights and clear conclusions. Keep it under 500 words.',
    };

    const instruction = formatInstructions[format];
    if (!instruction) return { success: false, error: `Unknown format: ${format}. Use: blog_draft, build_prompt, workflow_description, or summary` };

    const { getOpenAIClient, getModel } = await import('$lib/deepdive/keys');
    const client = getOpenAIClient();
    const model = getModel();

    const systemPrompt = `Research Topic: ${session.topic}\n\nResearch Findings:\n${reportText}\n\n${instruction}${focus ? `\n\nFocus specifically on: ${focus}` : ''}`;

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract the research into ${format} format.` },
      ],
      temperature: 0.5,
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content?.trim() || '';
    return { success: true, data: { format, content } };
  },
});

register({
  name: 'research_web_search',
  description: 'Quick web search for a fact-check or to fill a knowledge gap — lighter than starting a full research session. Returns summarised results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      context: { type: 'string', description: 'Optional context to help interpret results (e.g. "related to our research on X")' },
    },
    required: ['query'],
  },
  category: 'Deep Dive Research',
  handler: async (args) => {
    const { search } = await import('$lib/deepdive/tavily');
    const results = await search(args.query as string, { maxResults: 5, searchDepth: 'basic' });

    const summarised = results.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 300),
      score: r.score,
    }));

    return {
      success: true,
      data: {
        query: args.query,
        context: args.context || null,
        results: summarised,
      },
    };
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/workflows/site-tools/tools/research.ts
git commit -m "feat: research domain module with query, branch, extract, and web search tools"
```

---

### Task 7: Update Re-export Shims and Verify Full Build

**Files:**
- Modify: `src/lib/workflows/site-tools/llm-tools.ts`
- Modify: `src/lib/workflows/site-tools/executor.ts`

These files re-export from `registry.ts` for backwards compatibility. They should continue to work since `registry.ts` still exports the same public API. Verify the full project builds.

- [ ] **Step 1: Verify the shim files still work**

Read `src/lib/workflows/site-tools/llm-tools.ts` and `src/lib/workflows/site-tools/executor.ts`. They import from `./registry` which still exports `getToolDefinitions`, `buildSystemPromptSection`, `executeTool`, and `isRegisteredTool`. No changes needed.

- [ ] **Step 2: Run the type checker**

Run: `cd ~/strange_rambling_svelte && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -30`

Fix any type errors that appear. Common issues:
- Missing schema imports (e.g. `orchestratorChats` not exported from schema)
- Drizzle `or()` needs at least one argument

- [ ] **Step 3: Run the build**

Run: `cd ~/strange_rambling_svelte && npm run build 2>&1 | tail -30`

- [ ] **Step 4: Run existing tests**

Run: `cd ~/strange_rambling_svelte && npx vitest run 2>&1 | tail -20`

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type/build issues from tool module refactor"
```

---

### Task 8: Write Tests for New Tool Handlers

**Files:**
- Create: `tests/lib/workflows/site-tools/registry.test.ts`

Test the registry coordinator and a selection of the new tool handlers. Since these tools depend on the database and sandbox, write unit tests for the registry mechanics and integration-style tests for handlers that can be tested without DB (e.g. the research_query LLM parsing logic).

- [ ] **Step 1: Create registry tests**

```typescript
// tests/lib/workflows/site-tools/registry.test.ts
import { describe, it, expect } from 'vitest';
import { getTools, getToolDefinitions, isRegisteredTool, buildSystemPromptSection } from '$lib/workflows/site-tools/registry';

describe('tool registry', () => {
  it('loads all domain modules and registers tools', () => {
    const tools = getTools();
    // Should have all 49 tools from 6 domains
    expect(tools.length).toBeGreaterThanOrEqual(40);
  });

  it('has tools from every domain', () => {
    const tools = getTools();
    const categories = new Set(tools.map((t) => t.category));
    expect(categories.has('Health Data')).toBe(true);
    expect(categories.has('Blog')).toBe(true);
    expect(categories.has('JKAI Builder')).toBe(true);
    expect(categories.has('Workflows')).toBe(true);
    expect(categories.has('Deep Dive Research')).toBe(true);
    expect(categories.has('WhatsApp')).toBe(true);
  });

  it('generates OpenAI-format tool definitions', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      expect(def.type).toBe('function');
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
      expect(def.function.parameters.type).toBe('object');
    }
  });

  it('isRegisteredTool returns true for known tools', () => {
    expect(isRegisteredTool('workflow_inspect')).toBe(true);
    expect(isRegisteredTool('build_inspect')).toBe(true);
    expect(isRegisteredTool('research_query')).toBe(true);
    expect(isRegisteredTool('blog_unpublish')).toBe(true);
    expect(isRegisteredTool('health_stats')).toBe(true);
    expect(isRegisteredTool('whatsapp_send')).toBe(true);
  });

  it('isRegisteredTool returns false for unknown tools', () => {
    expect(isRegisteredTool('nonexistent_tool')).toBe(false);
  });

  it('no duplicate tool names', () => {
    const tools = getTools();
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('system prompt section includes all categories', () => {
    const prompt = buildSystemPromptSection();
    expect(prompt).toContain('Health Data');
    expect(prompt).toContain('Blog');
    expect(prompt).toContain('JKAI Builder');
    expect(prompt).toContain('Workflows');
    expect(prompt).toContain('Deep Dive Research');
    expect(prompt).toContain('WhatsApp');
  });

  // Verify renamed tools exist and old names don't
  it('uses new naming convention (no site_ or jkai_ prefix)', () => {
    expect(isRegisteredTool('health_stats')).toBe(true);
    expect(isRegisteredTool('site_health_stats')).toBe(false);
    expect(isRegisteredTool('build_create')).toBe(true);
    expect(isRegisteredTool('jkai_start_build')).toBe(false);
    expect(isRegisteredTool('blog_list')).toBe(true);
    expect(isRegisteredTool('site_blog_list')).toBe(false);
  });

  // Verify new tools from each domain
  it('has workflow inspection tools', () => {
    expect(isRegisteredTool('workflow_inspect')).toBe(true);
    expect(isRegisteredTool('workflow_get_run')).toBe(true);
    expect(isRegisteredTool('workflow_get_generation_log')).toBe(true);
  });

  it('has workflow update tools', () => {
    expect(isRegisteredTool('workflow_update_metadata')).toBe(true);
    expect(isRegisteredTool('workflow_update_node')).toBe(true);
    expect(isRegisteredTool('workflow_add_node')).toBe(true);
    expect(isRegisteredTool('workflow_remove_node')).toBe(true);
    expect(isRegisteredTool('workflow_add_edge')).toBe(true);
    expect(isRegisteredTool('workflow_remove_edge')).toBe(true);
    expect(isRegisteredTool('workflow_update_edge')).toBe(true);
    expect(isRegisteredTool('workflow_add_schedule')).toBe(true);
    expect(isRegisteredTool('workflow_update_schedule')).toBe(true);
    expect(isRegisteredTool('workflow_remove_schedule')).toBe(true);
  });

  it('has build inspection and update tools', () => {
    expect(isRegisteredTool('build_inspect')).toBe(true);
    expect(isRegisteredTool('build_get_iteration')).toBe(true);
    expect(isRegisteredTool('build_get_plan')).toBe(true);
    expect(isRegisteredTool('build_get_logs')).toBe(true);
    expect(isRegisteredTool('build_list_files')).toBe(true);
    expect(isRegisteredTool('build_read_file')).toBe(true);
    expect(isRegisteredTool('build_tweak')).toBe(true);
    expect(isRegisteredTool('build_write_file')).toBe(true);
    expect(isRegisteredTool('build_delete')).toBe(true);
  });

  it('has research capability tools', () => {
    expect(isRegisteredTool('research_inspect')).toBe(true);
    expect(isRegisteredTool('research_query')).toBe(true);
    expect(isRegisteredTool('research_branch')).toBe(true);
    expect(isRegisteredTool('research_extract')).toBe(true);
    expect(isRegisteredTool('research_web_search')).toBe(true);
  });

  it('has blog_unpublish', () => {
    expect(isRegisteredTool('blog_unpublish')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/site-tools/registry.test.ts 2>&1 | tail -30`

- [ ] **Step 3: Fix any failures and re-run**

- [ ] **Step 4: Commit**

```bash
git add tests/lib/workflows/site-tools/registry.test.ts
git commit -m "test: add registry and tool registration tests for all domain modules"
```

---

### Task 9: Smoke Test via Dev Server

**Files:** None (manual testing)

Start the dev server and verify the chat tools are available and functional.

- [ ] **Step 1: Start the dev server**

Run: `cd ~/strange_rambling_svelte && npm run dev &`

- [ ] **Step 2: Verify tool count in the system prompt**

Open `http://homeserv:5173/jkai` in a browser and start a conversation. Ask jkai "how many tools do you have available?" — it should list tools from all 6 categories.

- [ ] **Step 3: Test workflow inspection**

Ask jkai: "List my workflows, then inspect the first one and tell me what nodes it has." Verify it uses `workflow_list` followed by `workflow_inspect`.

- [ ] **Step 4: Test build inspection**

Ask jkai: "Show me the latest build and its planning phase." Verify it uses `build_list` then `build_get_plan`.

- [ ] **Step 5: Test research query**

If there's an existing research session, ask jkai a question about it. Verify the confidence/suggestion mechanism works.

- [ ] **Step 6: Commit any fixes discovered during testing**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```

---

### Task 10: Final Cleanup and Full Test Suite

- [ ] **Step 1: Run full test suite**

Run: `cd ~/strange_rambling_svelte && npx vitest run 2>&1 | tail -30`

- [ ] **Step 2: Run type check**

Run: `cd ~/strange_rambling_svelte && npm run check 2>&1 | tail -30`

- [ ] **Step 3: Run build**

Run: `cd ~/strange_rambling_svelte && npm run build 2>&1 | tail -30`

- [ ] **Step 4: Final commit if any remaining fixes**

```bash
git add -A
git commit -m "chore: final cleanup for jkai inspection tools"
```
