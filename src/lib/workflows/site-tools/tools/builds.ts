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
    const maxLogs = (args.limit as number) || 50;
    const type = args.type as string | undefined;

    const rows = await db
      .select()
      .from(jkaiLogs)
      .where(
        type
          ? and(eq(jkaiLogs.buildId, buildId), eq(jkaiLogs.type, type))
          : eq(jkaiLogs.buildId, buildId),
      )
      .orderBy(desc(jkaiLogs.createdAt))
      .limit(maxLogs);

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
    const { writeFileInSandbox, ensureWorkspace, execInSandboxChecked } = await import('$lib/jkai/sandbox');
    const buildId = args.buildId as string;
    const space = (args.space as string) || 'dev';
    if (space === 'dev') await ensureWorkspace(buildId);
    const filePath = `/home/jkai/workspace/${buildId}/${space}/${args.path as string}`;
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

    if (build.publishedSlug) {
      const { unpublishBuild } = await import('$lib/jkai/sandbox');
      await unpublishBuild(build.publishedSlug);
    }

    const { execInSandbox } = await import('$lib/jkai/sandbox');
    await execInSandbox(`rm -rf /home/jkai/workspace/${id}`).catch(() => {});

    await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, id));
    return { success: true, data: { deleted: true, title: build.title } };
  },
});
