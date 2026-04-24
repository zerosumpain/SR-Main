/**
 * script-runner.ts — execute a saved scrape script for a profile.
 *
 * Subsequent-run path for the script-scrape node: load the per-profile
 * script + meta from disk, decompose the user's searchQuery into the
 * script's declared vars, spawn the agent harness, exec.
 */
import { startAgent } from './agent-harness';
import { readScript, bumpRunCounter } from './script-store';
import { decomposeSearchQuery } from './playbook';

export interface RunScriptOptions {
  profile: string;
  searchQuery?: string;
  /** Pre-resolved variables — bypass decomposition entirely. */
  vars?: Record<string, string>;
  model?: string;
  workflowRunId?: string;
  onProgress?: (ev: Record<string, unknown>) => void;
}

export interface RunScriptResult {
  success: boolean;
  items: Array<Record<string, unknown>>;
  error?: string;
  /** Final URL the script left the page on — useful for debugging. */
  landedUrl?: string;
  stdout?: string;
  stderr?: string;
}

export async function runScript(opts: RunScriptOptions): Promise<RunScriptResult> {
  const { profile, searchQuery, vars: callerVars, model, onProgress } = opts;
  const loaded = await readScript(profile);
  if (!loaded) {
    return { success: false, items: [], error: `no saved script for profile "${profile}"` };
  }
  const { code, meta } = loaded;

  // Resolve vars: caller-supplied wins, then decompose searchQuery for any
  // declared vars still missing.
  const supplied: Record<string, string> = { ...(callerVars ?? {}) };
  const missing = meta.declaredVars.filter((v) => !supplied[v.name]);
  let decomposed: Record<string, string> = {};
  if (missing.length > 0 && searchQuery) {
    onProgress?.({ t: 'script.decompose.start', vars: missing.map((v) => v.name) });
    decomposed = await decomposeSearchQuery({
      searchQuery,
      requiredVars: missing,
      model,
      onDebug: (ev) => onProgress?.({ t: 'script.decompose.debug', ...ev }),
    }).catch(() => ({}));
    onProgress?.({ t: 'script.decompose.done', resolved: Object.keys(decomposed) });
  }
  const vars: Record<string, string> = { ...decomposed, ...supplied };
  onProgress?.({ t: 'script.exec.start', vars: Object.keys(vars) });

  const agent = await startAgent(profile);
  try {
    const r = await agent.execScript(code, vars, 180_000);
    const success = !r.error && r.items.length > 0;
    onProgress?.({
      t: 'script.exec.done',
      success,
      itemCount: r.items.length,
      error: r.error ?? undefined,
    });
    await bumpRunCounter(profile, success).catch(() => undefined);
    return {
      success,
      items: r.items,
      error: r.error ?? (r.items.length === 0 ? 'script returned 0 items' : undefined),
      landedUrl: r.observed_url,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  } finally {
    await agent.close();
  }
}
