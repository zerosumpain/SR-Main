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
import os from 'os';
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
    // Run the dispatcher on homeserv (residential IP, warm profile cookies).
    // dispatchScriptScrape proxies to /api/scraper/script when called from the
    // VPS; runs locally on homeserv. Returns { handled: false } when there's
    // no saved script AND no goal — in which case we fall through to the
    // legacy playbook / bare-scrape paths below.
    const callerVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      if (v == null) continue;
      callerVars[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    const dispatched = await dispatchScriptScrape({
      profile,
      seedUrl: url,
      goal: goal || undefined,
      searchQuery: searchQuery || undefined,
      vars: callerVars,
      workflowRunId: context.runId,
    });
    if (dispatched.handled) {
      context.emit({
        type: 'log', runId: context.runId, nodeId,
        data: {
          kind: dispatched.via === 'script' ? 'scraper.script.dispatch' : 'scraper.script.author_done',
          message: dispatched.via === 'script'
            ? `Ran saved script for "${profile}" — ${dispatched.items.length} items.`
            : `Authored script for "${profile}" — saved=${dispatched.success}, ${dispatched.items.length} items.`,
          via: dispatched.via,
          itemCount: dispatched.items.length,
          error: dispatched.error,
        },
        timestamp: new Date().toISOString(),
      } as any);
      context.emit({
        type: 'scraper.run.finished',
        runId: context.runId,
        runLogId: 0,
        success: dispatched.success,
        pagesLoaded: dispatched.items.length > 0 ? 1 : 0,
        error: dispatched.error,
        timestamp: new Date().toISOString(),
      } as any);
      return {
        output: {
          success: dispatched.success,
          items: dispatched.items,
          itemCount: dispatched.items.length,
          pages: dispatched.items.length > 0
            ? [{ url: dispatched.landedUrl ?? url, fields: { items: dispatched.items as unknown as string[] } }]
            : [],
          pageCount: dispatched.items.length > 0 ? 1 : 0,
          error: dispatched.error,
          [dispatched.via === 'script' ? 'viaScript' : 'viaScriptAuthor']: true,
          ...(dispatched.code ? { script: dispatched.code } : {}),
        },
        metadata: { _selectedHandle: 'output' },
        rowCount: dispatched.items.length || 1,
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
        rowCount: pb.pages.length || 1,
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
        rowCount: 1,
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
          rowCount: 1,
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
      rowCount: result.pages.length || 1,
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

interface ScriptDispatchInput {
  profile: string;
  seedUrl: string;
  goal?: string;
  searchQuery?: string;
  vars: Record<string, string>;
  workflowRunId: string;
}

interface ScriptDispatchOutput {
  handled: boolean;
  via: 'script' | 'script-author' | null;
  success: boolean;
  items: Array<Record<string, unknown>>;
  error?: string;
  landedUrl?: string;
  code?: string;
}

/**
 * Run the script-scrape dispatcher. On homeserv this calls runScript /
 * runScriptAuthor directly; on the VPS (or any non-homeserv host) it POSTs
 * to homeserv's /api/scraper/script proxy so the warm Playwright session
 * + SCRIPT_DIR files stay local to the residential IP.
 */
async function dispatchScriptScrape(input: ScriptDispatchInput): Promise<ScriptDispatchOutput> {
  if (process.env.SCRAPER_ALLOW_NON_HOMESERV || os.hostname() === 'homeserv') {
    const existing = await readScript(input.profile);
    if (existing) {
      const r = await runScript({
        profile: input.profile,
        searchQuery: input.searchQuery,
        vars: input.vars,
        workflowRunId: input.workflowRunId,
      });
      return {
        handled: true, via: 'script',
        success: r.success, items: r.items,
        error: r.error, landedUrl: r.landedUrl,
      };
    }
    if (input.goal) {
      const a = await runScriptAuthor({
        profile: input.profile,
        seedUrl: input.seedUrl,
        goal: input.goal,
        searchQuery: input.searchQuery,
        workflowRunId: input.workflowRunId,
      });
      return {
        handled: true, via: 'script-author',
        success: a.saved, items: a.sampleItems,
        error: a.error, code: a.code,
      };
    }
    return { handled: false, via: null, success: false, items: [] };
  }
  // VPS path — proxy to homeserv.
  const baseUrl = process.env.SCRAPER_SERVICE_URL;
  if (!baseUrl) {
    return {
      handled: false, via: null, success: false, items: [],
      error: `script-scrape needs SCRAPER_SERVICE_URL set on ${os.hostname()} so it can reach homeserv.`,
    };
  }
  const proxyUrl = baseUrl.replace(/\/api\/scraper\/run\/?$/, '') + '/api/scraper/script';
  const token = process.env.SCRAPER_SERVICE_TOKEN;
  try {
    // Author loop can take 5-10 min on first-run sites. Default undici body
    // timeout (~5 min) gave up halfway, the VPS fell back to the legacy
    // playbook and recorded its error — even though homeserv was still busy
    // and eventually saved the script. 20-min ceiling here covers worst
    // case while still bounded.
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        profile: input.profile,
        seedUrl: input.seedUrl,
        goal: input.goal,
        searchQuery: input.searchQuery,
        vars: input.vars,
        workflowRunId: input.workflowRunId,
      }),
      signal: AbortSignal.timeout(20 * 60 * 1000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        handled: false, via: null, success: false, items: [],
        error: `script-scrape proxy ${proxyUrl} returned HTTP ${res.status}: ${text.slice(0, 400)}`,
      };
    }
    const body = (await res.json()) as ScriptDispatchOutput;
    return body;
  } catch (e) {
    return {
      handled: false, via: null, success: false, items: [],
      error: `script-scrape proxy fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
