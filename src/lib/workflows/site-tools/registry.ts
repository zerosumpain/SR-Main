import { db } from '$lib/db';
import { blogPosts, jkaiBuilds, researchSessions, workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

// ==========================================
// Tool Registry
// ==========================================
// Add new tools here. Each entry defines its LLM schema and handler
// in one place. Everything else (tool list, executor, system prompt)
// reads from this registry automatically.

type ToolResult = { success: boolean; data?: unknown; error?: string };

interface ToolDefinition {
  /** Tool name — used as the function name in LLM calls */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for parameters */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Category for system prompt grouping */
  category: string;
  /** Handler that executes the tool */
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const tools: ToolDefinition[] = [];

function register(tool: ToolDefinition) {
  tools.push(tool);
}

// ==========================================
// Health Tools
// ==========================================

register({
  name: 'site_health_stats',
  description: 'Get weekly health metrics (activity count, distance, duration, elevation, recovery score, sleep average) and all-time personal records',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getStats } = await import('$lib/health/stats-service');
    return { success: true, data: await getStats() };
  },
});

register({
  name: 'site_health_readiness',
  description: 'Get composite readiness score with recovery, HRV trend, sleep quality, load balance factors, zone classification, and recommendation',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getReadiness } = await import('$lib/health/readiness-service');
    return { success: true, data: await getReadiness() };
  },
});

register({
  name: 'site_health_sleep',
  description: 'Get latest sleep analysis (duration, light/deep/REM percentages, performance score) and 14-day trend',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getSleepAnalysis } = await import('$lib/health/sleep-analysis-service');
    return { success: true, data: await getSleepAnalysis() };
  },
});

register({
  name: 'site_health_training_load',
  description: 'Get training load analysis: acute/chronic load ratio, zone (optimal/caution/danger), 30-day history',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Health Data',
  handler: async () => {
    const { getTrainingLoad } = await import('$lib/health/training-load-service');
    return { success: true, data: await getTrainingLoad() };
  },
});

register({
  name: 'site_health_timeline',
  description: 'Get paginated timeline of recent health events (activities, workouts, sleep, recovery)',
  parameters: { type: 'object', properties: { page: { type: 'number', description: 'Page number (default 1)' }, limit: { type: 'number', description: 'Items per page (default 20)' } } },
  category: 'Health Data',
  handler: async (args) => {
    const { getTimeline } = await import('$lib/health/timeline-service');
    const page = (args.page as number) || 1;
    const limit = (args.limit as number) || 20;
    return { success: true, data: await getTimeline(page, limit) };
  },
});

// ==========================================
// Blog Tools
// ==========================================

register({
  name: 'site_blog_list',
  description: 'List blog posts with title, slug, status (draft/published), excerpt, and timestamps',
  parameters: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status: "draft" or "published". Omit for all.' } } },
  category: 'Blog',
  handler: async () => {
    const rows = await db.select().from(blogPosts).orderBy(desc(blogPosts.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'site_blog_get',
  description: 'Get full blog post content, tags, and metadata by ID',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Blog post ID' } }, required: ['id'] },
  category: 'Blog',
  handler: async (args) => {
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, args.id as string)).limit(1);
    return post ? { success: true, data: post } : { success: false, error: 'Post not found' };
  },
});

register({
  name: 'site_blog_create',
  description: 'Create a new blog post',
  parameters: { type: 'object', properties: { title: { type: 'string', description: 'Post title' }, content: { type: 'string', description: 'Post content (markdown or HTML)' }, status: { type: 'string', description: '"draft" (default) or "published"' }, tags: { type: 'array', items: { type: 'string' }, description: 'Tag names' } }, required: ['title', 'content'] },
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
  name: 'site_blog_update',
  description: 'Update an existing blog post (title, content, status, tags)',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Blog post ID' }, title: { type: 'string', description: 'New title' }, content: { type: 'string', description: 'New content' }, status: { type: 'string', description: '"draft" or "published"' }, tags: { type: 'array', items: { type: 'string' }, description: 'New tag names (replaces existing)' } }, required: ['id'] },
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

// ==========================================
// JKAI Builder Tools
// ==========================================

register({
  name: 'jkai_start_build',
  description: 'Start a new JKAI autonomous build. Provide a prompt describing what to build.',
  parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'What to build (e.g. "a countdown timer app")' }, title: { type: 'string', description: 'Build title (auto-generated if omitted)' } }, required: ['prompt'] },
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
  name: 'jkai_get_build',
  description: 'Get status and details of a JKAI build by ID',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Build ID' } }, required: ['id'] },
  category: 'JKAI Builder',
  handler: async (args) => {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, args.id as string)).limit(1);
    return build ? { success: true, data: build } : { success: false, error: 'Build not found' };
  },
});

