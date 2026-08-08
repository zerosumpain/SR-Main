import { register } from '../registry-internal';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { desc, eq, and, asc } from 'drizzle-orm';
import { resolvePublishSlug } from '$lib/jkai/publish-slug';

/**
 * Normalise the `files` argument of `register_hermes_build`.
 *
 * Hermes stringifies nested argument values on their way to a tool, so a
 * perfectly well-formed `files` array arrives in any of four shapes: the real
 * array, a JSON string holding the array, an array holding one JSON string, or
 * an array of per-file JSON strings. Rejecting the encoded forms taught the
 * model that the tool was broken rather than that its escaping was, and on
 * 2026-08-08 it responded by abandoning the tool and hand-editing a scratch
 * file in /tmp that had no connection to any build workspace.
 *
 * Parse what we can recognise; complain about the shape we actually got when
 * we can't. Same underlying cause as `urlsFromArgs` in chat/tool-summary.ts.
 */
export function coerceFilesArg(
  raw: unknown,
): { ok: true; files: Array<{ path: string; content: string }> } | { ok: false; error: string } {
  const parseMaybe = (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    const t = v.trim();
    if (!t.startsWith('[') && !t.startsWith('{')) return v;
    try {
      return JSON.parse(t);
    } catch {
      return v;
    }
  };

  let value = parseMaybe(raw);
  // An array holding a single stringified array is still the array.
  if (Array.isArray(value) && value.length === 1) {
    const inner = parseMaybe(value[0]);
    if (Array.isArray(inner)) value = inner;
  }
  if (!Array.isArray(value)) value = [value];

  const files = (value as unknown[]).map(parseMaybe);
  if (files.length === 0) return { ok: false, error: 'files[] is required and must be non-empty' };

  const out: Array<{ path: string; content: string }> = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      return {
        ok: false,
        error:
          `files[${i}] is ${describeShape(f)}, not an object. Each entry must be ` +
          `{ path: "index.html", content: "<!doctype html>…" }.`,
      };
    }
    const rec = f as Record<string, unknown>;
    const path = rec.path ?? rec.name ?? rec.filename;
    const content = rec.content ?? rec.body ?? rec.text;
    if (typeof path !== 'string' || !path) {
      return {
        ok: false,
        error: `files[${i}] has no "path". Got keys: ${Object.keys(rec).join(', ') || '(none)'}.`,
      };
    }
    if (typeof content !== 'string') {
      return {
        ok: false,
        error: `files[${i}] ("${path}") has content of type ${describeShape(content)}; it must be the file body as a string.`,
      };
    }
    out.push({ path, content });
  }
  return { ok: true, files: out };
}

