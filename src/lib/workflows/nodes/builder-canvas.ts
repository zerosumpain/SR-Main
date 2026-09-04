/**
 * Workflow node definitions + executors for the canvas builder nodes:
 * builder-chat, builder-pi, build-view.
 *
 * These are the server-side executors invoked when the canvas is run as a
 * workflow. The interactive in-canvas UX (typing in the chat node, watching
 * the pi node stream) drives the same builder via /api/jkai/builds/* directly
 * — these executors are for *programmatic* / scheduled / sub-workflow use.
 */

import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { DEFAULT_BUILD_BUDGET } from '$lib/jkai/budget';
import { interpolateTemplate } from './template';
import { db } from '$lib/db';
import { jkaiBuilds, workflows } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveBuilderModel } from '$lib/server/models/workload-settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import type { ModelContext } from '$lib/server/models/types';
import { publishedLink } from '$lib/builds/published-link';
import { builderChatDef, builderPiDef, buildViewDef } from './builder-canvas.def';
export { builderChatDef, builderPiDef, buildViewDef } from './builder-canvas.def';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'paused']);

function tplString(raw: unknown, input: Record<string, unknown>): string {
  if (typeof raw !== 'string') return '';
  return interpolateTemplate(raw, input);
}

function pickNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// ──────────────────────────────────────────────────────────────────────────
// builder-chat
// ──────────────────────────────────────────────────────────────────────────


export const builderChatExecutor: NodeExecutor = {
  type: 'builder-chat',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    // Idempotent: if this chat node is already attached to a build (set
    // interactively in the canvas, persisted in node.config.buildId), return
    // that build's current snapshot instead of starting a fresh one. Prevents
    // every workflow Run from kicking off a new build.
    const attachedBuildId = String((config as { buildId?: unknown }).buildId ?? '').trim();
    if (attachedBuildId) {
      const [existing] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, attachedBuildId));
      if (existing) {
        return {
          output: {
            success: true,
            buildId: existing.id,
            status: existing.status,
            title: existing.title,
            reused: true,
          },
          rowCount: 1,
        };
      }
      // buildId set but row missing → fall through to a fresh start.
    }

    const prompt = tplString(config.prompt, input).trim();
    if (!prompt) {
      return { output: { success: false, error: 'prompt is required' }, rowCount: 1 };
    }

    let ctx: ModelContext;
    const provider = tplString(config.modelProvider, input).trim();
    const modelId = tplString(config.modelId, input).trim();
    if (provider === 'openrouter' && modelId) {
      ctx = { provider, modelId };
    } else {
      ctx = await resolveBuilderModel();
    }

    const priceSnapshot = await snapshotPrice(ctx);

    // Start from the shared floor so an unconfigured canvas node still gets
    // the caps — notably the idle brake. Every explicit value below wins.
    const budgetConfig: Record<string, number> = { ...DEFAULT_BUILD_BUDGET };
    const maxIterations = pickNumber(config.maxIterations);
    if (maxIterations !== undefined) budgetConfig.maxIterations = maxIterations;
    const maxTotalMinutes = pickNumber(config.maxTotalMinutes);
    if (maxTotalMinutes !== undefined) budgetConfig.maxTotalMinutes = maxTotalMinutes;
    const maxTokensPerHour = pickNumber(config.maxTokensPerHour);
    if (maxTokensPerHour !== undefined) budgetConfig.maxTokensPerHour = maxTokensPerHour;
    const activeMinutesPerHour = pickNumber(config.activeMinutesPerHour);
    if (activeMinutesPerHour !== undefined) budgetConfig.activeMinutesPerHour = activeMinutesPerHour;
    const minIterations = pickNumber(config.minIterations);
    if (minIterations !== undefined) budgetConfig.minIterations = minIterations;

    const insert: Record<string, unknown> = {
      prompt,
      budgetConfig,
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
      priceSnapshot,
    };
    if (typeof config.enforceDesignSystem === 'boolean') {
      insert.enforceDesignSystem = config.enforceDesignSystem;
    }
    if (config.planFirst === true) insert.planStatus = 'pending';
    const thinkingLevel = tplString(config.thinkingLevel, input).trim();
    const allowedThinking = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    if (allowedThinking.has(thinkingLevel)) insert.thinkingLevel = thinkingLevel;

    const [build] = await db.insert(jkaiBuilds).values(insert as any).returning();
    try {
      await builderClient.startBuild(build.id);
    } catch (err: unknown) {
      await db.update(jkaiBuilds).set({ status: 'failed' }).where(eq(jkaiBuilds.id, build.id));
      const msg = err instanceof Error ? err.message : String(err);
      return {
        output: { success: false, error: `started build ${build.id} but builder unavailable: ${msg}`, buildId: build.id },
        rowCount: 1,
      };
    }
    const [refreshed] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, build.id));
    return {
      output: {
        success: true,
        buildId: build.id,
        status: refreshed?.status ?? 'pending',
        title: refreshed?.title ?? null,
      },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation in config fields' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        buildId: { type: 'string' },
        status: { type: 'string' },
        error: { type: 'string' },
      },
    };
  },
};

