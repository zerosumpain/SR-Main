import { register } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { desc, eq, and, asc } from 'drizzle-orm';

// ==========================================
// Existing Tools (renamed)
// ==========================================

register({
  name: 'build_create',
  description:
    'Start a new JKAI autonomous build. Provide a prompt describing what to build. ' +
    'Optionally attach primary workflows the build should foreground in its planning context.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'What to build (e.g. "a countdown timer app")' },
      title: { type: 'string', description: 'Build title (auto-generated if omitted)' },
      attachedWorkflowIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Workflow IDs to attach as the build\'s primary workflow set (gets prominent grounding in the builder system prompt).',
      },
    },
    required: ['prompt'],
  },
  category: 'JKAI Builder',
  toolset: 'builds',
  producesLongRunningTask: { kind: 'build', idPath: 'id', cadenceSeconds: 30 },
  handler: async (args, toolCtx) => {
    const { orchestrator } = await import('$lib/jkai/orchestrator');
    const { resolveDefaultModel } = await import('$lib/server/models/settings');
    const ctx = await resolveDefaultModel('builder');
    const attachedRaw = args.attachedWorkflowIds;
    const attachedWorkflowIds = Array.isArray(attachedRaw) && attachedRaw.every((s) => typeof s === 'string')
      ? (attachedRaw as string[])
      : [];
    const insertValues: Record<string, unknown> = {
      title: (args.title as string) || null,
      prompt: args.prompt as string,
      budgetConfig: {},
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
    };
    if (toolCtx?.conversationId) insertValues.conversationId = toolCtx.conversationId;
    if (attachedWorkflowIds.length > 0) insertValues.attachedWorkflowIds = attachedWorkflowIds;
    const [build] = await db.insert(jkaiBuilds).values(insertValues as any).returning();
    await orchestrator.startBuild(build.id);
    return { success: true, data: build };
  },
});

