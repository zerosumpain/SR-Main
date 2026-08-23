import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { db } from '$lib/db';
import { scraperRunLog } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureContainerRunning, execInContainer, writeFileInContainer } from '$lib/jkai/sandbox';
import { normalizeProfileName } from './profiles';
import { loadCredentialForRunner } from './credentials';
import type { ScrapeJob, ScrapeResult } from './types';

const RUNNER_SANDBOX_PATH = '/home/jkai/scraper-runtime/scrape.py';

const HOMESERV_HOSTNAMES = ['homeserv'];

function isOnHomeserv(): boolean {
  return HOMESERV_HOSTNAMES.includes(os.hostname());
}

function runnerSourcePath(): string {
  const here = fileURLToPath(new URL('./python/scrape.py', import.meta.url));
  return here;
}

function readRunnerSource(): string {
  try {
    return readFileSync(runnerSourcePath(), 'utf8');
  } catch {
    return readFileSync(join(process.cwd(), 'src/lib/workflows/scraper/python/scrape.py'), 'utf8');
  }
}

export interface RunScrapeOptions extends ScrapeJob {
  workflowRunId?: string;
  onProgress?: (event: Record<string, unknown>) => void;
}

export async function runScrape(opts: RunScrapeOptions): Promise<ScrapeResult> {
  // Residential-IP architecture: stealth scraping MUST run on homeserv (residential IP),
  // NEVER the VPS (datacenter IP — would get bot-detected and potentially banned).
  //
  // - On homeserv: run locally via jkai-sandbox.
  // - On VPS (or anywhere else): proxy the job to homeserv via SCRAPER_SERVICE_URL.
  //   That URL points at homeserv's `/api/scraper/run` endpoint (reachable over
  //   Tailscale, e.g. http://homeserv.tail668b8c.ts.net:5173).
  // - Escape hatch: SCRAPER_ALLOW_NON_HOMESERV=1 forces local execution regardless
  //   of host (dev / integration testing only).
  if (!process.env.SCRAPER_ALLOW_NON_HOMESERV && !isOnHomeserv()) {
    const proxyUrl = process.env.SCRAPER_SERVICE_URL;
    if (!proxyUrl) {
      throw new Error(
        `stealth-scrape refuses to run on host '${os.hostname()}': ` +
        `this is not homeserv and SCRAPER_SERVICE_URL is not configured. ` +
        `Set SCRAPER_SERVICE_URL to homeserv's /api/scraper/run endpoint (over Tailscale), ` +
        `or run this workflow on homeserv directly. Running here would expose a ` +
        `datacenter IP and defeat the whole point of stealth scraping.`,
      );
    }
    return await proxyScrapeToHomeserv(proxyUrl, opts);
  }

  await ensureContainerRunning();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = `/home/jkai/scraper-runtime/runs/${runId}`;
  await execInContainer(`mkdir -p ${runDir} /home/jkai/scraper-runtime`);

  await writeFileInContainer(RUNNER_SANDBOX_PATH, readRunnerSource());

  const { credentialId, onProgress, workflowRunId, ...job } = opts;
  const jobNormalized: Record<string, unknown> = {
    ...job,
    profile: normalizeProfileName(opts.profile),
  };
  if (credentialId) {
    const cred = await loadCredentialForRunner(credentialId);
    if (!cred) throw new Error(`credential ${credentialId} not found`);
    jobNormalized._credential = cred;
  }

  const jobPath = `${runDir}/job.json`;
  await writeFileInContainer(jobPath, JSON.stringify(jobNormalized));

  const [logRow] = await db.insert(scraperRunLog).values({
    url: opts.url,
    profile: opts.profile,
    workflowRunId: workflowRunId ?? null,
  }).returning();

  const cmd = `cat ${jobPath} | python3 ${RUNNER_SANDBOX_PATH}`;
  const proc = await execInContainer(cmd, 10 * 60 * 1000);

  if (onProgress && proc.stderr) {
    for (const line of proc.stderr.split('\n')) {
      if (!line.trim()) continue;
      try { onProgress(JSON.parse(line)); } catch { /* ignore malformed lines */ }
    }
  }

  let result: ScrapeResult;
  if (proc.exitCode !== 0) {
    result = {
      success: false,
      pages: [],
      error: (proc.stderr || '').slice(-1000) || `runner exited ${proc.exitCode}`,
    };
  } else {
    try {
      result = JSON.parse(proc.stdout);
    } catch (e: any) {
      result = { success: false, pages: [], error: `bad runner stdout: ${e.message}` };
    }
  }

  await db.update(scraperRunLog).set({
    endedAt: new Date(),
    success: result.success,
    pagesLoaded: result.pages.length,
    error: result.error ?? null,
  }).where(eq(scraperRunLog.id, logRow.id));

  // Auto-learn: if the scrape failed with a wait_for_selector TimeoutError, the
  // target domain likely requires an interactive upstream step (CAPTCHA / bot wall).
  // Only upsert if there is no existing manual row — never overwrite user edits.
  if (!result.success && result.error && /TimeoutError.*wait_for_selector|wait_for_selector.*TimeoutError/i.test(result.error)) {
    try {
      const { normalizeDomain, upsertKnowledge } = await import('./target-knowledge');
      const { scraperTargetKnowledge } = await import('$lib/db/schema');
      const { inArray } = await import('drizzle-orm');
      const domain = normalizeDomain(opts.url);
      const existing = await db.select({ id: scraperTargetKnowledge.id, source: scraperTargetKnowledge.source })
        .from(scraperTargetKnowledge)
        .where(inArray(scraperTargetKnowledge.domain, [domain]));
      const hasManualRow = existing.some(r => r.source === 'manual');
      if (!hasManualRow) {
        await upsertKnowledge({
          domain,
          requiresInteractive: true,
          interactiveHint:
            'Suspected CAPTCHA or bot wall — first scrape timed out waiting for expected selector. Run an interactive-step upstream to set up the session.',
          source: 'auto-failure',
        });
      }
    } catch (autoErr) {
      // Non-fatal — do not interrupt the caller
      console.warn('[runner] auto-learn upsert failed:', autoErr instanceof Error ? autoErr.message : autoErr);
    }
  }

  result.runLogId = logRow.id;
  return result;
}

/**
 * Proxy a scrape job to homeserv. Called from non-homeserv hosts (typically
 * the VPS) so the actual headed Chromium work runs from homeserv's
 * residential IP. Credentials, if requested, are looked up locally first
 * then passed in the request body — homeserv's runner accepts a
 * pre-resolved `_credential` and skips its own lookup.
 */
async function proxyScrapeToHomeserv(
  proxyUrl: string,
  opts: RunScrapeOptions,
): Promise<ScrapeResult> {
  const { credentialId, onProgress: _onProgress, workflowRunId, ...job } = opts;
  const body: Record<string, unknown> = {
    ...job,
    profile: normalizeProfileName(opts.profile),
    workflowRunId: workflowRunId ?? null,
  };
  if (credentialId) {
    const cred = await loadCredentialForRunner(credentialId);
    if (!cred) throw new Error(`credential ${credentialId} not found`);
    body._credential = cred;
  }

  const token = process.env.SCRAPER_SERVICE_TOKEN;
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      success: false,
      pages: [],
      error: `scraper proxy to ${proxyUrl} returned HTTP ${res.status}: ${text.slice(0, 500)}`,
    };
  }
  const remoteResult = (await res.json().catch(() => ({}))) as ScrapeResult;
  return remoteResult;
}
