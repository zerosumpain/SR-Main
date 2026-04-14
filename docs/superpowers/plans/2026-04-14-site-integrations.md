# Site Integrations (Health/Blog, JKAI, Deep Dive) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add health/blog data access, JKAI autonomous builds, and Deep Dive research as LLM function-calling tools for WhatsApp and workflow nodes for the visual editor.

**Architecture:** A shared `site-tools` module provides LLM tool definitions and an executor that calls existing service functions directly (no HTTP — same process). Four new workflow nodes (health-query, blog, jkai, deep-dive) expose these capabilities in the visual editor. The orchestrator bridge merges all tool definitions alongside existing HA tools.

**Tech Stack:** Existing SvelteKit service functions, Drizzle ORM, Vitest

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/workflows/site-tools/llm-tools.ts` | Create | Tool definitions + system prompt section for all site tools |
| `src/lib/workflows/site-tools/executor.ts` | Create | Executes site tool calls using internal service functions |
| `src/lib/workflows/nodes/health-query.ts` | Create | Health query workflow node |
| `src/lib/workflows/nodes/blog.ts` | Create | Blog management workflow node |
| `src/lib/workflows/nodes/jkai.ts` | Create | JKAI build workflow node |
| `src/lib/workflows/nodes/deep-dive.ts` | Create | Deep Dive research workflow node |
| `src/lib/workflows/whatsapp/orchestrator-bridge.ts` | Modify | Add site tools to LLM function calling |
| `src/lib/workflows/index.ts` | Modify | Register 4 new nodes |
| `src/lib/workflows/registry-client.ts` | Modify | Add 4 nodes to client-side registry |
| `src/lib/components/workflows/nodes/HealthQueryNode.svelte` | Create | Canvas node |
| `src/lib/components/workflows/nodes/BlogNode.svelte` | Create | Canvas node |
| `src/lib/components/workflows/nodes/JkaiNode.svelte` | Create | Canvas node |
| `src/lib/components/workflows/nodes/DeepDiveNode.svelte` | Create | Canvas node |
| `src/routes/workflows/[id]/+page.svelte` | Modify | Register 4 canvas components |
| `tests/lib/workflows/site-tools/executor.test.ts` | Create | Tool executor tests |
| `tests/lib/workflows/site-tools/health-query-node.test.ts` | Create | Health node tests |
| `tests/lib/workflows/site-tools/blog-node.test.ts` | Create | Blog node tests |
| `tests/lib/workflows/site-tools/jkai-node.test.ts` | Create | JKAI node tests |
| `tests/lib/workflows/site-tools/deep-dive-node.test.ts` | Create | Deep Dive node tests |

---

### Task 1: LLM Tool Definitions

**Files:**
- Create: `src/lib/workflows/site-tools/llm-tools.ts`

- [ ] **Step 1: Create the tool definitions file**

Create `src/lib/workflows/site-tools/llm-tools.ts`:

```typescript
export const SITE_TOOL_DEFINITIONS = [
  // Health tools
  {
    type: 'function' as const,
    function: {
      name: 'site_health_stats',
      description: 'Get weekly health metrics (activity count, distance, duration, elevation, recovery score, sleep average) and all-time personal records',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'site_health_readiness',
      description: 'Get composite readiness score with recovery, HRV trend, sleep quality, load balance factors, zone classification, and recommendation',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'site_health_sleep',
      description: 'Get latest sleep analysis (duration, light/deep/REM percentages, performance score) and 14-day trend',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'site_health_training_load',
      description: 'Get training load analysis: acute/chronic load ratio, zone (optimal/caution/danger), 30-day history',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'site_health_timeline',
      description: 'Get paginated timeline of recent health events (activities, workouts, sleep, recovery)',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Page number (default 1)' },
          limit: { type: 'number', description: 'Items per page (default 20)' },
        },
      },
    },
  },
  // Blog tools
  {
    type: 'function' as const,
    function: {
      name: 'site_blog_list',
      description: 'List blog posts with title, slug, status (draft/published), excerpt, and timestamps',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status: "draft" or "published". Omit for all.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'site_blog_get',
      description: 'Get full blog post content, tags, and metadata by ID',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Blog post ID' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'site_blog_create',
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
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'site_blog_update',
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
    },
  },
  // JKAI tools
  {
    type: 'function' as const,
    function: {
      name: 'jkai_start_build',
      description: 'Start a new JKAI autonomous build. Provide a prompt describing what to build.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to build (e.g. "a countdown timer app")' },
          title: { type: 'string', description: 'Build title (auto-generated if omitted)' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'jkai_get_build',
      description: 'Get status and details of a JKAI build by ID',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Build ID' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'jkai_list_builds',
      description: 'List recent JKAI builds with status (pending/running/completed/failed)',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'jkai_control_build',
      description: 'Control a JKAI build: pause, resume, stop, or publish it',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Build ID' },
          action: { type: 'string', description: 'Action: "pause", "resume", "stop", or "publish"' },
        },
        required: ['id', 'action'],
      },
    },
  },
  // Deep Dive tools
  {
    type: 'function' as const,
    function: {
      name: 'research_start',
      description: 'Start a new Deep Dive research session on a topic',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Research topic' },
          goals: { type: 'array', items: { type: 'string' }, description: 'Specific research goals' },
          depth: { type: 'string', description: '"shallow", "standard" (default), or "deep"' },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'research_status',
      description: 'Check the status and stats of a research session',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Research session ID' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'research_list',
      description: 'List recent research sessions with topic, status, and stats',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'research_get_report',
      description: 'Get the narrative report/findings from a completed research session',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Research session ID' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
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
    },
  },
];