register({
  name: 'jkai_list_builds',
  description: 'List recent JKAI builds with status (pending/running/completed/failed)',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'JKAI Builder',
  handler: async () => {
    const rows = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'jkai_control_build',
  description: 'Control a JKAI build: pause, resume, stop, or publish it',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Build ID' }, action: { type: 'string', description: 'Action: "pause", "resume", "stop", or "publish"' } }, required: ['id', 'action'] },
  category: 'JKAI Builder',
  handler: async (args) => {
    const { orchestrator } = await import('$lib/jkai/orchestrator');
    const action = args.action as string;
    const id = args.id as string;
    if (action === 'pause') await orchestrator.pauseBuild(id);
    else if (action === 'resume') await orchestrator.resumeBuild(id);
    else if (action === 'stop') await orchestrator.stopBuild(id);
    else if (action === 'publish') {
      const res = await fetch(`/api/jkai/builds/${id}/publish`, { method: 'POST' });
      return { success: res.ok, data: await res.json().catch(() => null) };
    }
    else return { success: false, error: `Unknown action: ${action}` };
    return { success: true, data: { action, id } };
  },
});

// ==========================================
// Research Tools
// ==========================================

register({
  name: 'research_start',
  description: 'Start a new Deep Dive research session on a topic',
  parameters: { type: 'object', properties: { topic: { type: 'string', description: 'Research topic' }, goals: { type: 'array', items: { type: 'string' }, description: 'Specific research goals' } }, required: ['topic'] },
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
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Research session ID' } }, required: ['id'] },
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
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Research session ID' } }, required: ['id'] },
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
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Research session ID' }, action: { type: 'string', description: '"stop" or "skip"' } }, required: ['id', 'action'] },
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
// WhatsApp Tools
// ==========================================

register({
  name: 'whatsapp_send',
  description: 'Send a WhatsApp message to a phone number. Use this to proactively message the user or send alerts/notifications.',
  parameters: { type: 'object', properties: { to: { type: 'string', description: 'Phone number with country code (e.g. "+447359228511")' }, message: { type: 'string', description: 'Message text to send' } }, required: ['to', 'message'] },
  category: 'WhatsApp',
  handler: async (args) => {
    const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
    const wa = getWhatsAppService();
    const result = await wa.sendMessage(args.to as string, args.message as string);
    return { success: result.sent, data: result };
  },
});

// ==========================================
// Workflow Tools
// ==========================================

register({
  name: 'workflow_create',
  description: 'Create an automated workflow from a natural language description. Use this when the user needs something that runs automatically or on a schedule — things like "every morning send me a health summary", "check X every hour and notify me". The workflow engine supports: manual-trigger (with cron scheduling), WhatsApp messaging, Home Assistant queries/control, LLM calls, code execution, Strava, blog, email, loops, data stores, conditionals, and more. The trigger node is always manual-trigger (supports cron schedules). For event-driven HA automations, create a scheduled workflow that polls state. After creating, share the returned URL as a clickable markdown link: [Review workflow](url).',
  parameters: { type: 'object', properties: { description: { type: 'string', description: 'Natural language description of what the workflow should do. Be specific about triggers, conditions, and actions.' } }, required: ['description'] },
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

    // Save the workflow
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
  name: 'workflow_delete',
  description: 'Delete a workflow by ID. Use when the user asks to remove or clean up a workflow.',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Workflow ID to delete' } }, required: ['id'] },
  category: 'Workflows',
  handler: async (args) => {
    const [existing] = await db.select().from(workflows).where(eq(workflows.id, args.id as string)).limit(1);
    if (!existing) return { success: false, error: 'Workflow not found' };
    await db.delete(workflows).where(eq(workflows.id, args.id as string));
    return { success: true, data: { deleted: true, name: existing.name } };
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

// ==========================================
// Public API
// ==========================================

/** All registered tools */
export function getTools(): readonly ToolDefinition[] {
  return tools;
}

/** OpenAI-format tool definitions for LLM calls */
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

/** Execute a tool by name */
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

/** Check if a tool name is registered */
export function isRegisteredTool(name: string): boolean {
  return tools.some((t) => t.name === name);
}

/** Auto-generated system prompt section from registry categories */
export function buildSystemPromptSection(): string {
  const categories = new Map<string, string[]>();
  for (const t of tools) {
    if (!categories.has(t.category)) categories.set(t.category, []);
    categories.get(t.category)!.push(t.name);
  }

  const lines = ['\n\n--- Site Capabilities ---', 'You have access to the following tools on the user\'s personal platform (strangeramblings.com):\n'];
  for (const [category, names] of categories) {
    lines.push(`**${category}** (${names.join(', ')})`);
  }

  lines.push('');
  lines.push("John's WhatsApp number: +447359228511");

  return lines.join('\n');
}