function describeShape(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'missing';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

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
    const ctx = await resolveDefaultModel();
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
  description:
    'List recent JKAI builds with status (pending/running/completed/failed). ' +
    'Compact by default — returns only the identifying fields (id, title, status, publishedSlug, createdAt) to keep token usage low. ' +
    'Pass verbose:true to return the full rows including heavy columns (prompt, config, serve_config, model fields).',
  parameters: {
    type: 'object',
    properties: {
      verbose: { type: 'boolean', description: 'Set true to return full rows including heavy columns; defaults to compact identifying fields only' },
    },
    required: [],
  },
  category: 'JKAI Builder',
  toolset: 'builds',
  handler: async (args) => {
    const verbose = (args?.verbose as boolean) === true;
    if (verbose) {
      const rows = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt)).limit(50);
      return { success: true, data: rows };
    }
    const rows = await db
      .select({
        id: jkaiBuilds.id,
        title: jkaiBuilds.title,
        status: jkaiBuilds.status,
        publishedSlug: jkaiBuilds.publishedSlug,
        createdAt: jkaiBuilds.createdAt,
      })
      .from(jkaiBuilds)
      .orderBy(desc(jkaiBuilds.createdAt))
      .limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'build_control',
  // Deliberately NOT destructive (changed 2026-08-08). Publishing a static app
  // to /projects/ is reversible (build_delete unpublishes, and the previous
  // build row keeps its workspace), and gating it cost more than it protected:
  // on 2026-08-08 two publishes of the same app died at this call — one timed
  // out after 240s against a confirmer whose turn had already been persisted,
  // one was denied outright because it came from a headless [heartbeat] turn.
  // Both failures were invisible to the user, who was left looking at a
  // calculator that returned 0 for every sum.
  //
  // `build_delete` stays gated — that one is not reversible. The takeover rule
  // below is what replaces the prompt: an accidental publish can create a page,
  // but it cannot silently overwrite somebody else's.
  description:
    'Control a JKAI build: pause, resume, stop, or publish it. ' +
    'Publishing ships the build\'s live/ directory to https://strangeramblings.com/projects/<slug>/. ' +
    'Pass `slug` to choose the address — this is how you REPLACE an existing project page ' +
    '(e.g. improving the app at /projects/simple-calculator/ means publishing the new build with slug "simple-calculator"). ' +
    'Without `slug` the address is derived from the build title, which creates a NEW page rather than updating one.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Build ID' },
      action: { type: 'string', description: 'Action: "pause", "resume", "stop", or "publish"' },
      slug: {
        type: 'string',
        description:
          'Publish only. The /projects/<slug>/ address to publish to. Required when taking over a slug that currently belongs to a different build — otherwise the publish is refused rather than silently overwriting it.',
      },
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

      const requested = typeof args.slug === 'string' ? args.slug.trim() : '';
      const resolved = resolvePublishSlug(build, requested);
      if (!resolved.ok) return { success: false, error: resolved.error };
      const slug = resolved.slug;

      // Refuse to take a slug off another build unless the caller named it.
      // A derived slug that happens to collide is an accident; a typed one is
      // an instruction. Without this, ungating publish would let a headless
      // turn overwrite an unrelated project page.
      const [owner] = await db
        .select({ id: jkaiBuilds.id, title: jkaiBuilds.title })
        .from(jkaiBuilds)
        .where(eq(jkaiBuilds.publishedSlug, slug))
        .limit(1);
      if (owner && owner.id !== id && !requested) {
        return {
          success: false,
          error:
            `/projects/${slug}/ already belongs to build ${owner.id}` +
            `${owner.title ? ` ("${owner.title}")` : ''}. ` +
            `Pass slug:"${slug}" explicitly to replace it, or pick a different slug.`,
        };
      }

      await publishBuild(id, slug);
      await db.transaction(async (tx) => {
        // One slug, one owner: the previous holder loses the pointer, or the
        // /jkai/builds list shows two cards both claiming the same URL.
        if (owner && owner.id !== id) {
          await tx
            .update(jkaiBuilds)
            .set({ publishedSlug: null, updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, owner.id));
        }
        await tx
          .update(jkaiBuilds)
          .set({ publishedSlug: slug, updatedAt: new Date() })
          .where(eq(jkaiBuilds.id, id));
      });
      return {
        success: true,
        data: {
          slug,
          url: `https://strangeramblings.com/projects/${slug}/`,
          replaced: owner && owner.id !== id ? owner.id : undefined,
        },
      };
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
    'If no, leave it — the user can still hit "Publish" from the /jkai/builds card to ship the raw version. ' +
    'IMPROVING AN APP THAT IS ALREADY LIVE: pass `updateBuildId` so this replaces the existing build instead of creating another one, ' +
    'then publish with `build_control` passing the SAME `slug` the app already uses — otherwise the old, broken page stays up at its old address. ' +
    'EDITING: to revise a registered app, call this again with the full corrected file bodies, or use `build_write_file`. ' +
    'Do NOT edit the app through your own local write_file/patch tools — those touch your scratch filesystem, which is not the build workspace, ' +
    'and the change will never reach the build or the site.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short human-readable title (e.g. "Quick calculator", "Daily mood tracker"). Auto-generated from prompt if omitted.' },
      prompt: { type: 'string', description: 'The user request that led to this app — used as the "build prompt" for accounting and any future continuation pass. Free text, 1-2 sentences.' },
      updateBuildId: {
        type: 'string',
        description:
          'Optional. The id of an existing hermes-origin build to REPLACE (same row, same workspace, same published slug) rather than creating a new one. Use this for every revision of an app you already registered in this conversation.',
      },
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

    const coerced = coerceFilesArg(args.files);
    if (!coerced.ok) return { success: false, error: coerced.error };
    const files = coerced.files;
    for (const f of files) {
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

    const ctx = await resolveDefaultModel();

    // Re-registering an app the model has just revised should REPLACE it, not
    // mint a third row. Without this, one 2026-08-08 conversation produced
    // three "calculator" builds for one app, two of them dead ends, and the
    // published page pointed at the oldest and most broken of them.
    const updateId = typeof args.updateBuildId === 'string' ? args.updateBuildId.trim() : '';
    let build: typeof jkaiBuilds.$inferSelect;
    if (updateId) {
      const [existing] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, updateId)).limit(1);
      if (!existing) return { success: false, error: `no build ${updateId} to update` };
      if (existing.origin !== 'hermes') {
        return {
          success: false,
          error: `build ${updateId} was made by the ${existing.origin} builder; this tool only replaces the files of a build it registered itself.`,
        };
      }
      const [updated] = await db
        .update(jkaiBuilds)
        .set({ title, prompt, status: 'completed', updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, updateId))
        .returning();
      build = updated;
    } else {
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
      const [inserted] = await db.insert(jkaiBuilds).values(insertValues as any).returning();
      build = inserted;
    }
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
      content: `Hermes ${updateId ? 're-registered' : 'registered'} ${files.length} file${files.length === 1 ? '' : 's'}:\n${fileList}\n\nThe app is ready in the workspace. Hit Publish on the /jkai/builds card to ship to /projects/, or have Hermes call build_tweak to conform it to the site design system first.`,
    });

    // The address this build already answers on, if any. Handing it back means
    // the model can republish over the SAME page instead of deriving a new
    // slug from a new title and leaving the broken one live.
    const publishedSlug = build.publishedSlug ?? null;
    return {
      success: true,
      data: {
        id: buildId,
        title,
        origin: 'hermes',
        status: 'completed',
        replacedExisting: updateId ? true : undefined,
        publishedSlug,
        detailUrl: `/jkai/builds/${buildId}`,
        publishHint: publishedSlug
          ? `This build is live at /projects/${publishedSlug}/. To update that page call build_control with action="publish", id="${buildId}" and slug="${publishedSlug}" — omitting the slug would publish to a different address and leave the old page up.`
          : 'Call build_control with action="publish" to ship to /projects/<slug>/ (pass slug to choose the address), or build_tweak to refine first.',
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