register({
  name: 'build_list',
  description: 'List recent JKAI builds with status (pending/running/completed/failed)',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'JKAI Builder',
  toolset: 'builds',
  handler: async () => {
    const rows = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'build_control',
  destructive: true,
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
  toolset: 'builds',
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
      return { success: true, data: { slug, url: `https://strangeramblings.com/projects/${slug}/` } };
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
  toolset: 'builds',
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
          ? `https://strangeramblings.com/projects/${build.publishedSlug}/`
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
  toolset: 'builds',
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
  toolset: 'builds',
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
  toolset: 'builds',
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
  toolset: 'builds',
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
  toolset: 'builds',
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
  toolset: 'builds',
  // Resuming a build is a long-running job — auto-attach (re-arm) the durable
  // heartbeat watcher so the user hears about the tweak's outcome, same as
  // build_create. Idempotent: re-arms the existing watch-build-<id> action.
  producesLongRunningTask: { kind: 'build', idPath: 'id', cadenceSeconds: 30 },
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
  toolset: 'builds',
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
  name: 'register_hermes_build',
  description:
    'Register an app you (Hermes) just built as a JKAI build, so it appears at /jkai/builds and can be promoted to /projects/<slug>/. ' +
    'Use this whenever you finish a static web app (single-page or multi-page HTML/JS/CSS) in a conversation — typically WhatsApp or general chat. ' +
    'You provide the source files; this tool writes them to the build workspace, creates a `jkai_builds` row marked origin=hermes, status=completed, and returns the build id + URL. ' +
    'After calling this, ask the user (in the same conversation) whether they want it conformed to the Strange Ramblings design system and published. ' +
    'If yes, call `build_tweak` with the build id and an instruction like "Apply the site design system, then publish to /projects/". ' +
    'If no, leave it — the user can still hit "Publish" from the /jkai/builds card to ship the raw version.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short human-readable title (e.g. "Quick calculator", "Daily mood tracker"). Auto-generated from prompt if omitted.' },
      prompt: { type: 'string', description: 'The user request that led to this app — used as the "build prompt" for accounting and any future continuation pass. Free text, 1-2 sentences.' },
      files: {
        type: 'array',
        description: 'Static source files. The first file with name "index.html" becomes the entry point. Other files (style.css, app.js, sub-pages, assets) are written alongside it.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path within the workspace, e.g. "index.html", "assets/logo.svg".' },
            content: { type: 'string', description: 'File body as text.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    required: ['prompt', 'files'],
  },
  category: 'JKAI Builder',
  toolset: 'builds',
  handler: async (args, toolCtx) => {
    const { ensureWorkspace, writeFileInSandbox, execInSandbox } = await import('$lib/jkai/sandbox');
    const { resolveDefaultModel } = await import('$lib/server/models/settings');

    const filesRaw = args.files;
    if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
      return { success: false, error: 'files[] is required and must be non-empty' };
    }
    const files = filesRaw as Array<{ path: string; content: string }>;
    for (const f of files) {
      if (!f.path || typeof f.path !== 'string' || typeof f.content !== 'string') {
        return { success: false, error: 'each file needs string path + string content' };
      }
      // Reject path traversal — keep writes scoped to the workspace.
      if (f.path.startsWith('/') || f.path.includes('..')) {
        return { success: false, error: `invalid file path: ${f.path}` };
      }
      // Fail fast on path-as-content: the model occasionally passes a host
      // path (e.g. "/home/john/app.html" or "/tmp/foo.html") as the file
      // content, expecting the tool to read from disk. We don't — content
      // is the literal file body. Catch this early so we return a useful
      // error to the LLM instead of publishing a "build" whose entire
      // payload is the path string itself.
      const trimmed = f.content.trim();
      const looksLikePath =
        trimmed.length < 256 &&
        !trimmed.includes('\n') &&
        /^\/[A-Za-z0-9_./~-]+\.[A-Za-z0-9]{1,8}$/.test(trimmed);
      if (looksLikePath) {
        return {
          success: false,
          error:
            `files[${files.indexOf(f)}].content looks like a filesystem path ` +
            `("${trimmed}"), not file body text. The "content" field must be the ` +
            `literal HTML/CSS/JS as a string. Do not write the file separately ` +
            `and pass its path here — paste the body inline. Example: ` +
            `{ path: "index.html", content: "<!doctype html><html>...</html>" }.`,
        };
      }
    }

    const hasIndex = files.some((f) => f.path === 'index.html');
    if (!hasIndex) {
      return { success: false, error: 'one of the files must be named "index.html" (the entry point)' };
    }

    const prompt = String(args.prompt);
    const titleArg = typeof args.title === 'string' && args.title.trim().length > 0 ? args.title.trim() : null;
    const title = titleArg ?? prompt.split('\n')[0].slice(0, 60);

    const ctx = await resolveDefaultModel('builder');

    // Pre-create the build row so we have the buildId for the workspace path.
    const insertValues: Record<string, unknown> = {
      title,
      prompt,
      status: 'completed',
      origin: 'hermes',
      planStatus: 'approved',
      iterationsCompleted: 1,
      budgetConfig: { maxIterations: 10, maxTotalMinutes: 60 },
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
      enforceDesignSystem: false, // Hermes-origin starts as-is; user opts in to conformance via build_tweak.
      // Mark it servable — a static index.html is enough for publishBuild to copy.
      serveConfig: {
        port: 0,
        startCommand: null,
        healthCheck: '/',
        description: title,
        kind: 'static',
      },
    };
    if (toolCtx?.conversationId) insertValues.conversationId = toolCtx.conversationId;

    const [build] = await db.insert(jkaiBuilds).values(insertValues as any).returning();
    const buildId = build.id;

    // Materialise the workspace + write files to BOTH dev/ and live/ so the
    // publish path (which copies from live/) works without an extra promote step.
    await ensureWorkspace(buildId);
    const devRoot = `/home/jkai/workspace/${buildId}/dev`;
    const liveRoot = `/home/jkai/workspace/${buildId}/live`;
    const dirs = new Set<string>();
    for (const f of files) {
      const slash = f.path.lastIndexOf('/');
      if (slash > 0) dirs.add(f.path.slice(0, slash));
    }
    for (const d of dirs) {
      await execInSandbox(`mkdir -p ${devRoot}/${d} ${liveRoot}/${d}`);
    }
    for (const f of files) {
      const r1 = await writeFileInSandbox(`${devRoot}/${f.path}`, f.content);
      if (r1.exitCode !== 0) return { success: false, error: `write ${f.path} (dev): ${r1.stderr || 'failed'}` };
      const r2 = await writeFileInSandbox(`${liveRoot}/${f.path}`, f.content);
      if (r2.exitCode !== 0) return { success: false, error: `write ${f.path} (live): ${r2.stderr || 'failed'}` };
    }

    // Emit a single log line so the /jkai/builds detail page has something
    // to show instead of an empty timeline.
    const fileList = files.map((f) => `- ${f.path} (${Buffer.byteLength(f.content)} bytes)`).join('\n');
    await db.insert(jkaiLogs).values({
      buildId,
      type: 'system',
      content: `Hermes registered ${files.length} file${files.length === 1 ? '' : 's'}:\n${fileList}\n\nThe app is ready in the workspace. Hit Publish on the /jkai/builds card to ship to /projects/, or have Hermes call build_tweak to conform it to the site design system first.`,
    });

    return {
      success: true,
      data: {
        id: buildId,
        title,
        origin: 'hermes',
        status: 'completed',
        detailUrl: `/jkai/builds/${buildId}`,
        publishHint: 'Call build_control with action="publish" to ship to /projects/<slug>/, or build_tweak to refine first.',
      },
    };
  },
});

register({
  name: 'build_delete',
  destructive: true,
  description: 'Delete a build and all its iterations, logs, and workspace files',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Build ID' } },
    required: ['id'],
  },
  category: 'JKAI Builder',
  toolset: 'builds',
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
