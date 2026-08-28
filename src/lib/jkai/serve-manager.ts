import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import {
  readServeJson,
  startProjectServer,
  killProjectServer,
  readProjectServerLogTail,
  promoteDevToLive,
  allocatePort,
  writeFileInSandbox,
} from './sandbox';
import { validateServeConfig, autodetectServeConfig } from './serve';
import { emitLog } from './log-emitter';
import { emitStage } from './stage-events';

/**
 * Resolve and apply the project's serve config for a build, then promote
 * dev→live and (re)start the project server. Owns: serve.json validation,
 * package.json autodetection fallback, port-collision reassignment across
 * concurrent builds, dev→live promotion, server start + health-check, and
 * preview-link surfacing on success or log-tail diagnostics on failure.
 *
 * Pure infrastructure: takes only a buildId, mutates the build row's
 * serveConfig and emits log/stage events. Called from the orchestrator
 * after each iteration's post-processing.
 */
export async function manageServeConfig(buildId: string): Promise<void> {
  // Resolve a serve config from one of three sources, in order of trust:
  //   1. dev/serve.json — agent-declared (highest authority)
  //   2. dev/serve.json that fails validation — log loud + bail
  //   3. autodetect from package.json scripts.dev/start — gives us a
  //      preview link on iteration #1 even before the agent has formally
  //      declared one. Marked with `[autodetected]` in description so the
  //      agent knows to override it.
  let config: ReturnType<typeof validateServeConfig> = null;
  let source: 'serve.json' | 'autodetect' | 'none' = 'none';
  const raw = await readServeJson(buildId);
  if (raw) {
    config = validateServeConfig(raw);
    if (!config) {
      await emitLog(buildId, 'error',
        'Found dev/serve.json but it failed validation. Required fields: ' +
        'port (1024-65535 number), startCommand (non-empty string), healthCheck (path starting with /).',
      );
      await emitStage(buildId, { stage: 'iterating', previewUrl: null });
      return;
    }
    source = 'serve.json';
  } else {
    config = await autodetectServeConfig(buildId);
    if (config) {
      source = 'autodetect';
      await emitLog(buildId, 'system',
        `Preview: no dev/serve.json yet — autodetected from package.json. ` +
        `Trying \`${config.startCommand}\` on port ${config.port}. ` +
        `Write dev/serve.json to override.`,
      );
    }
  }

  if (!config) {
    await emitLog(buildId, 'system',
      'Preview: not started — no dev/serve.json and no recognised package.json scripts. ' +
      'Write dev/serve.json with { port, startCommand, healthCheck } to enable the live preview.',
    );
    await emitStage(buildId, { stage: 'iterating', previewUrl: null });
    return;
  }

  // serve-manager runs the dev-server promotion flow; it doesn't apply to
  // static-kind builds (register_chat_build) which are served directly
  // by the proxy from the live/ workspace. Bail early if startCommand is
  // null — only the dev-server path needs to start a process.
  if (!config.startCommand) {
    await emitStage(buildId, { stage: 'iterating', previewUrl: `/api/jkai/proxy/${buildId}/` });
    return;
  }

  const [build] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, buildId));

  // Enforce per-build port allocation. If the agent picked a port that
  // collides with another build's stored serveConfig, reassign it.
  const currentConfig = build?.serveConfig as any;
  const keepExisting = currentConfig?.port === config.port;
  if (!keepExisting) {
    // Two columns of the rows that actually have a serveConfig, not every
    // column of every build ever made — this only needs the ports.
    const allBuilds = await db
      .select({ id: jkaiBuilds.id, serveConfig: jkaiBuilds.serveConfig })
      .from(jkaiBuilds)
      .where(isNotNull(jkaiBuilds.serveConfig));
    const takenPorts = new Set(
      allBuilds
        .filter((b) => b.id !== buildId)
        .map((b) => (b.serveConfig as any)?.port)
        .filter(Boolean),
    );
    if (takenPorts.has(config.port)) {
      const assigned = await allocatePort(buildId);
      await emitLog(
        buildId,
        'system',
        `Port ${config.port} already assigned to another build — reassigning to ${assigned}`,
      );
      const rewritten = config.startCommand.replace(new RegExp(`\\b${config.port}\\b`, 'g'), String(assigned));
      config.port = assigned;
      config.startCommand = rewritten;
      // Only persist the rewrite when the agent had declared serve.json
      // — for autodetected configs we don't want to plant a file the
      // agent didn't ask for; the orchestrator will re-derive next turn.
      if (source === 'serve.json') {
        const payload = JSON.stringify(config, null, 2);
        await writeFileInSandbox(`/home/jkai/workspace/${buildId}/dev/serve.json`, payload);
        await writeFileInSandbox(`/home/jkai/workspace/${buildId}/live/serve.json`, payload).catch(() => {});
      }
    }
  }
  const configChanged = currentConfig?.port !== config.port || currentConfig?.startCommand !== config.startCommand;

  await emitLog(buildId, 'system', 'Promoting dev → live');
  await emitStage(buildId, { stage: 'promoting' });
  await promoteDevToLive(buildId);

  // Route through the SvelteKit proxy (/api/jkai/proxy/<id>/...) — see
  // src/routes/api/jkai/proxy/[id]/[...path]/+server.ts. The sandbox is
  // bridge-networked with no host port publishing, so http://homeserv:<port>
  // is unreachable from the user's browser. The proxy fetches via the
  // container's bridge IP + agent port and rewrites HTML hrefs through
  // a <base> tag so relative URLs resolve back through the proxy.
  const previewUrl = `/api/jkai/proxy/${buildId}/`;
  const action = configChanged ? 'Starting' : 'Restarting';
  if (configChanged) {
    await emitLog(buildId, 'system', `Starting project server on port ${config.port}: ${config.startCommand}`);
  } else if (currentConfig) {
    await killProjectServer(buildId);
  } else {
    // Should not happen — config matches stored but no stored row. Restart anyway.
    await killProjectServer(buildId);
  }

  const healthy = await startProjectServer(
    buildId,
    config.startCommand,
    config.port,
    config.healthCheck,
  );

  if (healthy) {
    // Persist serveConfig so subsequent iterations skip the costly cold-start.
    // For autodetected runs we still persist so the next iteration's
    // configChanged branch works (won't re-autodetect every turn).
    await db
      .update(jkaiBuilds)
      .set({ serveConfig: config, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system',
      `Preview: live at ${previewUrl}${source === 'autodetect' ? ' (autodetected — override by writing dev/serve.json)' : ''}`,
    );
    await emitStage(buildId, { stage: 'iterating', previewUrl });
  } else {
    const tail = (await readProjectServerLogTail(buildId, 30)).trim();
    const tailMessage = tail
      ? `Preview: ${action.toLowerCase()} failed health check on port ${config.port}. Last server log lines:\n${tail}`
      : `Preview: ${action.toLowerCase()} failed health check on port ${config.port} and no server log was produced. ` +
        `The start command may not have launched at all — check that '${config.startCommand}' runs in the workspace dir.`;
    await emitLog(buildId, 'error', tailMessage);
    await emitStage(buildId, { stage: 'iterating', previewUrl: null });
  }
}
