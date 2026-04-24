import type { NodeExecutor, NodeResult } from '../types';
import { interpolateTemplateStrict } from './template';
import { runScrape } from '$lib/workflows/scraper/runner';
import type { ScrapeJob, ScrapeResult } from '$lib/workflows/scraper/types';
import { createInteraction } from '$lib/workflows/engine-interactions';
import {
  startRemoteInteractiveSession,
  stopRemoteInteractiveSession,
} from '$lib/workflows/scraper/interactive-remote';
import { loadPlaybookForUrl, runPlaybook } from '$lib/workflows/scraper/playbook';
import { runSiteMapper } from '$lib/workflows/scraper/site-mapper';
import { runScript } from '$lib/workflows/scraper/script-runner';
import { runScriptAuthor } from '$lib/workflows/scraper/script-author';
import { readScript } from '$lib/workflows/scraper/script-store';
import { db } from '$lib/db';
import { workflowInteractions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export { stealthScrapeDef } from './stealth-scrape.def';

const INTERACTIVE_TIMEOUT_MINUTES = 15;
const INTERACTIVE_POLL_INTERVAL_MS = 3_000;

export const stealthScrapeExecutor: NodeExecutor = {
  type: 'stealth-scrape',

  async execute(input, config, context): Promise<NodeResult> {
    const url = interpolateTemplateStrict((config.url as string) || '', input).result;
    const profile = (config.profile as string) || 'default';
    const waitFor = config.waitFor as ScrapeJob['waitFor'];
    const extract = (config.extract as ScrapeJob['extract']) || [];
    const pagination = config.pagination as ScrapeJob['pagination'] | undefined;
    const credentialId = config.credentialId as number | undefined;
    const pacing = config.pacing as ScrapeJob['pacing'] | undefined;
    const goal = ((config.goal as string) || '').trim();
    const searchQuery = ((config.searchQuery as string) || '').trim();
    const nodeId = (context as unknown as { _currentNodeId?: string })._currentNodeId ?? '';

    const emitProgress = (ev: Record<string, unknown>) => {
      context.emit({
        type: 'scraper.progress',
        runId: context.runId,
        runLogId: 0,
        stage: (ev.t as any) ?? 'page.done',
        url: ev.url as string | undefined,
        pageIndex: ev.pageIndex as number | undefined,
        error: ev.error as string | undefined,
        timestamp: new Date().toISOString(),
      } as any);
    };

    const baseJob = {
      url, profile, waitFor, extract, pagination, credentialId, pacing,
      workflowRunId: context.runId,
      onProgress: emitProgress,
    };

    // ===== script-scrape dispatch (preferred) =====
    // If a saved Python scrape script exists for this profile, run it.
    // Authored once by an LLM (script-author), executed deterministically
    // forever after. The artifact is real Python code with full Playwright
    // access — no declarative-playbook brittleness.
    const existingScript = await readScript(profile);
    if (existingScript) {
      context.emit({
        type: 'log', runId: context.runId, nodeId,
        data: {
          kind: 'scraper.script.dispatch',
          message: `Using saved scrape script "${profile}" (authored ${existingScript.meta.generatedAt})`,
          declaredVars: existingScript.meta.declaredVars.map((v) => v.name),
        },
        timestamp: new Date().toISOString(),
      } as any);
      const callerVars: Record<string, string> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v == null) continue;
        callerVars[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      const r = await runScript({
        profile,
        searchQuery: searchQuery || undefined,
        vars: callerVars,
        workflowRunId: context.runId,
        onProgress: (ev) => context.emit({
          type: 'log', runId: context.runId, nodeId,
          data: { kind: 'scraper.script', ...ev },
          timestamp: new Date().toISOString(),
        } as any),
      });
      context.emit({
        type: 'scraper.run.finished',
        runId: context.runId,
        runLogId: 0,
        success: r.success,
        pagesLoaded: r.items.length > 0 ? 1 : 0,
        error: r.error,
        timestamp: new Date().toISOString(),
      } as any);
      return {
        output: {
          success: r.success,
          items: r.items,
          itemCount: r.items.length,
          pages: r.items.length > 0
            ? [{ url: r.landedUrl ?? url, fields: { items: r.items as unknown as string[] } }]
            : [],
          pageCount: r.items.length > 0 ? 1 : 0,
          error: r.error,
          viaScript: true,
        },
        metadata: { _selectedHandle: 'output' },
      };
    }

    // ===== first-time script authoring =====
    // No saved script for this profile, but the user gave us a goal —
    // kick off the LLM authoring loop. The LLM iteratively writes a
    // Python scrape function, runs it inside the same warm Playwright
    // session (cookies / altcha solves persist), saves when validated.
    if (goal && !existingScript) {
      context.emit({
        type: 'log', runId: context.runId, nodeId,
        data: {
          kind: 'scraper.script.author_start',
          message: `Authoring scrape script for ${profile} (first run, ~5–10 min). Subsequent runs replay the script in seconds.`,
          seedUrl: url,
          goal,
        },
        timestamp: new Date().toISOString(),
      } as any);
      const authored = await runScriptAuthor({
        profile,
        seedUrl: url,
        goal,
        searchQuery: searchQuery || undefined,
        workflowRunId: context.runId,
        onProgress: (ev) => context.emit({
          type: 'log', runId: context.runId, nodeId,
          data: { kind: 'scraper.script.author', ...ev },
          timestamp: new Date().toISOString(),
        } as any),
      });
      context.emit({
        type: 'log', runId: context.runId, nodeId,
        data: {
          kind: 'scraper.script.author_done',
          saved: authored.saved,
          declaredVars: authored.declaredVars.map((v) => v.name),
          itemCount: authored.sampleItems.length,
          error: authored.error,
        },
        timestamp: new Date().toISOString(),
      } as any);
      return {
        output: {
          success: authored.saved,
          items: authored.sampleItems,
          itemCount: authored.sampleItems.length,
          pages: authored.sampleItems.length > 0
            ? [{ url, fields: { items: authored.sampleItems as unknown as string[] } }]
            : [],
          pageCount: authored.sampleItems.length > 0 ? 1 : 0,
          error: authored.saved ? undefined : authored.error,
          viaScriptAuthor: true,
          script: authored.code,
        },
        metadata: { _selectedHandle: 'output' },
      };
    }

    // Playbook dispatch: if the site-mapper has generated a playbook for
    // this domain, use it — deterministic recipe beats re-deriving nav +
    // selectors per run. The playbook's urlTemplate can consume
    // {{input.keyword}} / {{input.<field>}} from the node's input map
    // (stringified to be safe for URL substitution).
    const playbook = await loadPlaybookForUrl(url);
    if (playbook) {
      context.emit({
        type: 'log',
        runId: context.runId,
        nodeId,
        data: {
          kind: 'scraper.playbook_dispatch',
          message: `Using saved playbook for ${new URL(url).hostname} (generated ${playbook.generatedAt})`,
          playbookVersion: playbook.version,
        },
        timestamp: new Date().toISOString(),
      } as any);
      // Upstream-wired vars only. Do NOT pre-seed `keyword` from searchQuery
      // here — the v2 playbook runner decomposes searchQuery into the
      // playbook's declared requiredVars (keyword / location / distance /
      // salaryMin) via decomposeSearchQuery(). Assigning the whole sentence
      // to `keyword` here would bypass that and stuff it into a form field
      // whole (the original timeout bug).
      const vars: Record<string, string> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v == null) continue;
        vars[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      const pb = await runPlaybook({
        playbook,
        vars,
        // Pass the raw searchQuery so the runner can decompose it into the
        // playbook's requiredVars (keyword / location / distance / salaryMin
        // etc). Caller-supplied `vars` still win — this only fills gaps.
        searchQuery: searchQuery || undefined,
        profile,
        workflowRunId: context.runId,
        onProgress: emitProgress,
      });
      context.emit({
        type: 'scraper.run.finished',
        runId: context.runId,
        runLogId: pb.runLogId ?? 0,
        success: pb.success,
        pagesLoaded: pb.pages.length,
        error: pb.error,
        timestamp: new Date().toISOString(),
      } as any);
      return {
        output: {
          success: pb.success,
          pages: pb.pages,
          pageCount: pb.pages.length,
          error: pb.error,
          runLogId: pb.runLogId,
          viaPlaybook: true,
          itemCount: pb.itemCount,
          acceptanceMet: pb.acceptanceMet,
        },
        metadata: { _selectedHandle: 'output' },
      };
    }

    // Auto-map stage: no playbook exists for this domain AND the user
    // provided a goal describing what to extract. Invoke the site-mapper
    // inline — its agent loop navigates from the seed URL, finalizes with
    // a playbook, and extracts from the SAME session (warm cookies, solved
    // altcha) — so we get results on this very first run without a fragile
    // fresh-session replay. The playbook is saved for all future runs.
    if (goal && !playbook) {
      context.emit({
        type: 'log',
        runId: context.runId,
        nodeId,
        data: {
          kind: 'scraper.auto_map.start',
          message: `No playbook for this site yet — mapping it now (first run only, ~3-5 min). Subsequent runs will replay deterministically.`,
          seedUrl: url,
          goal,
          searchQuery: searchQuery || null,
        },
        timestamp: new Date().toISOString(),
      } as any);
      const mapping = await runSiteMapper({
        seedUrl: url,
        goal,
        searchQuery: searchQuery || undefined,
        profile,
        workflowRunId: context.runId,
        onProgress: (ev) => emitProgress(ev as Record<string, unknown>),
      });
      context.emit({
        type: 'log',
        runId: context.runId,
        nodeId,
        data: {
          kind: 'scraper.auto_map.done',
          validated: mapping.validated,
          itemCount: mapping.itemCount,
          error: mapping.error,
          message: mapping.validated
            ? `Auto-mapped ${mapping.domain} — got ${mapping.itemCount} items. Playbook saved.`
            : `Mapping completed but validation failed: ${mapping.error ?? 'unknown'}`,
        },
        timestamp: new Date().toISOString(),
      } as any);
      return {
        output: {
          success: mapping.validated,
          pages: mapping.firstItemSample
            ? [{ url: mapping.landedUrl ?? url, fields: mapping.firstItemSample as Record<string, string | string[]> }]
            : [],
          pageCount: mapping.firstItemSample ? 1 : 0,
          itemCount: mapping.itemCount,
          error: mapping.validated ? undefined : mapping.error,
          viaAutoMap: true,
          playbook: mapping.playbook,
          transcript: mapping.transcript.slice(-10),
        },
        metadata: { _selectedHandle: 'output' },
      };
    }

    let result = await runScrape(baseJob);

    // CAPTCHA / bot-wall / cookie-consent signal from the Python side.
    // Spawn a headed session on the scraper host (homeserv) so the user can
    // solve it through the canvas's noVNC modal. When they click Continue,
    // the workflow_interactions row gets resolvedAt; we detect that here,
    // stop the VNC session (freeing the profile dir), and retry the scrape
    // — the now-seeded cookies should let the headless pass through.
    if (result.needsInteractive && nodeId) {
      const landingUrl = result.currentUrl || url;
      const reason = result.challengeReason || 'captcha';
      try {
        const session = await startRemoteInteractiveSession(profile, landingUrl);
        const interactionId = await createInteraction({
          runId: context.runId,
          nodeId,
          mode: 'vnc',
          prompt:
            `Scraper hit a ${reason} on ${landingUrl}. ` +
            `Solve it in the window above (click through any CAPTCHA / cookie consent / login wall), ` +
            `then click Continue to retry the scrape — cookies will be saved to the "${profile}" profile for next time.`,
          configSnapshot: {
            url: landingUrl,
            wsPort: session.wsPort,
            vncUrl: session.vncUrl,
            profile,
            reason,
          },
          vncSessionId: session.sessionId,
          timeoutMinutes: INTERACTIVE_TIMEOUT_MINUTES,
        });

        context.emit({
          type: 'log',
          runId: context.runId,
          nodeId,
          data: {
            kind: 'scraper.awaiting_interactive',
            interactionId,
            reason,
            url: landingUrl,
          },
          timestamp: new Date().toISOString(),
        } as any);

        await waitForInteractionResolution(interactionId, INTERACTIVE_TIMEOUT_MINUTES * 60 * 1000);
        await stopRemoteInteractiveSession(session.sessionId);
      } catch (err) {
        return {
          output: {
            success: false,
            pages: [],
            pageCount: 0,
            error: `Interactive fallback failed: ${err instanceof Error ? err.message : String(err)}`,
          },
          metadata: { _selectedHandle: 'output' },
        };
      }

      // Retry once. If the retry ALSO trips the challenge detector, treat it
      // as a hard failure — the human solve didn't actually clear the wall,
      // or the site serves a fresh challenge per session.
      result = await runScrape(baseJob);
      if (result.needsInteractive) {
        result = {
          ...result,
          success: false,
          error:
            result.error ??
            `Challenge re-appeared after interactive solve (${result.challengeReason ?? 'unknown'}). ` +
            `The profile may not be persisting cookies, or the site serves a new challenge per session.`,
        };
      }
    }

    context.emit({
      type: 'scraper.run.finished',
      runId: context.runId,
      runLogId: result.runLogId ?? 0,
      success: result.success,
      pagesLoaded: result.pages.length,
      error: result.error,
      timestamp: new Date().toISOString(),
    } as any);

    return {
      output: {
        success: result.success,
        pages: result.pages,
        pageCount: result.pages.length,
        error: result.error,
        runLogId: result.runLogId,
      },
      metadata: { _selectedHandle: 'output' },
    };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for URL template interpolation (e.g. {{input.url}})' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        pages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              fields: { type: 'object' },
            },
          },
        },
        pageCount: { type: 'number' },
        error: { type: 'string' },
        runLogId: { type: 'number' },
      },
    };
  },
};

/**
 * Block-poll `workflow_interactions` for the given id until `resolvedAt` is
 * set (user clicked Continue) or the row is cancelled or we exceed the
 * timeout. Returns the final interaction row; throws on timeout/cancel.
 */
async function waitForInteractionResolution(
  interactionId: number,
  maxWaitMs: number,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const [row] = await db
      .select({
        resolvedAt: workflowInteractions.resolvedAt,
        cancelled: workflowInteractions.cancelled,
      })
      .from(workflowInteractions)
      .where(eq(workflowInteractions.id, interactionId));
    if (!row) throw new Error(`interaction ${interactionId} disappeared`);
    if (row.cancelled) throw new Error(`interaction ${interactionId} was cancelled`);
    if (row.resolvedAt) return;
    await new Promise((r) => setTimeout(r, INTERACTIVE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `interaction ${interactionId} not resolved within ${Math.round(maxWaitMs / 1000)}s — human solve timed out`,
  );
}