export function buildSiteSystemPromptSection(): string {
  return `\n\n--- Site Capabilities ---
You have access to the user's personal platform (strangeramblings.com):

**Health Data** (site_health_* functions):
- Weekly stats, personal records, readiness score, sleep analysis, training load, activity timeline
- Data sources: Strava (running/cycling), Apple Watch (HR/recovery)

**Blog** (site_blog_* functions):
- List, read, create, and update blog posts
- Can publish drafts or create new posts

**JKAI Builder** (jkai_* functions):
- Start autonomous code builds from a prompt
- Check build status, pause/resume/stop, publish completed builds

**Deep Dive Research** (research_* functions):
- Start multi-phase research on any topic
- Check progress, get narrative reports when complete`;
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/llm-tools.ts
git commit -m "feat(site-tools): add LLM tool definitions for health, blog, JKAI, deep dive"
```

---

### Task 2: Tool Executor

**Files:**
- Create: `src/lib/workflows/site-tools/executor.ts`
- Create: `tests/lib/workflows/site-tools/executor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/workflows/site-tools/executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock health services
const mockGetStats = vi.fn();
const mockGetReadiness = vi.fn();
const mockGetSleepAnalysis = vi.fn();
const mockGetTrainingLoad = vi.fn();

vi.mock('$lib/health/stats-service', () => ({
  getStats: () => mockGetStats(),
}));
vi.mock('$lib/health/readiness-service', () => ({
  getReadiness: () => mockGetReadiness(),
}));
vi.mock('$lib/health/sleep-analysis', () => ({
  getSleepAnalysis: () => mockGetSleepAnalysis(),
}));
vi.mock('$lib/health/training-load', () => ({
  getTrainingLoad: () => mockGetTrainingLoad(),
}));

// Mock DB for blog, timeline, jkai, deepdive
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: any[]) => ({
          orderBy: () => ({
            limit: () => mockDbSelect(),
          }),
          limit: () => mockDbSelect(),
        }),
        orderBy: () => ({
          limit: () => mockDbSelect(),
        }),
        limit: () => mockDbSelect(),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        mockDbInsert(v);
        return { returning: () => Promise.resolve([{ id: 'new-id', ...v }]) };
      },
    }),
    update: () => ({
      set: (v: any) => ({
        where: () => {
          mockDbUpdate(v);
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => mockDbDelete(),
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({
  blogPosts: {},
  blogPostTags: {},
  jkaiBuilds: {},
  jkaiIterations: {},
  researchSession: {},
  narrativeItem: {},
  strava_activities: {},
  whoop_workouts: {},
  whoop_sleep: {},
  whoop_recovery: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  sql: vi.fn(),
}));

// Mock JKAI orchestrator
vi.mock('$lib/jkai/orchestrator', () => ({
  orchestrator: {
    startBuild: vi.fn(),
  },
}));

// Mock deepdive
vi.mock('$lib/deepdive', () => ({
  startResearch: vi.fn(),
}));

import { executeSiteTool } from '$lib/workflows/site-tools/executor';

describe('executeSiteTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes site_health_stats', async () => {
    mockGetStats.mockResolvedValue({ weeklyDistance: 42.5, records: [] });

    const result = await executeSiteTool('site_health_stats', {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ weeklyDistance: 42.5 });
  });

  it('executes site_health_readiness', async () => {
    mockGetReadiness.mockResolvedValue({ score: 85, zone: 'optimal' });

    const result = await executeSiteTool('site_health_readiness', {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ score: 85 });
  });

  it('executes site_health_sleep', async () => {
    mockGetSleepAnalysis.mockResolvedValue({ duration: 7.5, performance: 90 });

    const result = await executeSiteTool('site_health_sleep', {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ duration: 7.5 });
  });

  it('executes site_health_training_load', async () => {
    mockGetTrainingLoad.mockResolvedValue({ acuteLoad: 450, chronicLoad: 400, ratio: 1.125 });

    const result = await executeSiteTool('site_health_training_load', {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ ratio: 1.125 });
  });

  it('executes site_blog_list', async () => {
    mockDbSelect.mockResolvedValue([
      { id: '1', title: 'Post 1', status: 'published' },
    ]);

    const result = await executeSiteTool('site_blog_list', {});

    expect(result.success).toBe(true);
  });

  it('executes jkai_list_builds', async () => {
    mockDbSelect.mockResolvedValue([
      { id: 'b1', title: 'Counter App', status: 'completed' },
    ]);

    const result = await executeSiteTool('jkai_list_builds', {});

    expect(result.success).toBe(true);
  });

  it('executes research_list', async () => {
    mockDbSelect.mockResolvedValue([
      { id: 'r1', topic: 'Hiking Routes', status: 'complete' },
    ]);

    const result = await executeSiteTool('research_list', {});

    expect(result.success).toBe(true);
  });

  it('returns error for unknown tool', async () => {
    const result = await executeSiteTool('unknown_tool', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown');
  });

  it('handles service errors gracefully', async () => {
    mockGetStats.mockRejectedValue(new Error('DB connection failed'));

    const result = await executeSiteTool('site_health_stats', {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('DB connection failed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/site-tools/executor.test.ts
```

Expected: FAIL — `Cannot find module '$lib/workflows/site-tools/executor'`

- [ ] **Step 3: Write the executor**

Create `src/lib/workflows/site-tools/executor.ts`:

```typescript
import { db } from '$lib/db';
import { blogPosts, blogPostTags, jkaiBuilds, researchSession, narrativeItem } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function executeSiteTool(
  fnName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (fnName) {
      // Health tools
      case 'site_health_stats': {
        const { getStats } = await import('$lib/health/stats-service');
        return { success: true, data: await getStats() };
      }
      case 'site_health_readiness': {
        const { getReadiness } = await import('$lib/health/readiness-service');
        return { success: true, data: await getReadiness() };
      }
      case 'site_health_sleep': {
        const { getSleepAnalysis } = await import('$lib/health/sleep-analysis');
        return { success: true, data: await getSleepAnalysis() };
      }
      case 'site_health_training_load': {
        const { getTrainingLoad } = await import('$lib/health/training-load');
        return { success: true, data: await getTrainingLoad() };
      }
      case 'site_health_timeline': {
        const { getTimeline } = await import('$lib/health/timeline');
        const page = (args.page as number) || 1;
        const limit = (args.limit as number) || 20;
        return { success: true, data: await getTimeline(page, limit) };
      }

      // Blog tools
      case 'site_blog_list': {
        const posts = await db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt)).limit(50);
        const filtered = args.status
          ? posts.filter((p) => p.status === args.status)
          : posts;
        return {
          success: true,
          data: filtered.map((p) => ({
            id: p.id, title: p.title, slug: p.slug, status: p.status,
            excerpt: p.excerpt, publishedAt: p.publishedAt, createdAt: p.createdAt,
          })),
        };
      }
      case 'site_blog_get': {
        const [post] = await db.select().from(blogPosts)
          .where(eq(blogPosts.id, args.id as string)).limit(1);
        if (!post) return { success: false, error: 'Post not found' };
        return { success: true, data: post };
      }
      case 'site_blog_create': {
        const slug = (args.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const [created] = await db.insert(blogPosts).values({
          title: args.title as string,
          slug,
          content: args.content as string,
          contentFormat: 'markdown',
          status: (args.status as string) || 'draft',
          excerpt: (args.content as string).slice(0, 200),
        }).returning();
        if (args.tags && Array.isArray(args.tags)) {
          for (const tag of args.tags) {
            await db.insert(blogPostTags).values({ postId: created.id, tag: tag as string });
          }
        }
        return { success: true, data: { id: created.id, slug: created.slug, status: created.status } };
      }
      case 'site_blog_update': {
        const updates: Record<string, unknown> = {};
        if (args.title) updates.title = args.title;
        if (args.content) updates.content = args.content;
        if (args.status) {
          updates.status = args.status;
          if (args.status === 'published') updates.publishedAt = new Date();
        }
        updates.updatedAt = new Date();
        await db.update(blogPosts).set(updates).where(eq(blogPosts.id, args.id as string));
        if (args.tags && Array.isArray(args.tags)) {
          await db.delete(blogPostTags).where(eq(blogPostTags.postId, args.id as string));
          for (const tag of args.tags) {
            await db.insert(blogPostTags).values({ postId: args.id as string, tag: tag as string });
          }
        }
        return { success: true, data: { updated: true } };
      }

      // JKAI tools
      case 'jkai_start_build': {
        const [build] = await db.insert(jkaiBuilds).values({
          prompt: args.prompt as string,
          title: (args.title as string) || (args.prompt as string).slice(0, 60),
          status: 'pending',
        }).returning();
        const { orchestrator } = await import('$lib/jkai/orchestrator');
        orchestrator.startBuild(build.id).catch((err: unknown) => {
          console.error('[site-tools] JKAI build start failed:', err);
        });
        return { success: true, data: { id: build.id, title: build.title, status: 'pending' } };
      }
      case 'jkai_get_build': {
        const [build] = await db.select().from(jkaiBuilds)
          .where(eq(jkaiBuilds.id, args.id as string)).limit(1);
        if (!build) return { success: false, error: 'Build not found' };
        return { success: true, data: build };
      }
      case 'jkai_list_builds': {
        const builds = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt)).limit(20);
        return {
          success: true,
          data: builds.map((b) => ({
            id: b.id, title: b.title, status: b.status, createdAt: b.createdAt,
          })),
        };
      }
      case 'jkai_control_build': {
        const action = args.action as string;
        const id = args.id as string;
        const validActions = ['pause', 'resume', 'stop', 'publish'];
        if (!validActions.includes(action)) {
          return { success: false, error: `Invalid action: ${action}. Must be: ${validActions.join(', ')}` };
        }
        const { orchestrator } = await import('$lib/jkai/orchestrator');
        if (action === 'pause') await orchestrator.pauseBuild(id);
        else if (action === 'resume') await orchestrator.resumeBuild(id);
        else if (action === 'stop') await orchestrator.stopBuild(id);
        else if (action === 'publish') await orchestrator.publishBuild(id);
        return { success: true, data: { action, buildId: id } };
      }

      // Deep Dive tools
      case 'research_start': {
        const config: Record<string, unknown> = {};
        if (args.depth) config.analysisDepth = args.depth;
        const [session] = await db.insert(researchSession).values({
          topic: args.topic as string,
          goals: args.goals || [],
          config,
          status: 'draft',
        }).returning();
        const { startResearch } = await import('$lib/deepdive');
        startResearch(session.id).catch((err: unknown) => {
          console.error('[site-tools] Research start failed:', err);
        });
        return { success: true, data: { id: session.id, topic: session.topic, status: 'draft' } };
      }
      case 'research_status': {
        const [session] = await db.select().from(researchSession)
          .where(eq(researchSession.id, args.id as string)).limit(1);
        if (!session) return { success: false, error: 'Session not found' };
        return { success: true, data: session };
      }
      case 'research_list': {
        const sessions = await db.select().from(researchSession)
          .orderBy(desc(researchSession.createdAt)).limit(20);
        return {
          success: true,
          data: sessions.map((s) => ({
            id: s.id, topic: s.topic, status: s.status, createdAt: s.createdAt,
          })),
        };
      }
      case 'research_get_report': {
        const items = await db.select().from(narrativeItem)
          .where(eq(narrativeItem.sessionId, args.id as string))
          .orderBy(narrativeItem.position);
        return { success: true, data: { narrative: items } };
      }
      case 'research_control': {
        const action = args.action as string;
        if (action === 'stop') {
          await db.update(researchSession).set({ status: 'failed' })
            .where(eq(researchSession.id, args.id as string));
        } else if (action === 'skip') {
          // Skip advances to next phase — update status
          await db.update(researchSession).set({ status: 'post_processing' })
            .where(eq(researchSession.id, args.id as string));
        }
        return { success: true, data: { action, sessionId: args.id } };
      }

      default:
        return { success: false, error: `Unknown site tool: ${fnName}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/site-tools/executor.test.ts
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/site-tools/executor.ts tests/lib/workflows/site-tools/executor.test.ts
git commit -m "feat(site-tools): add tool executor for health, blog, JKAI, deep dive"
```

---

### Task 3: Four Workflow Nodes

**Files:**
- Create: `src/lib/workflows/nodes/health-query.ts`
- Create: `src/lib/workflows/nodes/blog.ts`
- Create: `src/lib/workflows/nodes/jkai.ts`
- Create: `src/lib/workflows/nodes/deep-dive.ts`

- [ ] **Step 1: Create health-query node**

Create `src/lib/workflows/nodes/health-query.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '../site-tools/executor';
import { interpolateTemplate } from './template';

export const healthQueryExecutor: NodeExecutor = {
  type: 'health-query',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string;
    if (!operation) return { output: { success: false, error: 'No operation configured' } };

    const toolName = `site_health_${operation}`;
    const args: Record<string, unknown> = {};
    if (operation === 'timeline') {
      const page = interpolateTemplate((config.page as string) || '', input);
      const limit = interpolateTemplate((config.limit as string) || '', input);
      if (page) args.page = parseInt(page) || 1;
      if (limit) args.limit = parseInt(limit) || 20;
    }

    const result = await executeSiteTool(toolName, args);
    return { output: result };
  },

  getInputSchema() { return { type: 'object' }; },
  getOutputSchema() {
    return { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' }, error: { type: 'string' } } };
  },
};

export const healthQueryDef: NodeDefinition = {
  type: 'health-query',
  label: 'Health Query',
  category: 'integration',
  description: 'Query health data: stats, readiness, sleep analysis, training load, or timeline.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string', description: 'stats | readiness | sleep | training_load | timeline' },
      page: { type: 'string' },
      limit: { type: 'string' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'stats' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'stats', label: 'Weekly Stats & Records' },
      { value: 'readiness', label: 'Readiness Score' },
      { value: 'sleep', label: 'Sleep Analysis' },
      { value: 'training_load', label: 'Training Load' },
      { value: 'timeline', label: 'Activity Timeline' },
    ]},
    { key: 'page', label: 'Page', type: 'number', advancedOnly: true },
    { key: 'limit', label: 'Limit', type: 'number', advancedOnly: true },
  ],
  llmDescription: 'Query health data from Strava and Apple Watch. Operations: stats (weekly metrics + records), readiness (composite score), sleep (analysis + trend), training_load (acute/chronic ratio), timeline (recent events).',
  llmExamples: [
    { operation: 'readiness' },
    { operation: 'stats' },
  ],
};
```

- [ ] **Step 2: Create blog node**

Create `src/lib/workflows/nodes/blog.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '../site-tools/executor';
import { interpolateTemplate } from './template';

export const blogExecutor: NodeExecutor = {
  type: 'blog',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string;
    if (!operation) return { output: { success: false, error: 'No operation configured' } };

    const args: Record<string, unknown> = {};

    switch (operation) {
      case 'list':
        if (config.status) args.status = interpolateTemplate(config.status as string, input);
        return { output: await executeSiteTool('site_blog_list', args) };
      case 'get':
        args.id = interpolateTemplate((config.postId as string) || '', input);
        if (!args.id) return { output: { success: false, error: 'No post ID configured' } };
        return { output: await executeSiteTool('site_blog_get', args) };
      case 'create':
        args.title = interpolateTemplate((config.title as string) || '', input);
        args.content = interpolateTemplate((config.content as string) || '', input);
        if (config.status) args.status = config.status;
        if (config.tags) {
          try { args.tags = JSON.parse(config.tags as string); } catch { args.tags = []; }
        }
        return { output: await executeSiteTool('site_blog_create', args) };
      case 'update':
        args.id = interpolateTemplate((config.postId as string) || '', input);
        if (!args.id) return { output: { success: false, error: 'No post ID configured' } };
        if (config.title) args.title = interpolateTemplate(config.title as string, input);
        if (config.content) args.content = interpolateTemplate(config.content as string, input);
        if (config.status) args.status = config.status;
        if (config.tags) {
          try { args.tags = JSON.parse(config.tags as string); } catch { args.tags = []; }
        }
        return { output: await executeSiteTool('site_blog_update', args) };
      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` } };
    }
  },

  getInputSchema() { return { type: 'object' }; },
  getOutputSchema() {
    return { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' }, error: { type: 'string' } } };
  },
};

export const blogDef: NodeDefinition = {
  type: 'blog',
  label: 'Blog',
  category: 'integration',
  description: 'Manage blog posts: list, get, create, or update posts.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string' },
      postId: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      status: { type: 'string' },
      tags: { type: 'string' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'list', label: 'List Posts' },
      { value: 'get', label: 'Get Post' },
      { value: 'create', label: 'Create Post' },
      { value: 'update', label: 'Update Post' },
    ]},
    { key: 'postId', label: 'Post ID', type: 'template-textarea', placeholder: '{{input.output.id}}' },
    { key: 'title', label: 'Title', type: 'template-textarea' },
    { key: 'content', label: 'Content', type: 'template-textarea', advancedOnly: true },
    { key: 'status', label: 'Status', type: 'dropdown', options: [
      { value: '', label: '(unchanged)' },
      { value: 'draft', label: 'Draft' },
      { value: 'published', label: 'Published' },
    ], advancedOnly: true },
    { key: 'tags', label: 'Tags (JSON array)', type: 'textarea', advancedOnly: true },
  ],
  llmDescription: 'Manage blog posts. List, get by ID, create new, or update existing. Output: input.output.success, input.output.data.',
  llmExamples: [
    { operation: 'list' },
    { operation: 'create', title: 'My Post', content: '# Hello World' },
  ],
};
```

- [ ] **Step 3: Create jkai node**

Create `src/lib/workflows/nodes/jkai.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '../site-tools/executor';
import { interpolateTemplate } from './template';

export const jkaiExecutor: NodeExecutor = {
  type: 'jkai',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string;
    if (!operation) return { output: { success: false, error: 'No operation configured' } };

    const args: Record<string, unknown> = {};

    switch (operation) {
      case 'start':
        args.prompt = interpolateTemplate((config.prompt as string) || '', input);
        if (!args.prompt) return { output: { success: false, error: 'No prompt configured' } };
        if (config.title) args.title = interpolateTemplate(config.title as string, input);
        return { output: await executeSiteTool('jkai_start_build', args) };
      case 'status':
        args.id = interpolateTemplate((config.buildId as string) || '', input);
        if (!args.id) return { output: { success: false, error: 'No build ID configured' } };
        return { output: await executeSiteTool('jkai_get_build', args) };
      case 'list':
        return { output: await executeSiteTool('jkai_list_builds', {}) };
      case 'control':
        args.id = interpolateTemplate((config.buildId as string) || '', input);
        args.action = config.action as string;
        if (!args.id || !args.action) return { output: { success: false, error: 'Build ID and action required' } };
        return { output: await executeSiteTool('jkai_control_build', args) };
      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` } };
    }
  },

  getInputSchema() { return { type: 'object' }; },
  getOutputSchema() {
    return { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' }, error: { type: 'string' } } };
  },
};

export const jkaiDef: NodeDefinition = {
  type: 'jkai',
  label: 'JKAI Builder',
  category: 'integration',
  description: 'Start, monitor, and control JKAI autonomous code builds.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string' },
      prompt: { type: 'string' },
      title: { type: 'string' },
      buildId: { type: 'string' },
      action: { type: 'string' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'start', label: 'Start Build' },
      { value: 'status', label: 'Get Build Status' },
      { value: 'list', label: 'List Builds' },
      { value: 'control', label: 'Control Build' },
    ]},
    { key: 'prompt', label: 'Build Prompt', type: 'template-textarea', placeholder: 'Build a countdown timer app' },
    { key: 'title', label: 'Title', type: 'text', advancedOnly: true },
    { key: 'buildId', label: 'Build ID', type: 'template-textarea', placeholder: '{{input.output.id}}' },
    { key: 'action', label: 'Action', type: 'dropdown', options: [
      { value: 'pause', label: 'Pause' },
      { value: 'resume', label: 'Resume' },
      { value: 'stop', label: 'Stop' },
      { value: 'publish', label: 'Publish' },
    ], advancedOnly: true },
  ],
  llmDescription: 'Start and manage JKAI autonomous code builds. Start a build from a prompt, check status, list recent builds, or control (pause/resume/stop/publish).',
  llmExamples: [
    { operation: 'start', prompt: 'Build a simple countdown timer web app' },
    { operation: 'list' },
  ],
};
```

- [ ] **Step 4: Create deep-dive node**

Create `src/lib/workflows/nodes/deep-dive.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { executeSiteTool } from '../site-tools/executor';
import { interpolateTemplate } from './template';

export const deepDiveExecutor: NodeExecutor = {
  type: 'deep-dive',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = config.operation as string;
    if (!operation) return { output: { success: false, error: 'No operation configured' } };

    const args: Record<string, unknown> = {};

    switch (operation) {
      case 'start':
        args.topic = interpolateTemplate((config.topic as string) || '', input);
        if (!args.topic) return { output: { success: false, error: 'No topic configured' } };
        if (config.goals) {
          try { args.goals = JSON.parse(config.goals as string); } catch { args.goals = []; }
        }
        if (config.depth) args.depth = config.depth;
        return { output: await executeSiteTool('research_start', args) };
      case 'status':
        args.id = interpolateTemplate((config.sessionId as string) || '', input);
        if (!args.id) return { output: { success: false, error: 'No session ID configured' } };
        return { output: await executeSiteTool('research_status', args) };
      case 'list':
        return { output: await executeSiteTool('research_list', {}) };
      case 'report':
        args.id = interpolateTemplate((config.sessionId as string) || '', input);
        if (!args.id) return { output: { success: false, error: 'No session ID configured' } };
        return { output: await executeSiteTool('research_get_report', args) };
      case 'control':
        args.id = interpolateTemplate((config.sessionId as string) || '', input);
        args.action = config.action as string;
        if (!args.id || !args.action) return { output: { success: false, error: 'Session ID and action required' } };
        return { output: await executeSiteTool('research_control', args) };
      default:
        return { output: { success: false, error: `Unknown operation: ${operation}` } };
    }
  },

  getInputSchema() { return { type: 'object' }; },
  getOutputSchema() {
    return { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' }, error: { type: 'string' } } };
  },
};

export const deepDiveDef: NodeDefinition = {
  type: 'deep-dive',
  label: 'Deep Dive',
  category: 'integration',
  description: 'Start and monitor Deep Dive research sessions on any topic.',
  configSchema: {
    type: 'object',
    properties: {
      operation: { type: 'string' },
      topic: { type: 'string' },
      goals: { type: 'string' },
      depth: { type: 'string' },
      sessionId: { type: 'string' },
      action: { type: 'string' },
    },
    required: ['operation'],
  },
  defaultConfig: { operation: 'list' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  basicConfig: [
    { key: 'operation', label: 'Operation', type: 'dropdown', options: [
      { value: 'start', label: 'Start Research' },
      { value: 'status', label: 'Check Status' },
      { value: 'list', label: 'List Sessions' },
      { value: 'report', label: 'Get Report' },
      { value: 'control', label: 'Control Session' },
    ]},
    { key: 'topic', label: 'Research Topic', type: 'template-textarea', placeholder: 'Best hiking routes in Snowdonia' },
    { key: 'goals', label: 'Goals (JSON array)', type: 'textarea', advancedOnly: true, placeholder: '["Find top 5 routes", "Include difficulty ratings"]' },
    { key: 'depth', label: 'Depth', type: 'dropdown', options: [
      { value: 'shallow', label: 'Shallow' },
      { value: 'standard', label: 'Standard' },
      { value: 'deep', label: 'Deep' },
    ], advancedOnly: true },
    { key: 'sessionId', label: 'Session ID', type: 'template-textarea', placeholder: '{{input.output.id}}' },
    { key: 'action', label: 'Action', type: 'dropdown', options: [
      { value: 'stop', label: 'Stop' },
      { value: 'skip', label: 'Skip Phase' },
    ], advancedOnly: true },
  ],
  llmDescription: 'Start and manage Deep Dive research. Start a multi-phase research session, check status, list sessions, get narrative report, or control (stop/skip).',
  llmExamples: [
    { operation: 'start', topic: 'Best hiking routes in Snowdonia', depth: 'standard' },
    { operation: 'list' },
  ],
};
```

- [ ] **Step 5: Commit all four nodes**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/nodes/health-query.ts src/lib/workflows/nodes/blog.ts src/lib/workflows/nodes/jkai.ts src/lib/workflows/nodes/deep-dive.ts
git commit -m "feat(site-tools): add health-query, blog, jkai, and deep-dive workflow nodes"
```

---

### Task 4: Update Orchestrator Bridge

**Files:**
- Modify: `src/lib/workflows/whatsapp/orchestrator-bridge.ts`

- [ ] **Step 1: Add site tools to the orchestrator bridge**

In `src/lib/workflows/whatsapp/orchestrator-bridge.ts`, add these imports at the top:

```typescript
import { SITE_TOOL_DEFINITIONS, buildSiteSystemPromptSection } from '$lib/workflows/site-tools/llm-tools';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
```

In the `handleMessage` method, find where `haSection` is built and the system prompt is assembled. Add the site section:

```typescript
      const siteSection = buildSiteSystemPromptSection();
      const systemContent = this.soulMd
        ? `${SYSTEM_PROMPT}${haSection}${siteSection}\n\n--- Personality & Style ---\n${this.soulMd}`
        : `${SYSTEM_PROMPT}${haSection}${siteSection}`;
```

Find where the `tools` array is built (currently just HA tools). Merge site tools:

```typescript
      const allTools = [...(haEntities.length > 0 ? HA_TOOL_DEFINITIONS : []), ...SITE_TOOL_DEFINITIONS];
      const tools = allTools.length > 0 ? allTools : undefined;
```

In the tool-call switch statement (inside the `for (const toolCall of msg.tool_calls)` loop), add site tool handling. After the existing HA switch cases and the `default` case, replace the default with:

```typescript
            default:
              // Try site tools
              if (fnName.startsWith('site_') || fnName.startsWith('jkai_') || fnName.startsWith('research_')) {
                toolResult = await executeSiteTool(fnName, fnArgs);
              } else {
                toolResult = { error: `Unknown function: ${fnName}` };
              }
```

- [ ] **Step 2: Run tests**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/whatsapp/
```

Expected: All tests pass (site tools are mocked by the existing test setup since they're imported dynamically).

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/whatsapp/orchestrator-bridge.ts
git commit -m "feat(site-tools): add health/blog/JKAI/research tools to WhatsApp orchestrator"
```

---

### Task 5: Register Nodes and Canvas Components

**Files:**
- Modify: `src/lib/workflows/index.ts`
- Modify: `src/lib/workflows/registry-client.ts`
- Create: `src/lib/components/workflows/nodes/HealthQueryNode.svelte`
- Create: `src/lib/components/workflows/nodes/BlogNode.svelte`
- Create: `src/lib/components/workflows/nodes/JkaiNode.svelte`
- Create: `src/lib/components/workflows/nodes/DeepDiveNode.svelte`
- Modify: `src/routes/workflows/[id]/+page.svelte`

- [ ] **Step 1: Register nodes in server-side index**

In `src/lib/workflows/index.ts`, add imports with the other node imports:

```typescript
import { healthQueryDef, healthQueryExecutor } from './nodes/health-query';
import { blogDef, blogExecutor } from './nodes/blog';
import { jkaiDef, jkaiExecutor } from './nodes/jkai';
import { deepDiveDef, deepDiveExecutor } from './nodes/deep-dive';
```

Add registrations:

```typescript
registry.register(healthQueryDef, healthQueryExecutor);
registry.register(blogDef, blogExecutor);
registry.register(jkaiDef, jkaiExecutor);
registry.register(deepDiveDef, deepDiveExecutor);
```

- [ ] **Step 2: Add client-side definitions to registry-client.ts**

In `src/lib/workflows/registry-client.ts`, add these four definitions before the `builtInDefinitions` array. Each mirrors the node's definition but without the executor import. Use the same `configSchema`, `defaultConfig`, `inputs`, `outputs`, `basicConfig`, `llmDescription`, and `llmExamples` from the node files above. Name them `healthQueryClientDef`, `blogClientDef`, `jkaiClientDef`, `deepDiveClientDef`.

Add all four to the `builtInDefinitions` array.

- [ ] **Step 3: Create canvas node components**

Create `src/lib/components/workflows/nodes/HealthQueryNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const operation: string = data.config?.operation ?? 'stats';
  const opLabels: Record<string, string> = { stats: 'Stats', readiness: 'Readiness', sleep: 'Sleep', training_load: 'Training', timeline: 'Timeline' };
  const displayLabel: string = data.label || `Health ${opLabels[operation] || operation}`;
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="health-query" status={data.status} error={data.error} icon="❤️" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
```

Create `src/lib/components/workflows/nodes/BlogNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const operation: string = data.config?.operation ?? 'list';
  const opLabels: Record<string, string> = { list: 'List', get: 'Get', create: 'Create', update: 'Update' };
  const displayLabel: string = data.label || `Blog ${opLabels[operation] || operation}`;
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="blog" status={data.status} error={data.error} icon="📝" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
```

Create `src/lib/components/workflows/nodes/JkaiNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const operation: string = data.config?.operation ?? 'list';
  const opLabels: Record<string, string> = { start: 'Start', status: 'Status', list: 'List', control: 'Control' };
  const displayLabel: string = data.label || `JKAI ${opLabels[operation] || operation}`;
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="jkai" status={data.status} error={data.error} icon="🤖" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
```

Create `src/lib/components/workflows/nodes/DeepDiveNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  let { data, id } = $props();
  const operation: string = data.config?.operation ?? 'list';
  const opLabels: Record<string, string> = { start: 'Start', status: 'Status', list: 'List', report: 'Report', control: 'Control' };
  const displayLabel: string = data.label || `Research ${opLabels[operation] || operation}`;
</script>
<BaseNode {id} description="" label={displayLabel} nodeType="deep-dive" status={data.status} error={data.error} icon="🔬" inputs={[{ name: 'input' }]} outputs={[{ name: 'output' }]} />
```

- [ ] **Step 4: Register canvas components in page**

In `src/routes/workflows/[id]/+page.svelte`:

Add four dynamic imports in the `Promise.all` block:

```typescript
import('$lib/components/workflows/nodes/HealthQueryNode.svelte'),
import('$lib/components/workflows/nodes/BlogNode.svelte'),
import('$lib/components/workflows/nodes/JkaiNode.svelte'),
import('$lib/components/workflows/nodes/DeepDiveNode.svelte'),
```

Add to destructuring and `nodeTypeComponents`:

```typescript
'health-query': hq.default,
'blog': bl.default,
'jkai': jk.default,
'deep-dive': dd.default,
```

- [ ] **Step 5: Verify build and run tests**

```bash
cd ~/strange_rambling_svelte && npx svelte-kit sync && npx vitest run tests/lib/workflows/ 2>&1 | tail -8
```

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/index.ts src/lib/workflows/registry-client.ts src/lib/components/workflows/nodes/HealthQueryNode.svelte src/lib/components/workflows/nodes/BlogNode.svelte src/lib/components/workflows/nodes/JkaiNode.svelte src/lib/components/workflows/nodes/DeepDiveNode.svelte src/routes/workflows/[id]/+page.svelte
git commit -m "feat(site-tools): register nodes and canvas components for health, blog, JKAI, deep dive"
```

---

### Task 6: Deploy and Test

- [ ] **Step 1: Run full test suite**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/
```

- [ ] **Step 2: Push and deploy**

```bash
cd ~/strange_rambling_svelte && git push origin master && bash scripts/deploy.sh
```

- [ ] **Step 3: Verify startup**

```bash
ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 "sleep 3 && sudo journalctl -u strange-rambling-svelte --no-pager -n 10"
```

Expected: Service starts without errors, HA syncs, WhatsApp connects.

- [ ] **Step 4: Test via WhatsApp**

Send messages to test each integration:
- "What's my readiness score?" → should call `site_health_readiness`
- "List my blog posts" → should call `site_blog_list`
- "What JKAI builds do I have?" → should call `jkai_list_builds`
- "Start a research session on renewable energy in Wales" → should call `research_start`

- [ ] **Step 5: Test workflow nodes in UI**

Open the workflows editor, verify all four new nodes appear in the palette under Integration:
- Health Query, Blog, JKAI Builder, Deep Dive
