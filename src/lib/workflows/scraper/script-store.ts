/**
 * script-store.ts — persistence for LLM-authored scrape scripts.
 *
 * Each script is owned by a `profile` (per-domain identifier). On disk:
 *   <SCRIPT_DIR>/<profile>.py     — Python body for the `scrape(page, vars)`
 *      function the agent harness execs.
 *   <SCRIPT_DIR>/<profile>.meta.json — declared vars, goal, seed url,
 *      generated/last-success timestamps, basic run counters.
 *
 * The directory is host-mounted only — the sandbox container never reads
 * these files; the SvelteKit server loads the script body and ships it to
 * the harness via stdin (exec_script command). That keeps script auth
 * authoritative server-side and avoids needing a new bind-mount.
 *
 * Default path is `<projectRoot>/scraper-scripts/` (resolved via
 * `process.cwd()`, which is the strange_rambling_svelte repo root when the
 * SvelteKit server is launched normally). Override with `SCRAPER_SCRIPTS_DIR`.
 * The dir is gitignored and NOT rsynced by `scripts/deploy.sh`, so it stays
 * homeserv-local where the warm Playwright session + residential IP live.
 */
import { promises as fs } from 'fs';
import { join } from 'path';

export const SCRIPT_DIR =
  process.env.SCRAPER_SCRIPTS_DIR ?? join(process.cwd(), 'scraper-scripts');

export interface ScriptMeta {
  profile: string;
  /** Echoed user goal at author time. */
  goal: string;
  /** Seed URL the scout viewed during authoring. */
  seedUrl: string;
  /** Variables the script expects in `vars` (for the runtime decomposer to fill). */
  declaredVars: Array<{ name: string; hint: string }>;
  /** ISO timestamp the script was first authored. */
  generatedAt: string;
  /** ISO timestamp of the last successful run (≥1 item). */
  lastSuccessAt: string | null;
  /** Total successful + failed run counts. */
  runCount: number;
  successCount: number;
}

export async function readScript(profile: string): Promise<{ code: string; meta: ScriptMeta } | null> {
  const codePath = join(SCRIPT_DIR, `${profile}.py`);
  const metaPath = join(SCRIPT_DIR, `${profile}.meta.json`);
  try {
    const [code, metaRaw] = await Promise.all([
      fs.readFile(codePath, 'utf8'),
      fs.readFile(metaPath, 'utf8'),
    ]);
    const meta = JSON.parse(metaRaw) as ScriptMeta;
    return { code, meta };
  } catch {
    return null;
  }
}

export async function writeScript(profile: string, code: string, meta: Omit<ScriptMeta, 'profile'>): Promise<void> {
  await fs.mkdir(SCRIPT_DIR, { recursive: true });
  const codePath = join(SCRIPT_DIR, `${profile}.py`);
  const metaPath = join(SCRIPT_DIR, `${profile}.meta.json`);
  const fullMeta: ScriptMeta = { profile, ...meta };
  await Promise.all([
    fs.writeFile(codePath, code, 'utf8'),
    fs.writeFile(metaPath, JSON.stringify(fullMeta, null, 2), 'utf8'),
  ]);
}

/** List every saved script profile plus its meta. Used by the orchestrator's
 * `scraper_script_list` tool — cheap: one readdir + one readFile per profile. */
export async function listScripts(): Promise<ScriptMeta[]> {
  try {
    const entries = await fs.readdir(SCRIPT_DIR);
    const profiles = entries
      .filter((n) => n.endsWith('.meta.json'))
      .map((n) => n.slice(0, -'.meta.json'.length));
    const metas = await Promise.all(
      profiles.map(async (p) => {
        try {
          const raw = await fs.readFile(join(SCRIPT_DIR, `${p}.meta.json`), 'utf8');
          return JSON.parse(raw) as ScriptMeta;
        } catch { return null; }
      }),
    );
    return metas.filter((m): m is ScriptMeta => m !== null);
  } catch { return []; }
}

export async function deleteScript(profile: string): Promise<boolean> {
  const codePath = join(SCRIPT_DIR, `${profile}.py`);
  const metaPath = join(SCRIPT_DIR, `${profile}.meta.json`);
  let removed = false;
  for (const p of [codePath, metaPath]) {
    try { await fs.unlink(p); removed = true; }
    catch { /* missing is fine */ }
  }
  return removed;
}

export async function bumpRunCounter(profile: string, success: boolean): Promise<void> {
  const existing = await readScript(profile);
  if (!existing) return;
  const meta: ScriptMeta = {
    ...existing.meta,
    runCount: existing.meta.runCount + 1,
    successCount: existing.meta.successCount + (success ? 1 : 0),
    lastSuccessAt: success ? new Date().toISOString() : existing.meta.lastSuccessAt,
  };
  await writeScript(profile, existing.code, meta);
}