// ──────────────────────────────────────────────────────────────────────────
// builder-pi — waits for an active build to reach a terminal state
// ──────────────────────────────────────────────────────────────────────────


export const builderPiExecutor: NodeExecutor = {
  type: 'builder-pi',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const buildId =
      tplString(config.buildId, input).trim() ||
      String((input as { buildId?: unknown })?.buildId ?? '').trim();
    if (!buildId) {
      return { output: { success: false, error: 'buildId is required (set in config or upstream input)' }, rowCount: 1 };
    }
    const waitForCompletion = config.waitForCompletion === true;
    const pollMs = Math.max(500, pickNumber(config.pollIntervalMs) ?? 2000);
    const maxWait = Math.max(5_000, pickNumber(config.maxWaitMs) ?? 8 * 60 * 60 * 1000);

    const start = Date.now();
    // Default = snapshot mode: read once and emit. Workflow runs that simply
    // want the current build state don't block waiting for terminal.
    if (!waitForCompletion) {
      const [row] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
      if (!row) return { output: { success: false, error: `build ${buildId} not found` }, rowCount: 1 };
      return {
        output: {
          success: true,
          buildId: row.id,
          status: row.status,
          iterationsCompleted: row.iterationsCompleted,
          tokensUsed: row.tokensUsed,
          costUsd: row.costUsd,
          serveConfig: row.serveConfig,
          publishedSlug: row.publishedSlug,
          failure: row.failure,
          terminal: TERMINAL_STATUSES.has(row.status),
        },
        rowCount: 1,
      };
    }

    // waitForCompletion: poll until terminal or timeout.
    while (Date.now() - start < maxWait) {
      const [row] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
      if (!row) {
        return { output: { success: false, error: `build ${buildId} not found` }, rowCount: 1 };
      }
      if (TERMINAL_STATUSES.has(row.status)) {
        return {
          output: {
            success: row.status === 'completed',
            buildId: row.id,
            status: row.status,
            iterationsCompleted: row.iterationsCompleted,
            tokensUsed: row.tokensUsed,
            costUsd: row.costUsd,
            serveConfig: row.serveConfig,
            publishedSlug: row.publishedSlug,
            failure: row.failure,
            elapsedMs: Date.now() - start,
            terminal: true,
          },
          rowCount: 1,
        };
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return {
      output: { success: false, error: `timed out waiting for build ${buildId} to finish`, buildId },
      rowCount: 1,
    };
  },

  getInputSchema() {
    return {
      type: 'object',
      properties: { buildId: { type: 'string' } },
    };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        buildId: { type: 'string' },
        status: { type: 'string' },
        iterationsCompleted: { type: 'number' },
        tokensUsed: { type: 'number' },
      },
    };
  },
};

// ──────────────────────────────────────────────────────────────────────────
// build-view — snapshot of the build right now
// ──────────────────────────────────────────────────────────────────────────


export const buildViewExecutor: NodeExecutor = {
  type: 'build-view',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const buildId =
      tplString(config.buildId, input).trim() ||
      String((input as { buildId?: unknown })?.buildId ?? '').trim();
    if (!buildId) {
      return { output: { success: false, error: 'buildId is required' }, rowCount: 1 };
    }
    const [row] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!row) {
      return { output: { success: false, error: `build ${buildId} not found` }, rowCount: 1 };
    }
    // Friendly workflow name — strip the "canvas:" prefix so downstream
    // templates (e.g. WhatsApp messages) read like a slug, not a uuid.
    let workflowName = '';
    if (context.workflowId) {
      const [wf] = await db.select().from(workflows).where(eq(workflows.id, context.workflowId));
      if (wf?.name) workflowName = wf.name.replace(/^canvas:/, '');
    }
    const previewUrl = row.publishedSlug
      ? (publishedLink(row.publishedSlug)?.href ?? null)
      : row.serveConfig
        ? `/api/jkai/proxy/${row.id}/`
        : null;
    // Captured postMessages from the iframe live in node.config.received
    // (populated by BuildViewNode in the canvas while the user interacts).
    // Emit that array as `value` so a downstream data-store(set,
    // valuePath='value') stores it cleanly.
    const received = Array.isArray((config as { received?: unknown[] }).received)
      ? ((config as { received?: unknown[] }).received as unknown[])
      : [];
    return {
      output: {
        success: true,
        buildId: row.id,
        workflowName,
        status: row.status,
        previewUrl,
        publishedSlug: row.publishedSlug,
        serveConfig: row.serveConfig,
        updatedAt: row.updatedAt,
        tokensUsed: row.tokensUsed,
        costUsd: row.costUsd,
        iterationsCompleted: row.iterationsCompleted,
        title: row.title,
        // Captured iframe data from the canvas — usable by downstream
        // data-store / whatsapp / transform via {{input.value}} and
        // {{input.value.length}}.
        value: received,
        receivedCount: received.length,
      },
      rowCount: received.length || 1,
    };
  },

  getInputSchema() {
    return { type: 'object', properties: { buildId: { type: 'string' } } };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        buildId: { type: 'string' },
        previewUrl: { type: 'string' },
        value: { type: 'array' },
        receivedCount: { type: 'number' },
      },
    };
  },
};
