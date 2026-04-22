import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { db } from '$lib/db';
import { scraperRunLog } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { ensureSandboxRunning, execInSandbox, writeFileInSandbox } from '$lib/jkai/sandbox';
import { normalizeProfileName } from './profiles';
import { loadCredentialForRunner } from './credentials';
import type { ScrapeJob, ScrapeResult } from './types';

const RUNNER_SANDBOX_PATH = '/home/jkai/scraper-runtime/scrape.py';

const HOMESERV_HOSTNAMES = ['homeserv'];

function assertRunningOnHomeserv(): void {
  if (process.env.NODE_ENV !== 'production') return; // allow in dev regardless of host
  const host = os.hostname();
  if (!HOMESERV_HOSTNAMES.includes(host)) {
    throw new Error(
      `Scraper refuses to run on host '${host}' in production. ` +
      `Stealth scraping relies on homeserv's residential IP; running on the VPS ` +
      `would expose a datacenter IP and defeat the purpose. ` +
      `If you really need to run here, set SCRAPER_ALLOW_NON_HOMESERV=1.`,
    );
  }
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
  if (!process.env.SCRAPER_ALLOW_NON_HOMESERV) assertRunningOnHomeserv();
  await ensureSandboxRunning();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const runDir = `/home/jkai/scraper-runtime/runs/${runId}`;
  await execInSandbox(`mkdir -p ${runDir} /home/jkai/scraper-runtime`);

  await writeFileInSandbox(RUNNER_SANDBOX_PATH, readRunnerSource());

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
  await writeFileInSandbox(jobPath, JSON.stringify(jobNormalized));

  const [logRow] = await db.insert(scraperRunLog).values({
    url: opts.url,
    profile: opts.profile,
    workflowRunId: workflowRunId ?? null,
  }).returning();

  const cmd = `cat ${jobPath} | python3 ${RUNNER_SANDBOX_PATH}`;
  const proc = await execInSandbox(cmd, 10 * 60 * 1000);

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

  result.runLogId = logRow.id;
  return result;
}
